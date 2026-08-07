create or replace function public.skip_question()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare current_user_id uuid := auth.uid(); active_question_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication is required'; end if;
  select id into active_question_id from public.question_jobs
  where reserved_by = current_user_id and status = 'reserved' and reservation_expires_at > now()
  for update;
  if not found then raise exception 'No active reservation to skip'; end if;
  update public.question_jobs set status = 'pending', reserved_by = null, reservation_expires_at = null where id = active_question_id;
  insert into public.question_interactions (question_id, user_id, action) values (active_question_id, current_user_id, 'skipped');
end;
$$;

revoke all on function public.skip_question() from public;
grant execute on function public.skip_question() to authenticated;
