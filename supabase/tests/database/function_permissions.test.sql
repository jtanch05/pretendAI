begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(1);

select ok(
  not has_function_privilege('authenticated', 'public.purge_unclaimed_answers()', 'EXECUTE'),
  'players cannot execute the scheduler-only answer-purge function'
);

select * from finish();
rollback;
