-- Keep the oldest-first queue scan ordered without indexing terminal jobs.
create index if not exists question_jobs_matchmaking_queue_idx
  on public.question_jobs (created_at, id)
  where status = 'pending';

-- Accelerate the correlated eligibility check for skips and reports.
create index if not exists question_interactions_matchmaking_eligibility_idx
  on public.question_interactions (question_id, user_id, action, created_at desc)
  where action in ('skipped', 'reported');

-- Find an answerer's live reservation without scanning every reserved job.
create index if not exists question_jobs_active_reservation_idx
  on public.question_jobs (reserved_by, reservation_expires_at)
  where status = 'reserved';
