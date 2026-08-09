alter table public.profiles
  add column zero_credit_since timestamptz;

update public.profiles as p
set zero_credit_since = coalesce(
  (
    select max(ledger.created_at)
    from public.credit_ledger as ledger
    where ledger.user_id = p.user_id
  ),
  p.last_seen_at
)
where p.credit_balance = 0;

create function public.track_zero_credit_since()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.credit_balance = 0 and (tg_op = 'INSERT' or old.credit_balance is distinct from 0) then
    new.zero_credit_since := now();
  elsif new.credit_balance > 0 then
    new.zero_credit_since := null;
  elsif tg_op = 'UPDATE' then
    new.zero_credit_since := old.zero_credit_since;
  end if;

  return new;
end;
$$;

create trigger profiles_track_zero_credit_since
before insert or update of credit_balance on public.profiles
for each row execute function public.track_zero_credit_since();

alter table public.profiles
  add constraint profiles_zero_credit_since_matches_balance
  check ((credit_balance = 0) = (zero_credit_since is not null));

create function public.claim_idle_credit()
returns table (
  credit_balance integer,
  idle_credit_available_at timestamptz,
  server_now timestamptz,
  credit_awarded boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_balance integer;
  current_status text;
  current_zero_credit_since timestamptz;
  request_now timestamptz := now();
  eligible_at timestamptz;
begin
  if current_user_id is null then
    raise exception 'Authentication is required';
  end if;

  select p.credit_balance, p.status, p.zero_credit_since
  into current_balance, current_status, current_zero_credit_since
  from public.profiles as p
  where p.user_id = current_user_id
  for update;

  if not found then
    raise exception 'Player profile not found';
  end if;

  if current_status <> 'active' or current_balance <> 0 or current_zero_credit_since is null then
    return query select current_balance, null::timestamptz, request_now, false;
    return;
  end if;

  eligible_at := current_zero_credit_since + interval '5 minutes';
  if request_now < eligible_at then
    return query select current_balance, eligible_at, request_now, false;
    return;
  end if;

  update public.profiles as p
  set credit_balance = p.credit_balance + 1,
      last_seen_at = request_now
  where p.user_id = current_user_id
  returning p.credit_balance into current_balance;

  insert into public.credit_ledger (user_id, amount, reason)
  values (current_user_id, 1, 'idle_credit_recovery');

  return query select current_balance, null::timestamptz, request_now, true;
end;
$$;

revoke all on function public.track_zero_credit_since() from public, anon, authenticated;
revoke all on function public.claim_idle_credit() from public, anon, authenticated;
grant execute on function public.claim_idle_credit() to authenticated;
