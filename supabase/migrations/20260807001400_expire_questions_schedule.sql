create or replace function public.expire_questions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare expired_count integer;
begin
  perform public.expire_reservations();

  with candidates as (
    select id, asker_id from public.question_jobs
    where status in ('pending', 'reserved') and expires_at <= now() and refunded_at is null
    for update skip locked
  ), expired as (
    update public.question_jobs set status = 'expired', refunded_at = now(), content_deleted_at = now(), payload_id = null
    from candidates where question_jobs.id = candidates.id
    returning candidates.id, candidates.asker_id
  ), refunded as (
    update public.profiles set credit_balance = credit_balance + 1
    from expired where profiles.user_id = expired.asker_id
    returning expired.id, expired.asker_id
  ), ledger as (
    insert into public.credit_ledger (user_id, amount, reason, reference_id)
    select asker_id, 1, 'question_expired_refund', id from refunded
  ) select count(*) into expired_count from expired;

  delete from public.question_payloads where question_id in (
    select id from public.question_jobs where status = 'expired' and content_deleted_at is not null
  );
  return expired_count;
end;
$$;

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

  if not found or active_question.reservation_expires_at <= current_time or active_question.expires_at <= current_time then
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

create or replace function public.get_latest_expired_question()
returns table (question_id uuid)
language sql
security definer
set search_path = public
as $$
  select question_jobs.id
  from public.question_jobs
  where question_jobs.asker_id = auth.uid()
    and question_jobs.status = 'expired'
  order by question_jobs.refunded_at desc
  limit 1;
$$;

revoke all on function public.expire_questions(), public.get_latest_expired_question(), public.submit_answer(text) from public, anon;
grant execute on function public.get_latest_expired_question(), public.submit_answer(text) to authenticated;

create extension if not exists pg_cron;

select cron.schedule(
  'expire-unanswered-questions',
  '* * * * *',
  'select public.expire_questions();'
)
where not exists (
  select 1 from cron.job where jobname = 'expire-unanswered-questions'
);
