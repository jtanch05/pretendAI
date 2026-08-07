alter table public.profiles add column answer_count integer not null default 0;
alter table public.profiles add column like_count integer not null default 0;
alter table public.profiles add column dislike_count integer not null default 0;

create or replace function public.rate_answer(rated_answer_id uuid, rating_value text)
returns void
language plpgsql security definer set search_path = public as $$
declare answerer uuid;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if rating_value not in ('like', 'dislike') then raise exception 'Invalid rating'; end if;
  select answers.answerer_id into answerer from public.answers
  join public.question_jobs on question_jobs.id = answers.question_id
  where answers.id = rated_answer_id and question_jobs.asker_id = auth.uid() and question_jobs.status = 'delivered'
  for update of answers;
  if not found then raise exception 'Delivered answer was not found'; end if;
  update public.answers set rating = rating_value where id = rated_answer_id and rating is null;
  if not found then raise exception 'This answer has already been rated'; end if;
  update public.profiles set like_count = like_count + case when rating_value = 'like' then 1 else 0 end,
    dislike_count = dislike_count + case when rating_value = 'dislike' then 1 else 0 end where user_id = answerer;
end; $$;
revoke all on function public.rate_answer(uuid, text) from public;
grant execute on function public.rate_answer(uuid, text) to authenticated;
