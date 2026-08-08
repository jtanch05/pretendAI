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
  current_time timestamptz := now();
  deadline timestamptz := now() + interval '120 seconds';
  skip_cooldown interval := coalesce(
    nullif(current_setting('app.skip_question_cooldown', true), '')::interval,
    interval '15 minutes'
  );
begin
  if current_user_id is null then
    raise exception 'Authentication is required';
  end if;

  if exists (
    select 1 from public.question_jobs
    where reserved_by = current_user_id and status = 'reserved' and reservation_expires_at > current_time
  ) then
    raise exception 'You already have an active assignment';
  end if;

  select * into selected_question
  from public.question_jobs
  where status = 'pending'
    and expires_at > current_time
    and asker_id <> current_user_id
    and not exists (
      select 1
      from public.question_interactions
      where question_id = question_jobs.id
        and user_id = current_user_id
        and (
          action = 'reported'
          or (action = 'skipped' and created_at > current_time - skip_cooldown)
        )
    )
  order by created_at asc
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.question_jobs
  set status = 'reserved', reserved_by = current_user_id, reservation_expires_at = deadline
  where id = selected_question.id;

  insert into public.question_interactions (question_id, user_id, action)
  values (selected_question.id, current_user_id, 'assigned');

  return query
  select selected_question.id, question_payloads.text, deadline, current_time
  from public.question_payloads
  where question_payloads.id = selected_question.payload_id;
end;
$$;

revoke all on function public.get_and_reserve_question() from public, anon;
grant execute on function public.get_and_reserve_question() to authenticated;
