create or replace function public.expire_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare released_count integer;
begin
  with candidates as (
    select id, reserved_by from public.question_jobs
    where status = 'reserved' and reservation_expires_at <= now()
    for update
  ), expired as (
    update public.question_jobs set status = 'pending', reserved_by = null, reservation_expires_at = null
    from candidates where question_jobs.id = candidates.id
    returning candidates.id, candidates.reserved_by
  ), recorded as (
    insert into public.question_interactions (question_id, user_id, action)
    select id, reserved_by, 'timed_out' from expired where reserved_by is not null
  ) select count(*) into released_count from expired;
  return released_count;
end;
$$;

create or replace function public.get_current_reservation()
returns table (question_id uuid, question_text text, reservation_expires_at timestamptz, server_now timestamptz)
language sql security definer set search_path = public as $$
  select question_jobs.id, question_payloads.text, question_jobs.reservation_expires_at, now()
  from public.question_jobs join public.question_payloads on question_payloads.id = question_jobs.payload_id
  where question_jobs.reserved_by = auth.uid() and question_jobs.status = 'reserved' and question_jobs.reservation_expires_at > now();
$$;
revoke all on function public.expire_reservations(), public.get_current_reservation() from public;
grant execute on function public.get_current_reservation() to authenticated;
