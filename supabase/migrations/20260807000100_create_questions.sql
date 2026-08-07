alter table public.credit_ledger
  drop constraint credit_ledger_user_id_reason_key,
  add column reference_id uuid;

create unique index credit_ledger_user_reason_reference_key
  on public.credit_ledger (user_id, reason, reference_id)
  where reference_id is not null;

create table public.question_jobs (
  id uuid primary key,
  asker_id uuid not null references public.profiles (user_id) on delete cascade,
  status text not null check (status in ('pending', 'reserved', 'completed_unclaimed', 'delivered', 'expired', 'removed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  payload_id uuid,
  reserved_by uuid references public.profiles (user_id),
  reservation_expires_at timestamptz,
  content_deleted_at timestamptz
);

create unique index one_open_question_per_asker
  on public.question_jobs (asker_id)
  where status in ('pending', 'reserved');

create table public.question_payloads (
  id uuid primary key,
  question_id uuid not null unique references public.question_jobs (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 500),
  created_at timestamptz not null default now(),
  purge_after timestamptz not null
);

alter table public.question_jobs enable row level security;
alter table public.question_payloads enable row level security;
revoke all on public.question_jobs, public.question_payloads from anon, authenticated;

create or replace function public.create_question(question_text text)
returns table (question_id uuid, credit_balance integer, question_status text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  trimmed_text text := btrim(question_text);
  new_question_id uuid := gen_random_uuid();
  new_payload_id uuid := gen_random_uuid();
  current_balance integer;
  now_at timestamptz := now();
begin
  if current_user_id is null then
    raise exception 'Authentication is required';
  end if;

  if trimmed_text is null or char_length(trimmed_text) = 0 or char_length(trimmed_text) > 500 then
    raise exception 'Questions must contain between 1 and 500 characters';
  end if;

  select profiles.credit_balance
  into current_balance
  from public.profiles
  where profiles.user_id = current_user_id and profiles.status = 'active'
  for update;

  if not found then
    raise exception 'An active player profile is required';
  end if;

  if current_balance < 1 then
    raise exception 'You need one credit to ask a question';
  end if;

  if exists (
    select 1 from public.question_jobs
    where asker_id = current_user_id and status in ('pending', 'reserved')
  ) then
    raise exception 'You already have a question waiting for an answer';
  end if;

  insert into public.question_jobs (id, asker_id, status, created_at, expires_at, payload_id)
  values (new_question_id, current_user_id, 'pending', now_at, now_at + interval '1 hour', new_payload_id);

  insert into public.question_payloads (id, question_id, text, created_at, purge_after)
  values (new_payload_id, new_question_id, trimmed_text, now_at, now_at + interval '1 hour');

  update public.profiles
  set credit_balance = credit_balance - 1, last_seen_at = now_at
  where user_id = current_user_id
  returning profiles.credit_balance into current_balance;

  insert into public.credit_ledger (user_id, amount, reason, reference_id)
  values (current_user_id, -1, 'question_created', new_question_id);

  return query select new_question_id, current_balance, 'pending'::text, now_at;
end;
$$;

create or replace function public.get_current_player_state()
returns table (
  credit_balance integer,
  active_question_id uuid,
  active_question_status text,
  active_question_text text,
  active_question_created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    profiles.credit_balance,
    question_jobs.id,
    question_jobs.status,
    question_payloads.text,
    question_jobs.created_at
  from public.profiles
  left join public.question_jobs
    on question_jobs.asker_id = profiles.user_id
    and question_jobs.status in ('pending', 'reserved')
  left join public.question_payloads on question_payloads.id = question_jobs.payload_id
  where profiles.user_id = auth.uid();
$$;

revoke all on function public.create_question(text), public.get_current_player_state() from public;
grant execute on function public.create_question(text), public.get_current_player_state() to authenticated;
