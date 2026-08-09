-- Content retention is a scheduler-only maintenance task, not a player RPC.
revoke all on function public.purge_unclaimed_answers() from public, anon, authenticated;
