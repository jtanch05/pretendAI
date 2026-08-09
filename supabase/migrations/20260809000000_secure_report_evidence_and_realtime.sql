-- Keep evidence captured by the server long enough for a recipient to report a
-- delivered answer, while retaining neither payload indefinitely nor a client
-- supplied copy of it.
create table public.answer_report_evidence (
  answer_id uuid primary key references public.answers (id) on delete cascade,
  evidence_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  purge_after timestamptz not null default (now() + interval '30 days')
);

alter table public.answer_report_evidence enable row level security;
revoke all on table public.answer_report_evidence from public, anon, authenticated;

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

  insert into public.answer_report_evidence (answer_id, evidence_snapshot, purge_after)
  select answer_payloads.answer_id,
    jsonb_strip_nulls(jsonb_build_object(
      'kind', answer_payloads.kind,
      'text', answer_payloads.text,
      'drawing', answer_payloads.drawing_data
    )),
    now() + interval '30 days'
  from public.answer_payloads
  where answer_payloads.answer_id = delivered_answer_id
  on conflict (answer_id) do nothing;

  update public.answers set delivered_at = coalesce(delivered_at, now()), content_deleted_at = coalesce(content_deleted_at, now())
  where id = delivered_answer_id;
  update public.question_jobs set status = 'delivered', content_deleted_at = coalesce(content_deleted_at, now())
  where id = delivered_question_id;
  delete from public.answer_payloads where answer_id = delivered_answer_id;
  delete from public.question_payloads where question_id = delivered_question_id;
end;
$$;

-- Replace the old browser-supplied evidence endpoint. Existing delivered
-- answers without a retained snapshot are intentionally not reportable.
drop function public.report_answer(uuid, text, text);

create function public.report_answer(reported_answer_id uuid, report_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  clean_reason text := btrim(report_reason);
  server_evidence jsonb;
begin
  if current_user_id is null then raise exception 'Authentication is required'; end if;
  if clean_reason is null or char_length(clean_reason) = 0 or char_length(clean_reason) > 500 then
    raise exception 'Report reason must contain between 1 and 500 characters';
  end if;

  select evidence.evidence_snapshot into server_evidence
  from public.answers
  join public.question_jobs on question_jobs.id = answers.question_id
  join public.answer_report_evidence as evidence on evidence.answer_id = answers.id
  where answers.id = reported_answer_id
    and question_jobs.asker_id = current_user_id
    and question_jobs.status = 'delivered'
    and evidence.purge_after > now()
  for update of answers, question_jobs, evidence;

  if not found then raise exception 'This delivered answer is no longer available for reporting'; end if;

  insert into public.reports (id, reporter_id, content_type, content_reference_id, reason, evidence_snapshot)
  values (gen_random_uuid(), current_user_id, 'answer', reported_answer_id, clean_reason, server_evidence::text);
end;
$$;

revoke all on function public.report_answer(uuid, text) from public, anon, authenticated;
grant execute on function public.report_answer(uuid, text) to authenticated;

create or replace function public.purge_moderation_evidence()
returns integer language plpgsql security definer set search_path = public as $$
declare purged integer;
begin
  with purged_reports as (
    update public.reports set evidence_snapshot = '{"purged":true}'
    where evidence_purge_after <= now() and evidence_snapshot <> '{"purged":true}'
    returning id
  ), purged_answer_evidence as (
    delete from public.answer_report_evidence
    where purge_after <= now()
    returning answer_id
  )
  select (select count(*) from purged_reports) + (select count(*) from purged_answer_evidence)
  into purged;
  return purged;
end;
$$;

-- Do not grant players SELECT on question_jobs merely to receive a lifecycle
-- notification. A private Broadcast carries only the status and its policy
-- checks ownership through this boolean SECURITY DEFINER helper.
revoke select on table public.question_jobs from authenticated;
drop policy if exists "participants can observe question lifecycle metadata" on public.question_jobs;
alter publication supabase_realtime drop table public.question_jobs;

create function public.can_receive_question_lifecycle(topic text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.question_jobs
    where ('question-state:' || id::text) = topic
      and asker_id = auth.uid()
  );
$$;

revoke all on function public.can_receive_question_lifecycle(text) from public, anon, authenticated;
grant execute on function public.can_receive_question_lifecycle(text) to authenticated;

create policy "askers can receive question lifecycle broadcasts"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and public.can_receive_question_lifecycle((select realtime.topic()))
);

create function public.broadcast_question_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    perform realtime.send(
      jsonb_build_object('status', new.status),
      'question-lifecycle',
      'question-state:' || new.id::text,
      true
    );
  end if;
  return new;
end;
$$;

revoke all on function public.broadcast_question_lifecycle() from public, anon, authenticated;

create trigger question_jobs_broadcast_lifecycle
after update of status on public.question_jobs
for each row execute function public.broadcast_question_lifecycle();
