create table public.rate_limit_events (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles (user_id) on delete cascade,
  action text not null,
  occurred_at timestamptz not null default now()
);
create index rate_limit_events_actor_action_time on public.rate_limit_events (actor_id, action, occurred_at desc);
alter table public.rate_limit_events enable row level security;
revoke all on public.rate_limit_events from anon, authenticated;

create or replace function public.enforce_mutation_rate_limit(action_name text, maximum integer, period interval)
returns void language plpgsql security definer set search_path = public as $$
declare current_actor uuid := auth.uid(); attempts integer;
begin
  if current_actor is null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(current_actor::text || ':' || action_name, 0));
  select count(*) into attempts from public.rate_limit_events where rate_limit_events.actor_id = current_actor and action = action_name and occurred_at > now() - period;
  if attempts >= maximum then
    raise log 'rate_limit_rejected actor=% action=% attempts=%', current_actor, action_name, attempts;
    raise exception 'Too many % requests. Please try again later.', replace(action_name, '_', ' ');
  end if;
  insert into public.rate_limit_events (actor_id, action) values (current_actor, action_name);
end; $$;

create or replace function public.limit_question_creation() returns trigger language plpgsql security definer set search_path = public as $$ begin perform public.enforce_mutation_rate_limit('question_creation', 3, interval '1 hour'); return new; end; $$;
create or replace function public.limit_answer_submission() returns trigger language plpgsql security definer set search_path = public as $$ begin perform public.enforce_mutation_rate_limit('answer_submission', 10, interval '1 hour'); return new; end; $$;
create or replace function public.limit_question_interaction() returns trigger language plpgsql security definer set search_path = public as $$ begin if new.action in ('assigned','skipped','reported') then perform public.enforce_mutation_rate_limit('interaction_' || new.action, case new.action when 'assigned' then 20 when 'skipped' then 10 else 10 end, case new.action when 'assigned' then interval '1 minute' else interval '1 hour' end); end if; return new; end; $$;
create or replace function public.limit_answer_mutation() returns trigger language plpgsql security definer set search_path = public as $$ begin if old.delivered_at is null and new.delivered_at is not null then perform public.enforce_mutation_rate_limit('acknowledgment', 20, interval '1 hour'); end if; if old.rating is null and new.rating is not null then perform public.enforce_mutation_rate_limit('rating', 20, interval '1 hour'); end if; return new; end; $$;
create or replace function public.limit_report_creation() returns trigger language plpgsql security definer set search_path = public as $$ begin perform public.enforce_mutation_rate_limit('reporting', 10, interval '1 hour'); return new; end; $$;

create trigger abuse_limit_question_creation before insert on public.question_jobs for each row execute function public.limit_question_creation();
create trigger abuse_limit_answer_submission before insert on public.answers for each row execute function public.limit_answer_submission();
create trigger abuse_limit_interaction before insert on public.question_interactions for each row execute function public.limit_question_interaction();
create trigger abuse_limit_answer_update before update on public.answers for each row execute function public.limit_answer_mutation();
create trigger abuse_limit_report before insert on public.reports for each row execute function public.limit_report_creation();

revoke all on function public.enforce_mutation_rate_limit(text, integer, interval), public.limit_question_creation(), public.limit_answer_submission(), public.limit_question_interaction(), public.limit_answer_mutation(), public.limit_report_creation() from public, anon, authenticated;
