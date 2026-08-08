-- The platform grants EXECUTE to anon when functions are created. Restrict
-- SECURITY DEFINER functions to their intended callers after all definitions.
revoke all on function public.create_profile_with_starter_credit() from public, anon, authenticated;
revoke all on function public.create_question(text) from public, anon, authenticated;
revoke all on function public.get_current_player_state() from public, anon, authenticated;
revoke all on function public.get_and_reserve_question() from public, anon, authenticated;
revoke all on function public.submit_answer(text) from public, anon, authenticated;
revoke all on function public.retrieve_pending_delivery() from public, anon, authenticated;
revoke all on function public.acknowledge_delivery(uuid) from public, anon, authenticated;
revoke all on function public.skip_question() from public, anon, authenticated;
revoke all on function public.expire_reservations() from public, anon, authenticated;
revoke all on function public.get_current_reservation() from public, anon, authenticated;
revoke all on function public.expire_questions() from public, anon, authenticated;
revoke all on function public.rate_answer(uuid, text) from public, anon, authenticated;
revoke all on function public.check_content_safety(text, text) from public, anon, authenticated;
revoke all on function public.enforce_question_safety() from public, anon, authenticated;
revoke all on function public.enforce_answer_safety() from public, anon, authenticated;
revoke all on function public.report_question(text) from public, anon, authenticated;

grant execute on function public.create_profile_with_starter_credit() to authenticated;
grant execute on function public.create_question(text) to authenticated;
grant execute on function public.get_current_player_state() to authenticated;
grant execute on function public.get_and_reserve_question() to authenticated;
grant execute on function public.submit_answer(text) to authenticated;
grant execute on function public.retrieve_pending_delivery() to authenticated;
grant execute on function public.acknowledge_delivery(uuid) to authenticated;
grant execute on function public.skip_question() to authenticated;
grant execute on function public.get_current_reservation() to authenticated;
grant execute on function public.rate_answer(uuid, text) to authenticated;
grant execute on function public.report_question(text) to authenticated;
