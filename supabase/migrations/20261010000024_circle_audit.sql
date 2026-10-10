-- 10 Oct 2026: log circle creation, deletion and admins' direct edits in audit_log (Settings, Activity).
-- Edge functions (approve, reschedule, end, move licence...) already log their own actions and run as the service role,
-- so edits are only logged here when a signed-in admin makes them from the dashboard.
create or replace function public.circles_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  who text := coalesce(nullif(auth.jwt() ->> 'email', ''), case when auth.role() = 'service_role' then 'system' else current_user end);
  changes jsonb := '{}'::jsonb;
  k text;
  watched text[] := array['name', 'weekday', 'start_time', 'duration_min', 'timezone', 'language', 'circle_type', 'facilitator_id',
                          'licence_id', 'status', 'preferred_start', 'starts_on', 'ends_on', 'whatsapp_group_link',
                          'website_visible', 'website_name', 'website_order', 'website_photo_url'];
  o jsonb;
  n jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (actor, action, circle_id, detail)
    values (who, 'circle_created', new.id, jsonb_build_object('name', new.name, 'status', new.status, 'source', new.source));
    return null;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (actor, action, circle_id, detail)
    values (who, 'circle_deleted', null, jsonb_build_object('id', old.id, 'name', old.name, 'status', old.status,
      'zoom_meeting_id', old.zoom_meeting_id, 'framer_item_id', old.framer_item_id));
    return null;
  end if;
  -- UPDATE: only edits a signed-in person made directly (not the sync or edge functions).
  if auth.jwt() ->> 'email' is null then return null; end if;
  o := to_jsonb(old); n := to_jsonb(new);
  foreach k in array watched loop
    if o -> k is distinct from n -> k then
      changes := changes || jsonb_build_object(k, jsonb_build_object('from', o -> k, 'to', n -> k));
    end if;
  end loop;
  if changes <> '{}'::jsonb then
    insert into public.audit_log (actor, action, circle_id, detail)
    values (who, 'circle_edited', new.id, jsonb_build_object('name', new.name, 'changes', changes));
  end if;
  return null;
end $$;
revoke execute on function public.circles_audit() from public, anon, authenticated;

create trigger circles_audit after insert or update or delete on public.circles
  for each row execute function public.circles_audit();
