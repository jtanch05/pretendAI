begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(3);

select ok(
  not has_function_privilege('authenticated', 'public.purge_unclaimed_answers()', 'EXECUTE'),
  'players cannot execute the scheduler-only answer-purge function'
);

select ok(
  not has_function_privilege('anon', 'public.claim_idle_credit()', 'EXECUTE'),
  'anonymous callers cannot claim idle-credit recovery'
);

select ok(
  has_function_privilege('authenticated', 'public.claim_idle_credit()', 'EXECUTE'),
  'authenticated players can claim idle-credit recovery'
);

select * from finish();
rollback;
