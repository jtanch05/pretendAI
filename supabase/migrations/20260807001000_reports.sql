create table public.reports (
  id uuid primary key default gen_random_uuid(), reporter_id uuid not null references public.profiles (user_id), content_type text not null check (content_type in ('question', 'answer')),
  content_reference_id uuid not null, reason text not null check (char_length(reason) between 1 and 500), evidence_snapshot text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(), resolved_at timestamptz, reviewer_id uuid references public.profiles (user_id)
);
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;

create or replace function public.report_question(report_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare q public.question_jobs%rowtype; evidence text;
begin
  select * into q from public.question_jobs where reserved_by = auth.uid() and status = 'reserved' for update;
  if not found then raise exception 'No assigned question to report'; end if;
  select text into evidence from public.question_payloads where id = q.payload_id;
  insert into public.reports (reporter_id, content_type, content_reference_id, reason, evidence_snapshot) values (auth.uid(), 'question', q.id, report_reason, evidence);
  update public.question_jobs set status = 'pending', reserved_by = null, reservation_expires_at = null where id = q.id;
  insert into public.question_interactions (question_id, user_id, action) values (q.id, auth.uid(), 'reported');
end; $$;

revoke all on function public.report_question(text) from public;
grant execute on function public.report_question(text) to authenticated;
