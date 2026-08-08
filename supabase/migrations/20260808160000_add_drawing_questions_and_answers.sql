alter table public.question_jobs
  add column response_kind text not null default 'text'
  constraint question_jobs_response_kind_check check (response_kind in ('text', 'drawing'));

create function public.is_valid_drawing(payload jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $$
declare
  stroke jsonb;
  point jsonb;
  total_points integer := 0;
begin
  if jsonb_typeof(payload) <> 'object'
    or payload ->> 'version' <> '1'
    or payload ->> 'width' <> '640'
    or payload ->> 'height' <> '400'
    or jsonb_typeof(payload -> 'strokes') <> 'array'
    or jsonb_array_length(payload -> 'strokes') not between 1 and 300
    or octet_length(payload::text) > 250000
  then return false; end if;

  for stroke in select value from jsonb_array_elements(payload -> 'strokes') loop
    if jsonb_typeof(stroke) <> 'object'
      or jsonb_typeof(stroke -> 'color') <> 'string'
      or (stroke ->> 'color') !~ '^#[0-9A-Fa-f]{6}$'
      or jsonb_typeof(stroke -> 'width') <> 'number'
      or (stroke ->> 'width')::numeric not between 1 and 30
      or jsonb_typeof(stroke -> 'points') <> 'array'
      or jsonb_array_length(stroke -> 'points') not between 1 and 5000
    then return false; end if;

    total_points := total_points + jsonb_array_length(stroke -> 'points');
    if total_points > 5000 then return false; end if;

    for point in select value from jsonb_array_elements(stroke -> 'points') loop
      if jsonb_typeof(point) <> 'object'
        or jsonb_typeof(point -> 'x') <> 'number'
        or jsonb_typeof(point -> 'y') <> 'number'
        or (point ->> 'x')::numeric not between 0 and 640
        or (point ->> 'y')::numeric not between 0 and 400
      then return false; end if;
    end loop;
  end loop;

  return true;
end;
$$;

alter table public.answer_payloads
  drop constraint answer_payloads_text_check,
  alter column text drop not null,
  add column kind text not null default 'text'
    constraint answer_payloads_kind_check check (kind in ('text', 'drawing')),
  add column drawing_data jsonb,
  add constraint answer_payloads_content_check check (
    (
      kind = 'text'
      and text is not null
      and char_length(text) between 1 and 750
      and drawing_data is null
    )
    or
    (
      kind = 'drawing'
      and text is null
      and public.is_valid_drawing(drawing_data)
    )
  );

-- Keep every existing RPC intact for older clients. The app opts into these v2
-- functions only after this additive migration is available.
create function public.create_question_v2(question_text text, requested_kind text default 'text')
returns table (
  question_id uuid,
  credit_balance integer,
  question_status text,
  created_at timestamptz,
  question_kind text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  trimmed_text text := btrim(question_text);
  normalized_kind text := lower(btrim(requested_kind));
  new_question_id uuid := gen_random_uuid();
  new_payload_id uuid := gen_random_uuid();
  current_balance integer;
  request_now timestamptz := now();
begin
  if current_user_id is null then raise exception 'Authentication is required'; end if;
  if trimmed_text is null or char_length(trimmed_text) = 0 or char_length(trimmed_text) > 500 then
    raise exception 'Questions must contain between 1 and 500 characters';
  end if;
  if normalized_kind not in ('text', 'drawing') then raise exception 'Question type is invalid'; end if;

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

  insert into public.question_jobs (id, asker_id, status, response_kind, created_at, expires_at, payload_id)
  values (new_question_id, current_user_id, 'pending', normalized_kind, request_now, request_now + interval '1 hour', new_payload_id);
  insert into public.question_payloads (id, question_id, text, created_at, purge_after)
  values (new_payload_id, new_question_id, trimmed_text, request_now, request_now + interval '1 hour');
  update public.profiles as p
  set credit_balance = p.credit_balance - 1, last_seen_at = request_now
  where p.user_id = current_user_id
  returning p.credit_balance into current_balance;
  insert into public.credit_ledger (user_id, amount, reason, reference_id)
  values (current_user_id, -1, 'question_created', new_question_id);

  return query select new_question_id, current_balance, 'pending'::text, request_now, normalized_kind;
end;
$$;

create function public.get_current_player_state_v2()
returns table (
  credit_balance integer,
  active_question_id uuid,
  active_question_status text,
  active_question_text text,
  active_question_created_at timestamptz,
  active_question_kind text
)
language sql
security definer
set search_path = public
as $$
  select
    profiles.credit_balance,
    question_jobs.id,
    question_jobs.status,
    question_payloads.text,
    question_jobs.created_at,
    question_jobs.response_kind
  from public.profiles
  left join public.question_jobs
    on question_jobs.asker_id = profiles.user_id
    and question_jobs.status in ('pending', 'reserved')
  left join public.question_payloads on question_payloads.id = question_jobs.payload_id
  where profiles.user_id = auth.uid();
$$;

create function public.get_and_reserve_question_v2()
returns table (
  question_id uuid,
  question_text text,
  question_kind text,
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
  select selected_question.id, qp.text, selected_question.response_kind, deadline, request_now
  from public.question_payloads as qp
  where qp.id = selected_question.payload_id;
end;
$$;

create function public.get_current_reservation_v2()
returns table (
  question_id uuid,
  question_text text,
  question_kind text,
  reservation_expires_at timestamptz,
  server_now timestamptz
)
language sql
security definer
set search_path = public
as $$
  select question_jobs.id, question_payloads.text, question_jobs.response_kind,
    question_jobs.reservation_expires_at, now()
  from public.question_jobs
  join public.question_payloads on question_payloads.id = question_jobs.payload_id
  where question_jobs.reserved_by = auth.uid()
    and question_jobs.status = 'reserved'
    and question_jobs.reservation_expires_at > now();
$$;

create function public.submit_answer_v2(
  answer_text text default null,
  answer_kind text default 'text',
  answer_drawing jsonb default null
)
returns table (answer_id uuid, credit_balance integer, accepted_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  trimmed_text text := btrim(answer_text);
  normalized_kind text := lower(btrim(answer_kind));
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
  if normalized_kind not in ('text', 'drawing') then raise exception 'Answer type is invalid'; end if;

  select q.* into active_question
  from public.question_jobs as q
  where q.reserved_by = current_user_id and q.status = 'reserved'
  for update of q;

  if not found
    or active_question.asker_id = current_user_id
    or active_question.reservation_expires_at <= request_now
    or active_question.expires_at <= request_now
  then raise exception 'Your reservation has expired'; end if;
  if normalized_kind <> active_question.response_kind then raise exception 'This question requires a different answer type'; end if;

  if normalized_kind = 'text' then
    if trimmed_text is null or char_length(trimmed_text) = 0 or char_length(trimmed_text) > 750 or answer_drawing is not null then
      raise exception 'Answers must contain between 1 and 750 characters';
    end if;
  elsif trimmed_text is not null
    or answer_drawing is null
    or not public.is_valid_drawing(answer_drawing)
  then raise exception 'Drawing data is invalid'; end if;

  insert into public.answers (id, question_id, answerer_id, created_at, payload_id)
  values (new_answer_id, active_question.id, current_user_id, request_now, new_payload_id);
  insert into public.answer_payloads (id, answer_id, kind, text, drawing_data, created_at, purge_after)
  values (
    new_payload_id,
    new_answer_id,
    normalized_kind,
    case when normalized_kind = 'text' then trimmed_text else null end,
    case when normalized_kind = 'drawing' then answer_drawing else null end,
    request_now,
    request_now + interval '7 days'
  );
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

create function public.retrieve_pending_delivery_v2()
returns table (
  answer_id uuid,
  question_id uuid,
  question_text text,
  question_kind text,
  answer_kind text,
  answer_text text,
  drawing_data jsonb,
  answered_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select answers.id, question_jobs.id, question_payloads.text, question_jobs.response_kind,
    answer_payloads.kind, answer_payloads.text, answer_payloads.drawing_data, answers.created_at
  from public.answers
  join public.question_jobs on question_jobs.id = answers.question_id
  join public.question_payloads on question_payloads.id = question_jobs.payload_id
  join public.answer_payloads on answer_payloads.id = answers.payload_id
  where question_jobs.asker_id = auth.uid()
    and question_jobs.status = 'completed_unclaimed'
  order by answers.created_at asc
  limit 1;
$$;

revoke all on function public.create_question_v2(text, text) from public, anon, authenticated;
revoke all on function public.is_valid_drawing(jsonb) from public, anon, authenticated;
revoke all on function public.get_current_player_state_v2() from public, anon, authenticated;
revoke all on function public.get_and_reserve_question_v2() from public, anon, authenticated;
revoke all on function public.get_current_reservation_v2() from public, anon, authenticated;
revoke all on function public.submit_answer_v2(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.retrieve_pending_delivery_v2() from public, anon, authenticated;

grant execute on function public.create_question_v2(text, text) to authenticated;
grant execute on function public.get_current_player_state_v2() to authenticated;
grant execute on function public.get_and_reserve_question_v2() to authenticated;
grant execute on function public.get_current_reservation_v2() to authenticated;
grant execute on function public.submit_answer_v2(text, text, jsonb) to authenticated;
grant execute on function public.retrieve_pending_delivery_v2() to authenticated;
