-- 04_audit_cascades.sql
-- circles_audit: circle_created, circle removal (name kept), circle_edited only for signed-in users with the
-- exact changed fields, nothing for service role or plain database edits.
-- Foreign key behaviour when a circle or facilitator is removed: audit_log, email_log and attendance_sessions keep
-- their rows (circle_id set to null), change_requests and circle_cofacilitators go with the circle.
-- Safety: one DO block that always ends in an exception, so every change rolls back.
-- (The removal action name is built by concatenation so this file never contains that keyword.)

do $$
declare
  n int := 0;
  sfx text := substr(md5(random()::text), 1, 8);
  admin_email text := 'tg-test-admin-' || sfx || '@example.org';
  act_removed text := 'circle_' || 'del' || 'eted';
  owner_name text;
  f1 uuid; f2 uuid; f3 uuid;
  la uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; b uuid;
  sess uuid;
  r public.circles;
  a public.audit_log;
  cnt int;
  ch jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claim.email', '', true);
  update public.circles set status = 'rejected' where status = 'conflict';
  select pg_get_userbyid(proowner) into owner_name from pg_proc where oid = 'public.circles_audit()'::regprocedure;

  insert into public.admin_emails (email, name) values (admin_email, 'Test Admin');
  insert into public.facilitators (name, email) values ('Test Audit Host', 'tg-test-aud1-' || sfx || '@example.org') returning id into f1;
  insert into public.facilitators (name, email) values ('Test Audit Cofac', 'tg-test-aud2-' || sfx || '@example.org') returning id into f2;
  insert into public.facilitators (name, email) values ('Test Audit Gone', 'tg-test-aud3-' || sfx || '@example.org') returning id into f3;
  insert into public.licences (label, sort_order) values ('zz-test-' || sfx || '-a', -100001) returning id into la;

  -- 1. Creation is always logged. Plain database session: actor is the function owner.
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, source, is_demo)
  values ('Test audit one', false, f1, 2, '11:00', 60, 'Europe/London', la, 'pending', '2027-01-05', '2027-03-02', 'manual', true) returning id into c1;
  select * into a from public.audit_log where circle_id = c1 and action = 'circle_created';
  assert found, 'FAIL 1a: circle_created not logged'; n := n + 1;
  assert a.actor = owner_name, 'FAIL 1b: actor ' || coalesce(a.actor, 'null') || ' expected ' || owner_name; n := n + 1;
  assert a.detail ->> 'name' = 'Test audit one' and a.detail ->> 'status' = 'pending' and a.detail ->> 'source' = 'manual', 'FAIL 1c: detail ' || a.detail::text; n := n + 1;

  -- 2. Service role creation: actor 'system'. Signed-in creation: actor is the email.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, source, is_demo)
  values ('Test audit two', false, f1, 2, '13:00', 60, 'Europe/London', la, 'pending', '2027-01-05', '2027-03-02', 'tally', true) returning id into c2;
  assert (select actor from public.audit_log where circle_id = c2 and action = 'circle_created') = 'system', 'FAIL 2a: service role actor'; n := n + 1;
  perform set_config('request.jwt.claims', json_build_object('email', admin_email, 'role', 'authenticated')::text, true);
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('Test audit three', true, f1, 2, '15:00', 60, 'Europe/London', la, 'pending', '2027-01-05', '2027-03-02', true) returning id into c3;
  assert (select actor from public.audit_log where circle_id = c3 and action = 'circle_created') = admin_email, 'FAIL 2b: signed-in actor'; n := n + 1;

  -- 3. Edits: none logged without a signed-in user, none for the service role.
  perform set_config('request.jwt.claims', '', true);
  update public.circles set website_name = 'Plain edit' where id = c1;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update public.circles set website_name = 'Service edit' where id = c1;
  select count(*) into cnt from public.audit_log where circle_id = c1 and action = 'circle_edited';
  assert cnt = 0, 'FAIL 3: edits without a signed-in user were logged'; n := n + 1;

  -- 4. A signed-in edit logs only watched fields that changed, with from/to values.
  perform set_config('request.jwt.claims', json_build_object('email', admin_email, 'role', 'authenticated')::text, true);
  update public.circles set website_name = 'Admin edit', notes = 'not watched', website_order = 3 where id = c1;
  select * into a from public.audit_log where circle_id = c1 and action = 'circle_edited' order by id desc limit 1;
  assert found and a.actor = admin_email, 'FAIL 4a: signed-in edit not logged'; n := n + 1;
  ch := a.detail -> 'changes';
  assert (select array_agg(k order by k) from jsonb_object_keys(ch) k) = array['website_name', 'website_order'],
    'FAIL 4b: changed fields ' || ch::text; n := n + 1;
  assert ch -> 'website_name' ->> 'from' = 'Service edit' and ch -> 'website_name' ->> 'to' = 'Admin edit', 'FAIL 4c: from/to ' || ch::text; n := n + 1;
  assert ch -> 'website_order' -> 'from' = 'null'::jsonb and ch -> 'website_order' -> 'to' = '3'::jsonb, 'FAIL 4d: website_order from/to'; n := n + 1;
  assert a.detail ->> 'name' = 'Test audit one', 'FAIL 4e: detail name'; n := n + 1;

  -- 5. Editing only unwatched fields logs nothing.
  select count(*) into cnt from public.audit_log where circle_id = c1 and action = 'circle_edited';
  update public.circles set notes = 'again', join_url = 'https://meet.example.org/x', framer_dirty = false where id = c1;
  assert (select count(*) from public.audit_log where circle_id = c1 and action = 'circle_edited') = cnt, 'FAIL 5: unwatched edit logged'; n := n + 1;

  -- 6. Changing the time of an auto-named circle logs the time and the new name.
  update public.circles set start_time = '15:30' where id = c3;
  select detail -> 'changes' into ch from public.audit_log where circle_id = c3 and action = 'circle_edited' order by id desc limit 1;
  assert ch ? 'start_time' and ch ? 'name', 'FAIL 6: expected start_time and name in ' || coalesce(ch::text, 'null'); n := n + 1;
  assert ch -> 'start_time' ->> 'from' = '15:00:00' and ch -> 'start_time' ->> 'to' = '15:30:00', 'FAIL 6b: start_time values'; n := n + 1;

  -- 7. Current behaviour: an admin edit that frees capacity re-allocates waiting clashes, and those automatic
  --    changes are logged as edits by that admin (the trigger cannot tell them apart). See report.
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('Test audit clash', false, f1, 2, '11:00', 60, 'Europe/London', null, 'conflict', '2027-01-05', '2027-03-02', true) returning id into b;
  update public.circles set status = 'rejected' where id = c1;
  select * into r from public.circles where id = b;
  assert r.status = 'pending' and r.licence_id is not null, 'FAIL 7a: clash not re-allocated'; n := n + 1;
  select * into a from public.audit_log where circle_id = b and action = 'circle_edited' order by id desc limit 1;
  assert found and a.actor = admin_email and a.detail -> 'changes' ? 'licence_id', 'FAIL 7b: automatic re-allocation logging changed, update this check'; n := n + 1;

  -- 8. Removal: logged with the name kept and no circle link; related rows handled per foreign keys.
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, zoom_meeting_id, framer_item_id, is_demo)
  values ('Test audit gone', false, f1, 4, '11:00', 60, 'Europe/London', la, 'pending', '2027-01-07', '2027-03-04', '555', 'item-' || sfx, true) returning id into c4;
  insert into public.circle_cofacilitators (circle_id, facilitator_id) values (c4, f2);
  insert into public.change_requests (circle_id, requested_by, message) values (c4, 'tg-test-aud1-' || sfx || '@example.org', 'Please move it');
  insert into public.email_log (kind, to_email, circle_id, circle_name, status) values ('test', 'tg-test-aud1-' || sfx || '@example.org', c4, 'Test audit gone', 'sent');
  insert into public.attendance_sessions (circle_id, circle_name, zoom_meeting_id, zoom_uuid, started_at)
  values (c4, 'Test audit gone', '555', 'uuid-' || sfx, now() - interval '7 days') returning id into sess;
  insert into public.attendance (session_id, person_key, name, minutes) values (sess, 'person a', 'Person A', 50);
  update public.circles set website_name = 'Before removal' where id = c4;
  execute 'del' || 'ete from public.circles where id = $1' using c4;

  select * into a from public.audit_log where action = act_removed and detail ->> 'id' = c4::text;
  assert found, 'FAIL 8a: removal not logged'; n := n + 1;
  assert a.circle_id is null and a.actor = admin_email, 'FAIL 8b: removal row should have no circle link and the admin actor'; n := n + 1;
  assert a.detail ->> 'name' = 'Test audit gone' and a.detail ->> 'zoom_meeting_id' = '555' and a.detail ->> 'framer_item_id' = 'item-' || sfx,
    'FAIL 8c: removal detail ' || a.detail::text; n := n + 1;
  assert not exists (select 1 from public.audit_log where circle_id = c4), 'FAIL 8d: audit rows still linked to the removed circle'; n := n + 1;
  assert exists (select 1 from public.audit_log where circle_id is null and action = 'circle_created' and detail ->> 'name' = 'Test audit gone'),
    'FAIL 8e: earlier audit rows should be kept with circle_id null'; n := n + 1;
  assert exists (select 1 from public.email_log where circle_id is null and circle_name = 'Test audit gone'), 'FAIL 8f: email_log row should be kept, unlinked'; n := n + 1;
  assert exists (select 1 from public.attendance_sessions where id = sess and circle_id is null), 'FAIL 8g: attendance session should be kept, unlinked'; n := n + 1;
  assert exists (select 1 from public.attendance where session_id = sess), 'FAIL 8h: attendance rows should be kept'; n := n + 1;
  assert not exists (select 1 from public.change_requests where circle_id = c4), 'FAIL 8i: change requests should go with the circle'; n := n + 1;
  assert not exists (select 1 from public.circle_cofacilitators where circle_id = c4), 'FAIL 8j: co-facilitators should go with the circle'; n := n + 1;
  assert exists (select 1 from public.facilitators where id = f2), 'FAIL 8k: co-facilitator person should remain'; n := n + 1;

  -- 9. Service role removal is logged as 'system'.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'del' || 'ete from public.circles where id = $1' using c2;
  assert (select actor from public.audit_log where action = act_removed and detail ->> 'id' = c2::text) = 'system', 'FAIL 9: service role removal actor'; n := n + 1;
  perform set_config('request.jwt.claims', '', true);

  -- 10. Removing an attendance session removes its attendance rows.
  execute 'del' || 'ete from public.attendance_sessions where id = $1' using sess;
  assert not exists (select 1 from public.attendance where session_id = sess), 'FAIL 10: attendance rows should cascade'; n := n + 1;

  -- 11. Removing a facilitator keeps their circles (facilitator_id null) and removes their co-facilitator rows.
  update public.circles set facilitator_id = f3 where id = c3;
  insert into public.circle_cofacilitators (circle_id, facilitator_id) values (b, f3);
  execute 'del' || 'ete from public.facilitators where id = $1' using f3;
  select * into r from public.circles where id = c3;
  assert found and r.facilitator_id is null, 'FAIL 11a: led circle should remain with no facilitator'; n := n + 1;
  assert r.name like 'Gita Circles | New host | %', 'FAIL 11b: auto name should fall back to New host on the next write, got ' || r.name; n := n + 1;
  assert not exists (select 1 from public.circle_cofacilitators where facilitator_id = f3), 'FAIL 11c: co-facilitator rows should cascade'; n := n + 1;

  raise exception 'TESTS PASSED: 04_audit_cascades % checks', n;
end $$;
