create or replace function public.purge_unclaimed_answers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare purged_count integer;
begin
  with candidates as (
    select answers.id as answer_id, question_jobs.id as question_id
    from public.answers
    join public.question_jobs on question_jobs.id = answers.question_id
    join public.answer_payloads on answer_payloads.id = answers.payload_id
    where question_jobs.status = 'completed_unclaimed'
      and answer_payloads.purge_after <= now()
    for update of answers, question_jobs, answer_payloads skip locked
  ), purged as (
    delete from public.answer_payloads
    using candidates
    where answer_payloads.answer_id = candidates.answer_id
    returning candidates.answer_id, candidates.question_id
  ), marked_answers as (
    update public.answers
    set content_deleted_at = coalesce(content_deleted_at, now())
    from purged
    where answers.id = purged.answer_id
  ), marked_questions as (
    update public.question_jobs
    set status = 'removed', content_deleted_at = coalesce(content_deleted_at, now()), payload_id = null
    from purged
    where question_jobs.id = purged.question_id
    returning purged.question_id
  ) select count(*) into purged_count from marked_questions;

  delete from public.question_payloads
  where question_id in (
    select id from public.question_jobs where status = 'removed' and content_deleted_at is not null
  );
  return purged_count;
end;
$$;

create or replace function public.get_latest_unavailable_delivery()
returns table (question_id uuid)
language sql
security definer
set search_path = public
as $$
  select question_jobs.id
  from public.question_jobs
  where question_jobs.asker_id = auth.uid()
    and question_jobs.status = 'removed'
  order by question_jobs.content_deleted_at desc
  limit 1;
$$;

revoke all on function public.purge_unclaimed_answers(), public.get_latest_unavailable_delivery() from public, anon;
grant execute on function public.get_latest_unavailable_delivery() to authenticated;

select cron.schedule(
  'purge-unclaimed-answers',
  '* * * * *',
  'select public.purge_unclaimed_answers();'
)
where not exists (
  select 1 from cron.job where jobname = 'purge-unclaimed-answers'
);
