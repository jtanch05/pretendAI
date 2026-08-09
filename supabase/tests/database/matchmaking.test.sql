begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(5);

select has_index(
  'public',
  'question_jobs',
  'question_jobs_matchmaking_queue_idx',
  'matchmaking queue has an oldest-first partial index'
);

select has_index(
  'public',
  'question_interactions',
  'question_interactions_matchmaking_eligibility_idx',
  'skip and report eligibility checks have a partial index'
);

select has_index(
  'public',
  'question_jobs',
  'question_jobs_active_reservation_idx',
  'active reservation lookups have a partial index'
);

set local session_replication_role = replica;

insert into public.profiles (user_id, credit_balance, status)
values
  ('10000000-0000-0000-0000-000000000001', 1, 'active'),
  ('10000000-0000-0000-0000-000000000002', 1, 'active'),
  ('10000000-0000-0000-0000-000000000003', 1, 'active');

insert into public.question_jobs (
  id, asker_id, status, created_at, expires_at, payload_id, response_kind
)
values
  (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'pending', now() - interval '3 minutes', now() + interval '1 hour',
    '30000000-0000-0000-0000-000000000001', 'text'
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000003',
    'pending', now() - interval '2 minutes', now() + interval '1 hour',
    '30000000-0000-0000-0000-000000000002', 'text'
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000002',
    'pending', now() - interval '1 minute', now() + interval '1 hour',
    '30000000-0000-0000-0000-000000000003', 'text'
  );

insert into public.question_payloads (id, question_id, text, purge_after)
values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Oldest eligible', now() + interval '1 hour'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Own question', now() + interval '1 hour'),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'Next eligible', now() + interval '1 hour');

set local session_replication_role = origin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);

select results_eq(
  $$select question_id from public.get_and_reserve_question_v2()$$,
  $$values ('20000000-0000-0000-0000-000000000001'::uuid)$$,
  'the oldest eligible question is reserved first'
);

reset role;
set local session_replication_role = replica;
update public.question_jobs
set status = 'pending', reserved_by = null, reservation_expires_at = null
where id = '20000000-0000-0000-0000-000000000001';
delete from public.question_interactions
where question_id = '20000000-0000-0000-0000-000000000001'
  and user_id = '10000000-0000-0000-0000-000000000003';
insert into public.question_interactions (question_id, user_id, action, created_at)
values (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000003',
  'skipped',
  now()
);
set local session_replication_role = origin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);

select results_eq(
  $$select question_id from public.get_and_reserve_question_v2()$$,
  $$values ('20000000-0000-0000-0000-000000000003'::uuid)$$,
  'self-authored and recently skipped questions are excluded'
);

select * from finish();
rollback;
