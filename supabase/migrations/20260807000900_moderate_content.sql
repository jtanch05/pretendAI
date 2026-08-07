create table public.moderation_decisions (
  id uuid primary key default gen_random_uuid(), content_type text not null check (content_type in ('question', 'answer')),
  content_reference_id uuid not null, outcome text not null check (outcome in ('allow', 'reject', 'quarantine')),
  reason text, created_at timestamptz not null default now()
);
alter table public.moderation_decisions enable row level security;
revoke all on public.moderation_decisions from anon, authenticated;

create or replace function public.check_content_safety(content_text text, content_kind text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if content_kind not in ('question', 'answer') then raise exception 'Invalid content type'; end if;
  if lower(content_text) ~ '(grooming|doxx|kill yourself|credit card number)' then return 'reject'; end if;
  return 'allow';
end; $$;
grant execute on function public.check_content_safety(text, text) to authenticated;

create or replace function public.enforce_question_safety()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.check_content_safety(new.text, 'question') <> 'allow' then raise exception 'This question cannot be shared'; end if;
  return new;
end; $$;
create or replace function public.enforce_answer_safety()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.check_content_safety(new.text, 'answer') <> 'allow' then raise exception 'This answer cannot be shared'; end if;
  return new;
end; $$;
create trigger moderate_question_before_queue before insert on public.question_payloads for each row execute function public.enforce_question_safety();
create trigger moderate_answer_before_delivery before insert on public.answer_payloads for each row execute function public.enforce_answer_safety();
