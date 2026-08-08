-- Moderator authorization is intentionally based on non-user-editable Auth
-- app_metadata. Grant {"role":"moderator"} through a trusted admin workflow,
-- then require the user to refresh their session before opening the console.
create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null unique references public.reports (id) on delete cascade,
  moderator_id uuid not null references public.profiles (user_id),
  action text not null check (action in ('dismiss', 'remove_content', 'restrict_identity', 'remove_and_restrict')),
  refunded boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.moderation_actions enable row level security;
revoke all on public.moderation_actions from anon, authenticated;

create or replace function public.report_question(report_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid(); q public.question_jobs%rowtype; evidence text; clean_reason text := btrim(report_reason);
begin
  if current_user_id is null then raise exception 'Authentication is required'; end if;
  if clean_reason is null or char_length(clean_reason) not between 1 and 500 then raise exception 'Give a report reason between 1 and 500 characters'; end if;
  select * into q from public.question_jobs where reserved_by = current_user_id and status = 'reserved' for update;
  if not found then raise exception 'No assigned question to report'; end if;
  select text into evidence from public.question_payloads where id = q.payload_id;
  if evidence is null then raise exception 'The assigned question is no longer available'; end if;
  insert into public.reports (reporter_id, content_type, content_reference_id, reason, evidence_snapshot)
  values (current_user_id, 'question', q.id, clean_reason, json_build_object('question_text', evidence)::text);
  update public.question_jobs set status = 'pending', reserved_by = null, reservation_expires_at = null where id = q.id;
  insert into public.question_interactions (question_id, user_id, action) values (q.id, current_user_id, 'reported');
end; $$;

create or replace function public.report_answer(reported_answer_id uuid, report_reason text, answer_evidence text)
returns void language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid(); clean_reason text := btrim(report_reason); clean_evidence text := btrim(answer_evidence);
begin
  if current_user_id is null then raise exception 'Authentication is required'; end if;
  if clean_reason is null or char_length(clean_reason) not between 1 and 500 then raise exception 'Give a report reason between 1 and 500 characters'; end if;
  if clean_evidence is null or char_length(clean_evidence) not between 1 and 750 then raise exception 'The saved answer evidence is invalid'; end if;
  perform 1 from public.answers
  join public.question_jobs on question_jobs.id = answers.question_id
  where answers.id = reported_answer_id and question_jobs.asker_id = current_user_id and question_jobs.status = 'delivered'
  for key share of answers, question_jobs;
  if not found then raise exception 'This saved answer cannot be reported by this player'; end if;
  insert into public.reports (reporter_id, content_type, content_reference_id, reason, evidence_snapshot)
  values (current_user_id, 'answer', reported_answer_id, clean_reason, json_build_object('answer_text', clean_evidence)::text);
end; $$;

create or replace function public.get_open_reports()
returns table (report_id uuid, content_type text, reason text, evidence_snapshot text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'moderator' then
    raise exception 'Moderator access is required';
  end if;
  return query select reports.id, reports.content_type, reports.reason, reports.evidence_snapshot, reports.created_at
  from public.reports where reports.status = 'open' order by reports.created_at asc;
end; $$;

create or replace function public.resolve_report(report_to_resolve uuid, resolution_action text, refund_asker boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare moderator_id uuid := auth.uid(); report_row public.reports%rowtype; target_question_id uuid; target_identity uuid; refunded_now boolean := false;
begin
  if moderator_id is null or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'moderator' then
    raise exception 'Moderator access is required';
  end if;
  if resolution_action not in ('dismiss', 'remove_content', 'restrict_identity', 'remove_and_restrict') then
    raise exception 'Invalid moderation action';
  end if;
  select * into report_row from public.reports where id = report_to_resolve and status = 'open' for update;
  if not found then raise exception 'This report is already resolved or unavailable'; end if;

  if report_row.content_type = 'question' then
    select id, asker_id into target_question_id, target_identity from public.question_jobs where id = report_row.content_reference_id for update;
  else
    select question_jobs.id, answers.answerer_id into target_question_id, target_identity
    from public.answers join public.question_jobs on question_jobs.id = answers.question_id
    where answers.id = report_row.content_reference_id for update of answers, question_jobs;
  end if;
  if target_question_id is null or target_identity is null then raise exception 'The reported content is no longer available'; end if;

  if resolution_action in ('remove_content', 'remove_and_restrict') then
    delete from public.answer_payloads where answer_id in (select id from public.answers where question_id = target_question_id);
    delete from public.question_payloads where question_id = target_question_id;
    update public.answers set content_deleted_at = coalesce(content_deleted_at, now()) where question_id = target_question_id;
    update public.question_jobs set status = 'removed', content_deleted_at = coalesce(content_deleted_at, now()), payload_id = null,
      reserved_by = null, reservation_expires_at = null where id = target_question_id;
  end if;

  if resolution_action in ('restrict_identity', 'remove_and_restrict') then
    update public.profiles set status = 'restricted' where user_id = target_identity;
  end if;

  if refund_asker and resolution_action in ('remove_content', 'remove_and_restrict') then
    with inserted_refund as (
      insert into public.credit_ledger (user_id, amount, reason, reference_id)
      select asker_id, 1, 'moderation_refund', id from public.question_jobs where id = target_question_id
      on conflict do nothing returning user_id
    )
    update public.profiles set credit_balance = credit_balance + 1
    where user_id in (select user_id from inserted_refund);
    refunded_now := found;
  end if;

  update public.reports set status = 'resolved', resolved_at = now(), reviewer_id = moderator_id where id = report_row.id;
  insert into public.moderation_actions (report_id, moderator_id, action, refunded)
  values (report_row.id, moderator_id, resolution_action, refunded_now);
end; $$;

create or replace function public.get_and_reserve_question()
returns table (question_id uuid, question_text text, reservation_expires_at timestamptz, server_now timestamptz)
language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid(); selected_question public.question_jobs%rowtype; current_time timestamptz := now(); deadline timestamptz := now() + interval '120 seconds';
  skip_cooldown interval := coalesce(nullif(current_setting('app.skip_question_cooldown', true), '')::interval, interval '15 minutes');
begin
  if current_user_id is null then raise exception 'Authentication is required'; end if;
  if not exists (select 1 from public.profiles where user_id = current_user_id and status = 'active') then raise exception 'Your player is restricted'; end if;
  perform public.expire_reservations();
  if exists (select 1 from public.question_jobs where reserved_by = current_user_id and status = 'reserved' and reservation_expires_at > current_time) then raise exception 'You already have an active assignment'; end if;
  select * into selected_question from public.question_jobs
  where status = 'pending' and expires_at > current_time and asker_id <> current_user_id
    and not exists (select 1 from public.question_interactions where question_id = question_jobs.id and user_id = current_user_id and (action = 'reported' or (action = 'skipped' and created_at > current_time - skip_cooldown)))
  order by created_at asc for update skip locked limit 1;
  if not found then return; end if;
  update public.question_jobs set status = 'reserved', reserved_by = current_user_id, reservation_expires_at = deadline where id = selected_question.id;
  insert into public.question_interactions (question_id, user_id, action) values (selected_question.id, current_user_id, 'assigned');
  return query select selected_question.id, question_payloads.text, deadline, current_time from public.question_payloads where question_payloads.id = selected_question.payload_id;
end; $$;

create or replace function public.submit_answer(answer_text text)
returns table (answer_id uuid, credit_balance integer, accepted_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid(); trimmed_text text := btrim(answer_text); active_question public.question_jobs%rowtype;
  new_answer_id uuid := gen_random_uuid(); new_payload_id uuid := gen_random_uuid(); current_time timestamptz := now(); current_balance integer;
begin
  if current_user_id is null then raise exception 'Authentication is required'; end if;
  if not exists (select 1 from public.profiles where user_id = current_user_id and status = 'active') then raise exception 'Your player is restricted'; end if;
  if trimmed_text is null or char_length(trimmed_text) = 0 or char_length(trimmed_text) > 750 then raise exception 'Answers must contain between 1 and 750 characters'; end if;
  select * into active_question from public.question_jobs where reserved_by = current_user_id and status = 'reserved' for update;
  if not found or active_question.reservation_expires_at <= current_time or active_question.expires_at <= current_time then raise exception 'Your reservation has expired'; end if;
  insert into public.answers (id, question_id, answerer_id, created_at, payload_id) values (new_answer_id, active_question.id, current_user_id, current_time, new_payload_id);
  insert into public.answer_payloads (id, answer_id, text, created_at, purge_after) values (new_payload_id, new_answer_id, trimmed_text, current_time, current_time + interval '7 days');
  update public.question_jobs set status = 'completed_unclaimed' where id = active_question.id;
  update public.profiles set credit_balance = credit_balance + 1, last_seen_at = current_time where user_id = current_user_id returning profiles.credit_balance into current_balance;
  insert into public.credit_ledger (user_id, amount, reason, reference_id) values (current_user_id, 1, 'answer_submitted', new_answer_id);
  return query select new_answer_id, current_balance, current_time;
end; $$;

revoke all on function public.report_question(text), public.report_answer(uuid, text, text), public.get_open_reports(), public.resolve_report(uuid, text, boolean) from public, anon;
grant execute on function public.report_question(text), public.report_answer(uuid, text, text) to authenticated;
grant execute on function public.get_open_reports(), public.resolve_report(uuid, text, boolean) to authenticated;
