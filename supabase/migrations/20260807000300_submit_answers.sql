create table public.answers (
  id uuid primary key,
  question_id uuid not null unique references public.question_jobs (id) on delete cascade,
  answerer_id uuid not null references public.profiles (user_id),
  created_at timestamptz not null default now(),
  payload_id uuid,
  rating text check (rating in ('like', 'dislike')),
  delivered_at timestamptz,
  content_deleted_at timestamptz
);

create table public.answer_payloads (
  id uuid primary key,
  answer_id uuid not null unique references public.answers (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 750),
  created_at timestamptz not null default now(),
  purge_after timestamptz not null
);

alter table public.answers enable row level security;
alter table public.answer_payloads enable row level security;
revoke all on public.answers, public.answer_payloads from anon, authenticated;

create or replace function public.submit_answer(answer_text text)
returns table (answer_id uuid, credit_balance integer, accepted_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  trimmed_text text := btrim(answer_text);
  active_question public.question_jobs%rowtype;
  new_answer_id uuid := gen_random_uuid();
  new_payload_id uuid := gen_random_uuid();
  current_time timestamptz := now();
  current_balance integer;
begin
  if current_user_id is null then raise exception 'Authentication is required'; end if;
  if trimmed_text is null or char_length(trimmed_text) = 0 or char_length(trimmed_text) > 750 then
    raise exception 'Answers must contain between 1 and 750 characters';
  end if;

  select * into active_question from public.question_jobs
  where reserved_by = current_user_id and status = 'reserved'
  for update;

  if not found or active_question.reservation_expires_at <= current_time then
    raise exception 'Your reservation has expired';
  end if;

  insert into public.answers (id, question_id, answerer_id, created_at, payload_id)
  values (new_answer_id, active_question.id, current_user_id, current_time, new_payload_id);
  insert into public.answer_payloads (id, answer_id, text, created_at, purge_after)
  values (new_payload_id, new_answer_id, trimmed_text, current_time, current_time + interval '7 days');
  update public.question_jobs set status = 'completed_unclaimed' where id = active_question.id;
  update public.profiles set credit_balance = credit_balance + 1, last_seen_at = current_time
    where user_id = current_user_id returning profiles.credit_balance into current_balance;
  insert into public.credit_ledger (user_id, amount, reason, reference_id)
  values (current_user_id, 1, 'answer_submitted', new_answer_id);

  return query select new_answer_id, current_balance, current_time;
end;
$$;

revoke all on function public.submit_answer(text) from public;
grant execute on function public.submit_answer(text) to authenticated;
