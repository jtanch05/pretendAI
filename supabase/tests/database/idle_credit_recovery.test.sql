begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(6);

insert into auth.users (id, email)
values
  ('40000000-0000-0000-0000-000000000001', 'idle-credit-1@example.test'),
  ('40000000-0000-0000-0000-000000000002', 'idle-credit-2@example.test'),
  ('40000000-0000-0000-0000-000000000003', 'idle-credit-3@example.test'),
  ('40000000-0000-0000-0000-000000000004', 'idle-credit-4@example.test'),
  ('40000000-0000-0000-0000-000000000005', 'idle-credit-5@example.test');

set local session_replication_role = replica;

insert into public.profiles (user_id, credit_balance, status, zero_credit_since)
values
  ('40000000-0000-0000-0000-000000000001', 1, 'active', null),
  ('40000000-0000-0000-0000-000000000002', 0, 'active', now() - interval '4 minutes 59 seconds'),
  ('40000000-0000-0000-0000-000000000003', 0, 'active', now() - interval '5 minutes'),
  ('40000000-0000-0000-0000-000000000004', 1, 'active', null),
  ('40000000-0000-0000-0000-000000000005', 0, 'restricted', now() - interval '10 minutes');

set local session_replication_role = origin;

update public.profiles
set credit_balance = 0
where user_id = '40000000-0000-0000-0000-000000000001';

select ok(
  (select zero_credit_since is not null from public.profiles where user_id = '40000000-0000-0000-0000-000000000001'),
  'the balance trigger starts a recovery window when a player reaches zero credits'
);

set local role authenticated;

select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000002', true);
select results_eq(
  $$select credit_balance, credit_awarded from public.claim_idle_credit()$$,
  $$values (0, false)$$,
  'a player must remain at zero for the full five minutes'
);

select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000003', true);
select results_eq(
  $$select credit_balance, credit_awarded from public.claim_idle_credit()$$,
  $$values (1, true)$$,
  'an eligible active player receives one recovery credit'
);
select results_eq(
  $$select credit_balance, credit_awarded from public.claim_idle_credit()$$,
  $$values (1, false)$$,
  'calling the recovery RPC again cannot award another credit'
);

reset role;

select is(
  (select count(*)::integer from public.credit_ledger where user_id = '40000000-0000-0000-0000-000000000003' and reason = 'idle_credit_recovery'),
  1,
  'a recovery window posts exactly one ledger entry'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000005', true);
select results_eq(
  $$select credit_balance, credit_awarded from public.claim_idle_credit()$$,
  $$values (0, false)$$,
  'restricted players cannot receive recovery credits'
);

select * from finish();
rollback;
