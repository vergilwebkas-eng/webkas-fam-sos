-- Make daily dues and approved payment settlement deterministic in Asia/Jakarta.
-- Existing active members begin accruing from their existing local join date.
-- Pending members start accruing on the local date they are activated.

alter table public.member_profiles
  add column if not exists dues_start_date date;

update public.member_profiles
set dues_start_date = (created_at at time zone 'Asia/Jakarta')::date
where member_status = 'active' and dues_start_date is null;

create or replace function public.set_member_dues_start_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    if new.member_status = 'active' and new.dues_start_date is null then
      new.dues_start_date := coalesce((new.created_at at time zone 'Asia/Jakarta')::date,
                                      (now() at time zone 'Asia/Jakarta')::date);
    elsif new.member_status <> 'active' then
      new.dues_start_date := null;
    end if;
  elsif new.member_status = 'active' and old.member_status is distinct from 'active' then
    new.dues_start_date := (now() at time zone 'Asia/Jakarta')::date;
  elsif new.member_status <> 'active' then
    new.dues_start_date := null;
  elsif new.member_status = 'active' and new.dues_start_date is null then
    new.dues_start_date := (now() at time zone 'Asia/Jakarta')::date;
  end if;
  return new;
end;
$function$;

revoke all on function public.set_member_dues_start_date() from public, anon, authenticated;

drop trigger if exists member_dues_start_date_guard on public.member_profiles;
create trigger member_dues_start_date_guard
before insert or update of member_status, dues_start_date on public.member_profiles
for each row execute function public.set_member_dues_start_date();

create index if not exists member_profiles_active_dues_start_idx
  on public.member_profiles (dues_start_date, user_id)
  where member_status = 'active';

create or replace function public.on_payment_approved_add_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_balance integer;
  v_arrears integer;
  v_paid_to_arrears integer;
  v_balance_credit integer;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    -- Ensure the wallet exists, then serialize payment settlement against daily charging.
    insert into public.member_wallets (user_id, balance, arrears, updated_at)
    values (new.member_id, 0, 0, now())
    on conflict (user_id) do nothing;

    select balance, arrears
      into v_balance, v_arrears
    from public.member_wallets
    where user_id = new.member_id
    for update;

    v_paid_to_arrears := least(v_arrears, new.amount);
    v_balance_credit := new.amount - v_paid_to_arrears;

    update public.member_wallets
      set balance = balance + v_balance_credit,
          arrears = arrears - v_paid_to_arrears,
          updated_at = now()
    where user_id = new.member_id
    returning balance, arrears into v_balance, v_arrears;

    insert into public.cash_ledger
      (payment_id, member_id, entry_type, amount, description, created_by, created_at)
    values
      (new.id, new.member_id, 'dues_payment', new.amount,
       'Pembayaran kas disetujui; pelunasan tunggakan: ' || v_paid_to_arrears::text,
       new.reviewed_by, new.created_at)
    on conflict (payment_id) do nothing;

    insert into public.wallet_transactions
      (member_id, payment_id, transaction_type, amount, balance_after, arrears_after, description)
    values
      (new.member_id, new.id, 'payment_credit', new.amount, v_balance, v_arrears,
       'Pembayaran disetujui; ' || v_paid_to_arrears::text ||
       ' melunasi tunggakan, ' || v_balance_credit::text || ' masuk saldo')
    on conflict (payment_id) do nothing;
  end if;
  return new;
end;
$function$;

revoke all on function public.on_payment_approved_add_ledger() from public, anon, authenticated;

create or replace function public.process_daily_dues(
  p_due_date date default ((now() at time zone 'Asia/Jakarta')::date)
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rate integer;
  m record;
  v_due_date date;
  v_balance integer;
  v_arrears integer;
  v_after integer;
  v_added integer;
  v_members_count integer := 0;
  v_days_count integer := 0;
  v_member_days integer := 0;
begin
  if p_due_date is null then
    p_due_date := (now() at time zone 'Asia/Jakarta')::date;
  end if;

  select daily_amount into v_rate
  from public.dues_settings
  where id = 1;
  v_rate := greatest(coalesce(v_rate, 1000), 0);

  for m in
    select p.user_id, p.dues_start_date
    from public.member_profiles p
    where p.member_status = 'active'
      and p.dues_start_date is not null
      and p.dues_start_date <= p_due_date
    order by p.user_id
  loop
    insert into public.member_wallets (user_id)
    values (m.user_id)
    on conflict (user_id) do nothing;

    -- A wallet lock serializes concurrent cron retries and approved payments.
    select balance, arrears
      into v_balance, v_arrears
    from public.member_wallets
    where user_id = m.user_id
    for update;

    -- Replay every missing calendar day since the member became active.
    -- Existing records are skipped; the wallet lock serializes concurrent retries.
    v_member_days := 0;
    for v_due_date in
      select gs::date
      from generate_series(m.dues_start_date::timestamp,
                           p_due_date::timestamp,
                           interval '1 day') as gs
      order by gs
    loop
      if exists (
        select 1
        from public.daily_dues_log l
        where l.member_id = m.user_id and l.due_date = v_due_date
      ) then
        continue;
      end if;

      if v_balance >= v_rate then
        v_after := v_balance - v_rate;
        v_added := 0;
      else
        v_after := 0;
        v_added := v_rate - v_balance;
      end if;
      v_arrears := v_arrears + v_added;

      update public.member_wallets
      set balance = v_after, arrears = v_arrears, updated_at = now()
      where user_id = m.user_id;

      insert into public.daily_dues_log
        (member_id, due_date, daily_rate, balance_before, balance_after, arrears_added, arrears_after)
      values
        (m.user_id, v_due_date, v_rate, v_balance, v_after, v_added, v_arrears);

      insert into public.wallet_transactions
        (member_id, transaction_type, amount, balance_after, arrears_after, description)
      values
        (m.user_id,
         case when v_added = 0 then 'daily_deduction' else 'arrears_accrual' end,
         case when v_added = 0 then v_rate else v_added end,
         v_after, v_arrears,
         case when v_added = 0
           then 'Potongan kas harian ' || v_due_date::text
           else 'Tunggakan kas harian ' || v_due_date::text
         end);

      v_balance := v_after;
      v_member_days := v_member_days + 1;
      v_days_count := v_days_count + 1;
    end loop;
    if v_member_days > 0 then
      v_members_count := v_members_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'through_date', p_due_date,
    'daily_rate', v_rate,
    'members_with_charges', v_members_count,
    'daily_entries_created', v_days_count
  );
end;
$function$;

revoke all on function public.process_daily_dues(date) from public, anon, authenticated;
grant execute on function public.process_daily_dues(date) to service_role;

-- pg_cron uses UTC. 17:01 UTC is 00:01 Asia/Jakarta on the next calendar day.
select cron.unschedule(jobid)
from cron.job
where jobname = 'webkas-daily-dues-wib';

select cron.schedule(
  'webkas-daily-dues-wib',
  '1 17 * * *',
  $cron$select public.process_daily_dues((now() at time zone 'Asia/Jakarta')::date);$cron$
);
