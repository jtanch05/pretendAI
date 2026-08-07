create extension if not exists pgcrypto;

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  credit_balance integer not null default 1 check (credit_balance >= 0),
  status text not null default 'active' check (status in ('active', 'restricted'))
);

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  amount integer not null,
  reason text not null,
  created_at timestamptz not null default now(),
  unique (user_id, reason)
);

alter table public.profiles enable row level security;
alter table public.credit_ledger enable row level security;

revoke all on public.profiles, public.credit_ledger from anon, authenticated;

create or replace function public.create_profile_with_starter_credit()
returns table (credit_balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication is required';
  end if;

  with created_profile as (
    insert into public.profiles (user_id, credit_balance)
    values (current_user_id, 1)
    on conflict (user_id) do nothing
    returning user_id
  )
  insert into public.credit_ledger (user_id, amount, reason)
  select user_id, 1, 'starter_credit'
  from created_profile;

  update public.profiles
  set last_seen_at = now()
  where user_id = current_user_id;

  return query
  select profiles.credit_balance
  from public.profiles
  where profiles.user_id = current_user_id;
end;
$$;

revoke all on function public.create_profile_with_starter_credit() from public;
grant execute on function public.create_profile_with_starter_credit() to authenticated;
