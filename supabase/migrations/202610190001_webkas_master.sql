begin;

alter table public.member_profiles
  add column if not exists role text not null default 'member',
  add column if not exists balance integer not null default 0,
  add column if not exists arrears integer not null default 0,
  add column if not exists activation_code_hash text,
  add column if not exists activation_expires_at timestamptz,
  add column if not exists activated_at timestamptz;

alter table public.member_profiles drop constraint if exists member_profiles_member_status_check;
alter table public.member_profiles add constraint member_profiles_member_status_check
  check (member_status = any (array['pending_activation','active','inactive','suspended']));
alter table public.member_profiles drop constraint if exists member_profiles_role_check;
alter table public.member_profiles add constraint member_profiles_role_check
  check (role = any (array['member','admin_utama','admin_pendukung']));
alter table public.member_profiles drop constraint if exists member_profiles_balance_check;
alter table public.member_profiles add constraint member_profiles_balance_check check (balance >= 0);
alter table public.member_profiles drop constraint if exists member_profiles_arrears_check;
alter table public.member_profiles add constraint member_profiles_arrears_check check (arrears >= 0);
create unique index if not exists member_profiles_ic_name_ci_uidx on public.member_profiles (lower(ic_name));
update public.dues_settings set currency = 'IDR' where id = 1;

create table if not exists public.daily_cash_runs (
  run_date date primary key,
  daily_amount integer not null check (daily_amount >= 0),
  processed_count integer not null default 0,
  processed_at timestamptz not null default now()
);
create table if not exists public.member_daily_charges (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references auth.users(id) on delete cascade,
  charge_date date not null,
  daily_amount integer not null check (daily_amount >= 0),
  paid_from_balance integer not null default 0 check (paid_from_balance >= 0),
  arrears_added integer not null default 0 check (arrears_added >= 0),
  created_at timestamptz not null default now(),
  unique(member_id, charge_date)
);
create index if not exists member_daily_charges_member_date_idx on public.member_daily_charges(member_id, charge_date desc);
alter table public.daily_cash_runs enable row level security;
alter table public.member_daily_charges enable row level security;

drop policy if exists daily_charges_read_self_or_admin on public.member_daily_charges;
create policy daily_charges_read_self_or_admin on public.member_daily_charges for select to authenticated
  using (member_id = (select auth.uid()) or (select ((auth.jwt() -> 'app_metadata') ->> 'role')) = 'admin');
grant select on public.member_daily_charges to authenticated;
revoke all on public.daily_cash_runs from anon, authenticated;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to service_role;
create table if not exists app_private.bootstrap_tokens (
  token_hash text primary key,
  created_at timestamptz not null default now()
);
revoke all on app_private.bootstrap_tokens from public, anon, authenticated;
grant select, insert, delete on app_private.bootstrap_tokens to service_role;

create or replace function public.consume_bootstrap_secret(p_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_hash text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    return false;
  end if;
  if exists (select 1 from auth.users u where u.raw_app_meta_data ->> 'role' = 'admin') then
    return false;
  end if;
  v_hash := encode(extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256'), 'hex');
  delete from app_private.bootstrap_tokens where token_hash = v_hash;
  return found;
end;
$$;
revoke all on function public.consume_bootstrap_secret(text) from public, anon, authenticated;
grant execute on function public.consume_bootstrap_secret(text) to service_role;

create or replace function public.run_daily_cash(p_run_date date default ((now() at time zone 'Asia/Jakarta')::date))
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount integer;
  v_member record;
  v_paid integer;
  v_shortfall integer;
  v_count integer := 0;
  v_inserted date;
begin
  select coalesce(s.daily_amount, 1000) into v_amount from public.dues_settings s where s.id = 1;
  v_amount := coalesce(v_amount, 1000);
  insert into public.daily_cash_runs(run_date, daily_amount) values (p_run_date, v_amount)
  on conflict (run_date) do nothing returning run_date into v_inserted;
  if v_inserted is null then
    return jsonb_build_object('status','already_processed','run_date',p_run_date,'daily_amount',v_amount);
  end if;
  for v_member in select p.user_id, p.balance, p.arrears from public.member_profiles p
    where p.member_status = 'active' and p.role = 'member' order by p.user_id for update
  loop
    v_paid := least(v_member.balance, v_amount);
    v_shortfall := greatest(v_amount - v_paid, 0);
    update public.member_profiles set balance = balance - v_paid, arrears = arrears + v_shortfall, updated_at = now()
      where user_id = v_member.user_id;
    insert into public.member_daily_charges(member_id, charge_date, daily_amount, paid_from_balance, arrears_added)
      values (v_member.user_id, p_run_date, v_amount, v_paid, v_shortfall)
      on conflict (member_id, charge_date) do nothing;
    v_count := v_count + 1;
  end loop;
  update public.daily_cash_runs set processed_count = v_count, processed_at = now() where run_date = p_run_date;
  return jsonb_build_object('status','processed','run_date',p_run_date,'daily_amount',v_amount,'members_processed',v_count);
end;
$$;
revoke all on function public.run_daily_cash(date) from public, anon, authenticated;
grant execute on function public.run_daily_cash(date) to service_role;

create or replace function public.on_payment_approved_add_ledger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    insert into public.cash_ledger (payment_id, member_id, entry_type, amount, description, created_by)
    values (new.id, new.member_id, 'dues_payment', new.amount, 'Pembayaran kas disetujui', new.reviewed_by)
    on conflict (payment_id) do nothing;
    update public.member_profiles set balance = balance + new.amount, updated_at = now()
      where user_id = new.member_id;
  end if;
  return new;
end;
$$;

commit;
