alter table public.question_jobs add column refunded_at timestamptz;

create or replace function public.expire_questions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare expired_count integer;
begin
  with candidates as (
    select id, asker_id from public.question_jobs
    where status = 'pending' and expires_at <= now() and refunded_at is null
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

  delete from public.question_payloads where question_id in (select id from public.question_jobs where status = 'expired' and content_deleted_at is not null);
  return expired_count;
end;
$$;

revoke all on function public.expire_questions() from public;
