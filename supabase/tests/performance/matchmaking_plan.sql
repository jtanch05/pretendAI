begin;

set local statement_timeout = '60s';
set local session_replication_role = replica;

insert into public.profiles (user_id, credit_balance, status)
select md5('matchmaking-benchmark-user-' || value)::uuid, 1, 'active'
from generate_series(1, 100001) as value;

insert into public.question_jobs (
  id, asker_id, status, created_at, expires_at, response_kind
)
select
  md5('matchmaking-benchmark-question-' || value)::uuid,
  md5('matchmaking-benchmark-user-' || value)::uuid,
  'pending',
  now() - (100001 - value) * interval '1 second',
  now() + interval '1 hour',
  'text'
from generate_series(1, 100000) as value;

insert into public.question_interactions (question_id, user_id, action, created_at)
select
  md5('matchmaking-benchmark-question-' || value)::uuid,
  md5('matchmaking-benchmark-user-100001')::uuid,
  'skipped',
  now()
from generate_series(1, 100) as value;

set local session_replication_role = origin;
analyze public.question_jobs;
analyze public.question_interactions;

drop index public.question_jobs_matchmaking_queue_idx;
drop index public.question_interactions_matchmaking_eligibility_idx;

select 'BASELINE_WITHOUT_MATCHMAKING_INDEXES' as benchmark_stage;
explain (analyze, buffers, format text)
select q.id
from public.question_jobs as q
where q.status = 'pending'
  and q.expires_at > now()
  and q.asker_id <> md5('matchmaking-benchmark-user-100001')::uuid
  and not exists (
    select 1
    from public.question_interactions as qi
    where qi.question_id = q.id
      and qi.user_id = md5('matchmaking-benchmark-user-100001')::uuid
      and (
        qi.action = 'reported'
        or (qi.action = 'skipped' and qi.created_at > now() - interval '15 minutes')
      )
  )
order by q.created_at asc
for update of q skip locked
limit 1;

create index question_jobs_matchmaking_queue_idx
  on public.question_jobs (created_at, id)
  where status = 'pending';
create index question_interactions_matchmaking_eligibility_idx
  on public.question_interactions (question_id, user_id, action, created_at desc)
  where action in ('skipped', 'reported');

analyze public.question_jobs;
analyze public.question_interactions;

select 'OPTIMIZED_WITH_MATCHMAKING_INDEXES' as benchmark_stage;
explain (analyze, buffers, format text)
select q.id
from public.question_jobs as q
where q.status = 'pending'
  and q.expires_at > now()
  and q.asker_id <> md5('matchmaking-benchmark-user-100001')::uuid
  and not exists (
    select 1
    from public.question_interactions as qi
    where qi.question_id = q.id
      and qi.user_id = md5('matchmaking-benchmark-user-100001')::uuid
      and (
        qi.action = 'reported'
        or (qi.action = 'skipped' and qi.created_at > now() - interval '15 minutes')
      )
  )
order by q.created_at asc
for update of q skip locked
limit 1;

rollback;
