create or replace function public.create_question(question_text text)
returns table (
  question_id uuid,
  credit_balance integer,
  question_status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  trimmed_text text := btrim(question_text);
  new_question_id uuid := gen_random_uuid();
  new_payload_id uuid := gen_random_uuid();
  current_balance integer;
  request_now timestamptz := now();
begin
  if current_user_id is null then raise exception 'Authentication is required'; end if;
  if trimmed_text is null or char_length(trimmed_text) = 0 or char_length(trimmed_text) > 500 then
    raise exception 'Questions must contain between 1 and 500 characters';
  end if;

  select p.credit_balance into current_balance
  from public.profiles as p
  where p.user_id = current_user_id and p.status = 'active'
  for update of p;

  if not found then raise exception 'An active player profile is required'; end if;
  if current_balance < 1 then raise exception 'You need one credit to ask a question'; end if;
  if exists (
    select 1 from public.question_jobs as q
    where q.asker_id = current_user_id and q.status in ('pending', 'reserved')
  ) then raise exception 'You already have a question waiting for an answer'; end if;

  insert into public.question_jobs (id, asker_id, status, created_at, expires_at, payload_id)
  values (new_question_id, current_user_id, 'pending', request_now, request_now + interval '1 hour', new_payload_id);
  insert into public.question_payloads (id, question_id, text, created_at, purge_after)
  values (new_payload_id, new_question_id, trimmed_text, request_now, request_now + interval '1 hour');
  update public.profiles as p
  set credit_balance = p.credit_balance - 1, last_seen_at = request_now
  where p.user_id = current_user_id
  returning p.credit_balance into current_balance;
  insert into public.credit_ledger (user_id, amount, reason, reference_id)
  values (current_user_id, -1, 'question_created', new_question_id);

  return query select new_question_id, current_balance, 'pending'::text, request_now;
end;
$$;

revoke all on function public.create_question(text) from public, anon, authenticated;
grant execute on function public.create_question(text) to authenticated;
