-- Realtime only exposes question lifecycle metadata to its owner or current answerer.
grant select on table public.question_jobs to authenticated;

create policy "participants can observe question lifecycle metadata"
on public.question_jobs
for select
to authenticated
using (
  asker_id = (select auth.uid())
  or reserved_by = (select auth.uid())
);

alter publication supabase_realtime add table public.question_jobs;
