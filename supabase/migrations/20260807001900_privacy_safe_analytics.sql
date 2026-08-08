create table public.operational_events (
  id bigint generated always as identity primary key,
  event_name text not null,
  actor_id uuid references public.profiles (user_id) on delete set null,
  subject_id uuid,
  attributes jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  check (not (attributes ?| array['question_text', 'answer_text']))
);
create index operational_events_name_time on public.operational_events (event_name, occurred_at desc);
alter table public.operational_events enable row level security;
revoke all on public.operational_events from anon, authenticated;

create or replace function public.capture_operational_event() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'profiles' and tg_op = 'INSERT' then insert into public.operational_events(event_name, actor_id, subject_id) values ('player_created', new.user_id, new.user_id); end if;
  if tg_table_name = 'question_jobs' and tg_op = 'INSERT' then insert into public.operational_events(event_name, actor_id, subject_id) values ('question_created', new.asker_id, new.id); end if;
  if tg_table_name = 'question_jobs' and tg_op = 'UPDATE' and old.status is distinct from new.status then insert into public.operational_events(event_name, actor_id, subject_id, attributes) values ('question_' || new.status, coalesce(new.reserved_by, new.asker_id), new.id, jsonb_build_object('from_status', old.status)); end if;
  if tg_table_name = 'answers' and tg_op = 'INSERT' then insert into public.operational_events(event_name, actor_id, subject_id) values ('answer_submitted', new.answerer_id, new.id); end if;
  if tg_table_name = 'answers' and tg_op = 'UPDATE' and old.delivered_at is null and new.delivered_at is not null then insert into public.operational_events(event_name, subject_id) values ('answer_delivered', new.id); end if;
  if tg_table_name = 'answers' and tg_op = 'UPDATE' and old.rating is null and new.rating is not null then insert into public.operational_events(event_name, subject_id, attributes) values ('answer_rated', new.id, jsonb_build_object('rating', new.rating)); end if;
  if tg_table_name = 'question_interactions' and tg_op = 'INSERT' then insert into public.operational_events(event_name, actor_id, subject_id) values ('question_' || new.action, new.user_id, new.question_id); end if;
  if tg_table_name = 'reports' and tg_op = 'INSERT' then insert into public.operational_events(event_name, actor_id, subject_id, attributes) values ('content_reported', new.reporter_id, new.content_reference_id, jsonb_build_object('content_type', new.content_type)); end if;
  if tg_table_name = 'moderation_actions' and tg_op = 'INSERT' then insert into public.operational_events(event_name, actor_id, subject_id, attributes) values ('moderation_resolved', new.moderator_id, new.report_id, jsonb_build_object('action', new.action, 'refunded', new.refunded)); end if;
  if tg_table_name = 'credit_ledger' and tg_op = 'INSERT' then insert into public.operational_events(event_name, actor_id, subject_id, attributes) values ('credit_ledger_posted', new.user_id, new.reference_id, jsonb_build_object('reason', new.reason, 'amount', new.amount)); end if;
  return coalesce(new, old);
end; $$;

create trigger analytics_profile after insert on public.profiles for each row execute function public.capture_operational_event();
create trigger analytics_question after insert or update on public.question_jobs for each row execute function public.capture_operational_event();
create trigger analytics_answer after insert or update on public.answers for each row execute function public.capture_operational_event();
create trigger analytics_interaction after insert on public.question_interactions for each row execute function public.capture_operational_event();
create trigger analytics_report after insert on public.reports for each row execute function public.capture_operational_event();
create trigger analytics_moderation_action after insert on public.moderation_actions for each row execute function public.capture_operational_event();
create trigger analytics_credit_ledger after insert on public.credit_ledger for each row execute function public.capture_operational_event();

create or replace function public.get_operational_metrics()
returns table (event_name text, event_count bigint, latest_at timestamptz) language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'moderator' then raise exception 'Moderator access is required'; end if;
  return query select operational_events.event_name, count(*), max(operational_events.occurred_at) from public.operational_events group by operational_events.event_name order by operational_events.event_name;
end; $$;
revoke all on function public.capture_operational_event(), public.get_operational_metrics() from public, anon;
grant execute on function public.get_operational_metrics() to authenticated;
