-- This is an internal DDL event-trigger helper, never an API callable by players.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
