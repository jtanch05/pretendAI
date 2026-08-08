-- A reservation may have been created before the asker exclusion was deployed.
-- Never allow that reservation to be submitted by its own asker.
create or replace function public.submit_answer(answer_text text)
returns table (answer_id uuid, credit_balance integer, accepted_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  trimmed_text text := btrim(answer_text);
  active_question public.question_jobs%rowtype;
  new_answer_id uuid := gen_random_uuid();
  new_payload_id uuid := gen_random_uuid();
  request_now timestamptz := now();
  current_balance integer;
begin
  if current_user_id is null then raise exception 'Authentication is required'; end if;
  if not exists (
    select 1 from public.profiles as p
    where p.user_id = current_user_id and p.status = 'active'
  ) then raise exception 'Your player is restricted'; end if;
  if trimmed_text is null or char_length(trimmed_text) = 0 or char_length(trimmed_text) > 750 then
    raise exception 'Answers must contain between 1 and 750 characters';
  end if;

  select q.* into active_question
  from public.question_jobs as q
  where q.reserved_by = current_user_id and q.status = 'reserved'
  for update of q;

  if not found
    or active_question.asker_id = current_user_id
    or active_question.reservation_expires_at <= request_now
    or active_question.expires_at <= request_now
  then raise exception 'Your reservation has expired'; end if;

  insert into public.answers (id, question_id, answerer_id, created_at, payload_id)
  values (new_answer_id, active_question.id, current_user_id, request_now, new_payload_id);
  insert into public.answer_payloads (id, answer_id, text, created_at, purge_after)
  values (new_payload_id, new_answer_id, trimmed_text, request_now, request_now + interval '7 days');
  update public.question_jobs as q set status = 'completed_unclaimed' where q.id = active_question.id;
  update public.profiles as p
  set credit_balance = p.credit_balance + 1, last_seen_at = request_now
  where p.user_id = current_user_id
  returning p.credit_balance into current_balance;
  insert into public.credit_ledger (user_id, amount, reason, reference_id)
  values (current_user_id, 1, 'answer_submitted', new_answer_id);

  return query select new_answer_id, current_balance, request_now;
end;
$$;

revoke all on function public.submit_answer(text) from public, anon, authenticated;
grant execute on function public.submit_answer(text) to authenticated;
