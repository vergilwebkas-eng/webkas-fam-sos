-- WEBKAS FAM SOS wallet and daily dues automation.
-- Apply after the core member_profiles, dues_settings, payment_submissions,
-- and cash_ledger schema has been created.

create table if not exists public.member_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  arrears integer not null default 0 check (arrears >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references auth.users(id) on delete cascade,
  payment_id uuid unique references public.payment_submissions(id) on delete set null,
  transaction_type text not null check (transaction_type in ('payment_credit','daily_deduction','arrears_accrual','admin_adjustment')),
  amount integer not null,
  balance_after integer not null,
  arrears_after integer not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.daily_dues_log (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references auth.users(id) on delete cascade,
  due_date date not null,
  daily_rate integer not null check (daily_rate >= 0),
  balance_before integer not null,
  balance_after integer not null,
  arrears_added integer not null,
  arrears_after integer not null,
  created_at timestamptz not null default now(),
  unique(member_id, due_date)
);

alter table public.member_wallets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.daily_dues_log enable row level security;

drop policy if exists wallet_read_self_or_admin on public.member_wallets;
create policy wallet_read_self_or_admin on public.member_wallets
for select to authenticated
using (user_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'admin');

drop policy if exists wallet_transactions_read_self_or_admin on public.wallet_transactions;
create policy wallet_transactions_read_self_or_admin on public.wallet_transactions
for select to authenticated
using (member_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'admin');

drop policy if exists daily_dues_read_self_or_admin on public.daily_dues_log;
create policy daily_dues_read_self_or_admin on public.daily_dues_log
for select to authenticated
using (member_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'admin');

revoke insert, update, delete on public.member_wallets from anon, authenticated;
revoke insert, update, delete on public.wallet_transactions from anon, authenticated;
revoke insert, update, delete on public.daily_dues_log from anon, authenticated;

create or replace function public.ensure_member_wallet()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  insert into public.member_wallets(user_id) values (new.user_id)
  on conflict (user_id) do nothing;
  return new;
end;
$function$;
revoke all on function public.ensure_member_wallet() from public, anon, authenticated;

drop trigger if exists member_profile_wallet_init on public.member_profiles;
create trigger member_profile_wallet_init after insert on public.member_profiles
for each row execute function public.ensure_member_wallet();

create or replace function public.on_payment_approved_add_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_balance integer;
  v_arrears integer;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    insert into public.cash_ledger (payment_id, member_id, entry_type, amount, description, created_by)
    values (new.id, new.member_id, 'dues_payment', new.amount, 'Pembayaran kas disetujui', new.reviewed_by)
    on conflict (payment_id) do nothing;

    insert into public.member_wallets (user_id, balance, arrears, updated_at)
    values (new.member_id, new.amount, 0, now())
    on conflict (user_id) do update
      set balance = public.member_wallets.balance + excluded.balance, updated_at = now()
    returning balance, arrears into v_balance, v_arrears;

    insert into public.wallet_transactions (member_id, payment_id, transaction_type, amount, balance_after, arrears_after, description)
    values (new.member_id, new.id, 'payment_credit', new.amount, v_balance, v_arrears, 'Saldo bertambah dari pembayaran kas yang disetujui')
    on conflict (payment_id) do nothing;
  end if;
  return new;
end;
$function$;
revoke all on function public.on_payment_approved_add_ledger() from public, anon, authenticated;

create or replace function public.process_daily_dues(p_due_date date default ((now() at time zone 'Asia/Jakarta')::date))
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rate integer;
  m record;
  v_balance integer;
  v_arrears integer;
  v_after integer;
  v_added integer;
  v_count integer := 0;
begin
  select daily_amount into v_rate from public.dues_settings where id = 1;
  v_rate := coalesce(v_rate, 1000);

  for m in
    select p.user_id from public.member_profiles p
    where p.member_status = 'active' order by p.user_id
  loop
    insert into public.member_wallets(user_id) values (m.user_id)
    on conflict (user_id) do nothing;

    if exists (select 1 from public.daily_dues_log l where l.member_id = m.user_id and l.due_date = p_due_date) then
      continue;
    end if;

    select balance, arrears into v_balance, v_arrears
    from public.member_wallets where user_id = m.user_id for update;

    if v_balance >= v_rate then
      v_after := v_balance - v_rate;
      v_added := 0;
    else
      v_after := 0;
      v_added := v_rate - v_balance;
    end if;
    v_arrears := v_arrears + v_added;

    update public.member_wallets set balance = v_after, arrears = v_arrears, updated_at = now()
    where user_id = m.user_id;

    insert into public.daily_dues_log(member_id, due_date, daily_rate, balance_before, balance_after, arrears_added, arrears_after)
    values (m.user_id, p_due_date, v_rate, v_balance, v_after, v_added, v_arrears)
    on conflict (member_id, due_date) do nothing;

    insert into public.wallet_transactions(member_id, transaction_type, amount, balance_after, arrears_after, description)
    values (m.user_id, case when v_added = 0 then 'daily_deduction' else 'arrears_accrual' end,
      case when v_added = 0 then v_rate else v_added end, v_after, v_arrears,
      case when v_added = 0 then 'Potongan kas harian ' || p_due_date::text else 'Tunggakan kas harian ' || p_due_date::text end);

    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('due_date', p_due_date, 'daily_rate', v_rate, 'members_processed', v_count);
end;
$function$;
revoke all on function public.process_daily_dues(date) from public, anon, authenticated;
grant execute on function public.process_daily_dues(date) to service_role;

-- Live project cron jobs:
-- 0 17 * * * UTC => 00:00 WIB: select public.process_daily_dues((now() at time zone 'Asia/Jakarta')::date);
-- Cleanup job calls Edge Function cleanup-payment-proofs at 17:30 UTC (00:30 WIB).
