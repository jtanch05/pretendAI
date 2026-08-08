create or replace function public.get_and_reserve_question()
returns table (
  question_id uuid,
  question_text text,
  reservation_expires_at timestamptz,
  server_now timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  selected_question public.question_jobs%rowtype;
  request_now timestamptz := now();
  deadline timestamptz := request_now + interval '120 seconds';
  skip_cooldown interval := coalesce(
    nullif(current_setting('app.skip_question_cooldown', true), '')::interval,
    interval '15 minutes'
  );
begin
  if current_user_id is null then raise exception 'Authentication is required'; end if;
  if not exists (
    select 1 from public.profiles as p
    where p.user_id = current_user_id and p.status = 'active'
  ) then raise exception 'Your player is restricted'; end if;

  perform public.expire_reservations();

  if exists (
    select 1 from public.question_jobs as q
    where q.reserved_by = current_user_id
      and q.status = 'reserved'
      and q.reservation_expires_at > request_now
  ) then raise exception 'You already have an active assignment'; end if;

  select q.* into selected_question
  from public.question_jobs as q
  where q.status = 'pending'
    and q.expires_at > request_now
    and q.asker_id <> current_user_id
    and not exists (
      select 1 from public.question_interactions as qi
      where qi.question_id = q.id
        and qi.user_id = current_user_id
        and (
          qi.action = 'reported'
          or (qi.action = 'skipped' and qi.created_at > request_now - skip_cooldown)
        )
    )
  order by q.created_at asc
  for update of q skip locked
  limit 1;

  if not found then return; end if;

  update public.question_jobs as q
  set status = 'reserved', reserved_by = current_user_id, reservation_expires_at = deadline
  where q.id = selected_question.id;

  insert into public.question_interactions (question_id, user_id, action)
  values (selected_question.id, current_user_id, 'assigned');

  return query
  select selected_question.id, qp.text, deadline, request_now
  from public.question_payloads as qp
  where qp.id = selected_question.payload_id;
end;
$$;

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

revoke all on function public.get_and_reserve_question() from public, anon, authenticated;
revoke all on function public.submit_answer(text) from public, anon, authenticated;
grant execute on function public.get_and_reserve_question() to authenticated;
grant execute on function public.submit_answer(text) to authenticated;
