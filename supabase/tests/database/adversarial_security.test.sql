begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(7);

select ok(
  not has_table_privilege('authenticated', 'public.question_jobs', 'SELECT'),
  'players cannot read question_jobs directly to receive lifecycle updates'
);

select ok(
  to_regprocedure('public.report_answer(uuid,text,text)') is null,
  'the browser-supplied answer evidence RPC signature is removed'
);

select ok(
  has_function_privilege('authenticated', 'public.report_answer(uuid, text)', 'EXECUTE'),
  'authenticated players can report through the server-evidence RPC'
);

set local session_replication_role = replica;

insert into public.profiles (user_id, credit_balance, status)
values
  ('40000000-0000-0000-0000-000000000001', 1, 'active'),
  ('40000000-0000-0000-0000-000000000002', 1, 'active'),
  ('40000000-0000-0000-0000-000000000003', 1, 'active');

insert into public.question_jobs (id, asker_id, status, created_at, expires_at, response_kind)
values (
  '50000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  'delivered', now(), now() + interval '1 hour', 'text'
);

insert into public.answers (id, question_id, answerer_id, created_at)
values (
  '60000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000002', now()
);

insert into public.answer_report_evidence (answer_id, evidence_snapshot, purge_after)
values (
  '60000000-0000-0000-0000-000000000001',
  '{"kind":"text","text":"Server-captured answer"}'::jsonb,
  now() + interval '1 hour'
);

set local session_replication_role = origin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.report_answer('60000000-0000-0000-0000-000000000001', 'Harmful answer')$$,
  'an answer recipient can submit a report'
);

select is(
  public.can_receive_question_lifecycle('question-state:50000000-0000-0000-0000-000000000001'),
  true,
  'the asker alone can join their lifecycle topic'
);

select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000003', true);

select is(
  public.can_receive_question_lifecycle('question-state:50000000-0000-0000-0000-000000000001'),
  false,
  'another player cannot join that lifecycle topic'
);

reset role;

select results_eq(
  $$select evidence_snapshot::jsonb ->> 'text' from public.reports where content_reference_id = '60000000-0000-0000-0000-000000000001'$$,
  $$values ('Server-captured answer')$$,
  'the report retains the server-captured answer, not browser-provided evidence'
);

select * from finish();
rollback;
