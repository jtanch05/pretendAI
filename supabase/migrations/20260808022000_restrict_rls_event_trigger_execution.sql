-- This helper exists on hosted projects that enable the RLS event trigger, but
-- may be absent when the migrations are replayed on a fresh local database.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;
