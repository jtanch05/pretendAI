-- Replace this deterministic adapter with a provider-backed implementation in
-- production without changing the queueing or delivery functions.
create or replace function public.content_safety_outcome(content_text text, content_kind text)
returns text
language plpgsql
security invoker
set search_path = public
as $$
begin
  if content_kind not in ('question', 'answer') then
    raise exception 'Invalid content type';
  end if;
  if lower(content_text) ~ '(grooming|doxx|kill yourself|credit card number)' then
    return 'reject';
  end if;
  if lower(content_text) ~ '(phone number|email address|home address|meet me at)' then
    return 'quarantine';
  end if;
  return 'allow';
end;
$$;

create or replace function public.check_content_safety(content_text text, content_kind text)
returns text
language sql
security invoker
set search_path = public
as $$
  select public.content_safety_outcome(content_text, content_kind);
$$;

create or replace function public.enforce_question_safety()
returns trigger language plpgsql security definer set search_path = public as $$
declare outcome text;
begin
  outcome := public.check_content_safety(new.text, 'question');
  if outcome <> 'allow' then
    if outcome = 'quarantine' then
      raise exception 'This question needs review before it can be shared';
    end if;
    raise exception 'This question cannot be shared';
  end if;
  return new;
end; $$;

create or replace function public.enforce_answer_safety()
returns trigger language plpgsql security definer set search_path = public as $$
declare outcome text;
begin
  outcome := public.check_content_safety(new.text, 'answer');
  if outcome <> 'allow' then
    if outcome = 'quarantine' then
      raise exception 'This answer needs review before it can be delivered';
    end if;
    raise exception 'This answer cannot be delivered';
  end if;
  return new;
end; $$;

revoke all on function public.content_safety_outcome(text, text), public.check_content_safety(text, text), public.enforce_question_safety(), public.enforce_answer_safety() from public, anon, authenticated;
