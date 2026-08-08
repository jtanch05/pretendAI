alter table public.reports add column evidence_purge_after timestamptz not null default (now() + interval '30 days');

create or replace function public.purge_moderation_evidence()
returns integer language plpgsql security definer set search_path = public as $$
declare purged integer;
begin
  with updated as (
    update public.reports set evidence_snapshot = '{"purged":true}'
    where evidence_purge_after <= now() and evidence_snapshot <> '{"purged":true}'
    returning id
  ) select count(*) into purged from updated;
  return purged;
end; $$;
revoke all on function public.purge_moderation_evidence() from public, anon, authenticated;
select cron.schedule('purge-moderation-evidence', '* * * * *', 'select public.purge_moderation_evidence();')
where not exists (select 1 from cron.job where jobname = 'purge-moderation-evidence');
