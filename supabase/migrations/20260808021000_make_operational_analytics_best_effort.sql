-- Telemetry is useful for release monitoring, but a telemetry failure must
-- never prevent a player from asking, answering, rating, or reporting.
create or replace function public.capture_operational_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_row jsonb := to_jsonb(new);
  old_row jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
begin
  case tg_table_name
    when 'profiles' then
      insert into public.operational_events (event_name, actor_id, subject_id)
      values ('player_created', (new_row ->> 'user_id')::uuid, (new_row ->> 'user_id')::uuid);

    when 'question_jobs' then
      if tg_op = 'INSERT' then
        insert into public.operational_events (event_name, actor_id, subject_id)
        values ('question_created', (new_row ->> 'asker_id')::uuid, (new_row ->> 'id')::uuid);
      elsif old_row ->> 'status' is distinct from new_row ->> 'status' then
        insert into public.operational_events (event_name, actor_id, subject_id, attributes)
        values (
          'question_' || (new_row ->> 'status'),
          coalesce((new_row ->> 'reserved_by')::uuid, (new_row ->> 'asker_id')::uuid),
          (new_row ->> 'id')::uuid,
          jsonb_build_object('from_status', old_row ->> 'status')
        );
      end if;

    when 'answers' then
      if tg_op = 'INSERT' then
        insert into public.operational_events (event_name, actor_id, subject_id)
        values ('answer_submitted', (new_row ->> 'answerer_id')::uuid, (new_row ->> 'id')::uuid);
      else
        if old_row ->> 'delivered_at' is null and new_row ->> 'delivered_at' is not null then
          insert into public.operational_events (event_name, subject_id)
          values ('answer_delivered', (new_row ->> 'id')::uuid);
        end if;

        if old_row ->> 'rating' is null and new_row ->> 'rating' is not null then
          insert into public.operational_events (event_name, subject_id, attributes)
          values (
            'answer_rated',
            (new_row ->> 'id')::uuid,
            jsonb_build_object('rating', new_row ->> 'rating')
          );
        end if;
      end if;

    when 'question_interactions' then
      insert into public.operational_events (event_name, actor_id, subject_id)
      values (
        'question_' || (new_row ->> 'action'),
        (new_row ->> 'user_id')::uuid,
        (new_row ->> 'question_id')::uuid
      );

    when 'reports' then
      insert into public.operational_events (event_name, actor_id, subject_id, attributes)
      values (
        'content_reported',
        (new_row ->> 'reporter_id')::uuid,
        (new_row ->> 'content_reference_id')::uuid,
        jsonb_build_object('content_type', new_row ->> 'content_type')
      );

    when 'moderation_actions' then
      insert into public.operational_events (event_name, actor_id, subject_id, attributes)
      values (
        'moderation_resolved',
        (new_row ->> 'moderator_id')::uuid,
        (new_row ->> 'report_id')::uuid,
        jsonb_build_object(
          'action', new_row ->> 'action',
          'refunded', (new_row ->> 'refunded')::boolean
        )
      );

    when 'credit_ledger' then
      insert into public.operational_events (event_name, actor_id, subject_id, attributes)
      values (
        'credit_ledger_posted',
        (new_row ->> 'user_id')::uuid,
        (new_row ->> 'reference_id')::uuid,
        jsonb_build_object(
          'reason', new_row ->> 'reason',
          'amount', (new_row ->> 'amount')::integer
        )
      );
  end case;

  return new;
exception when others then
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.capture_operational_event() from public, anon, authenticated;
