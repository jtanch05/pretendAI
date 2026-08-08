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

  if not exists (
    select 1
    from public.profiles as p
    where p.user_id = current_user_id
      and p.status = 'active'
  ) then
    raise exception 'Your player is restricted';
  end if;

  perform public.expire_reservations();

  if exists (
    select 1
    from public.question_jobs as q
    where q.reserved_by = current_user_id
      and q.status = 'reserved'
      and q.reservation_expires_at > current_time
  ) then
    raise exception 'You already have an active assignment';
  end if;

  select q.*
  into selected_question
  from public.question_jobs as q
  where q.status = 'pending'
    and q.expires_at > current_time
    and q.asker_id <> current_user_id
    and not exists (
      select 1
      from public.question_interactions as qi
      where qi.question_id = q.id
        and qi.user_id = current_user_id
        and (
          qi.action = 'reported'
          or (qi.action = 'skipped' and qi.created_at > current_time - skip_cooldown)
        )
    )
  order by q.created_at asc
  for update of q skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.question_jobs as q
  set status = 'reserved',
      reserved_by = current_user_id,
      reservation_expires_at = deadline
  where q.id = selected_question.id;

  insert into public.question_interactions (question_id, user_id, action)
  values (selected_question.id, current_user_id, 'assigned');

  return query
  select selected_question.id, qp.text, deadline, current_time
  from public.question_payloads as qp
  where qp.id = selected_question.payload_id;
end;
$$;

revoke all on function public.get_and_reserve_question() from public, anon, authenticated;
grant execute on function public.get_and_reserve_question() to authenticated;
