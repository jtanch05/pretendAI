create or replace function public.retrieve_pending_delivery()
returns table (answer_id uuid, question_id uuid, question_text text, answer_text text, answered_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select answers.id, question_jobs.id, question_payloads.text, answer_payloads.text, answers.created_at
  from public.answers
  join public.question_jobs on question_jobs.id = answers.question_id
  join public.question_payloads on question_payloads.id = question_jobs.payload_id
  join public.answer_payloads on answer_payloads.id = answers.payload_id
  where question_jobs.asker_id = auth.uid()
    and question_jobs.status = 'completed_unclaimed'
  order by answers.created_at asc
  limit 1;
$$;

create or replace function public.acknowledge_delivery(delivered_answer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  delivered_question_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication is required'; end if;

  select answers.question_id into delivered_question_id
  from public.answers join public.question_jobs on question_jobs.id = answers.question_id
  where answers.id = delivered_answer_id and question_jobs.asker_id = current_user_id
  for update of answers, question_jobs;

  if not found then raise exception 'Delivery was not found'; end if;

  update public.answers set delivered_at = coalesce(delivered_at, now()), content_deleted_at = coalesce(content_deleted_at, now())
  where id = delivered_answer_id;
  update public.question_jobs set status = 'delivered', content_deleted_at = coalesce(content_deleted_at, now())
  where id = delivered_question_id;
  delete from public.answer_payloads where answer_id = delivered_answer_id;
  delete from public.question_payloads where question_id = delivered_question_id;
end;
$$;

revoke all on function public.retrieve_pending_delivery(), public.acknowledge_delivery(uuid) from public;
grant execute on function public.retrieve_pending_delivery(), public.acknowledge_delivery(uuid) to authenticated;
