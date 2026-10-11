-- 09_pending_cohost.sql
-- Co-hosts from the Tally form (migrations 20261011000028 and 029): pending_cohost turns into a co-facilitator only when the
-- circle first goes live. New people get a facilitator row; existing ones only have empty fields filled. The main
-- facilitator's own email, a bad email, a rejected circle or a later status change add nothing.
-- Safety: one DO block that always ends in an exception, so every change rolls back. Made-up names only.

do $$
declare
  n int := 0;
  sfx text := substr(md5(random()::text), 1, 8);
  host_email text := 'tg-test-cohost-host-' || sfx || '@example.org';
  new_email text := 'tg-test-cohost-new-' || sfx || '@example.org';
  old_email text := 'tg-test-cohost-old-' || sfx || '@example.org';
  host uuid; existing uuid; la uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid;
  f public.facilitators;
  cnt int;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.facilitators (name, email) values ('Test Cohost Host', host_email) returning id into host;
  insert into public.facilitators (name, email, phone, first_name) values ('Test Old Name', old_email, '+44 1', null) returning id into existing;
  insert into public.licences (label, sort_order) values ('zz-test-' || sfx || '-c', -100002) returning id into la;

  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, source, is_demo, pending_cohost)
  values ('Test cohost one', false, host, 1, '06:00', 60, 'Europe/London', la, 'pending', 'tally', true,
          jsonb_build_object('email', upper(new_email), 'first_name', 'Priya', 'last_name', 'Example', 'initiated_name', 'Radha', 'phone', '+44 7700 900123', 'photo_url', 'https://x.example.org/p.jpg'))
  returning id into c1;
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, source, is_demo, pending_cohost)
  values ('Test cohost two', false, host, 1, '08:00', 60, 'Europe/London', la, 'pending', 'tally', true,
          jsonb_build_object('email', old_email, 'first_name', 'Filled', 'last_name', null, 'phone', '+44 999', 'photo_url', 'https://x.example.org/q.jpg'))
  returning id into c2;
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, source, is_demo, pending_cohost)
  values ('Test cohost three', false, host, 1, '10:00', 60, 'Europe/London', la, 'pending', 'tally', true, jsonb_build_object('email', host_email))
  returning id into c3;
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, source, is_demo, pending_cohost)
  values ('Test cohost four', false, host, 1, '12:00', 60, 'Europe/London', la, 'pending', 'tally', true, jsonb_build_object('email', new_email))
  returning id into c4;
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, source, is_demo, pending_cohost)
  values ('Test cohost five', false, host, 1, '14:00', 60, 'Europe/London', la, 'pending', 'tally', true, jsonb_build_object('email', 'not an email'))
  returning id into c5;

  -- 1. Nothing happens while pending, or on the claim step (approved).
  update public.circles set status = 'approved' where id = c1;
  assert not exists (select 1 from public.facilitators where email = new_email), 'FAIL 1a: created before live'; n := n + 1;
  assert (select pending_cohost from public.circles where id = c1) is not null, 'FAIL 1b: cleared before live'; n := n + 1;

  -- 2. Going live creates the new facilitator and links them.
  update public.circles set status = 'live', zoom_meeting_id = 'T' || sfx || '1' where id = c1;
  select * into f from public.facilitators where email = new_email;
  assert f.id is not null and f.name = 'Radha (Priya Example)' and f.first_name = 'Priya' and f.last_name = 'Example'
     and f.initiated_name = 'Radha' and f.phone = '+44 7700 900123' and f.photo_url = 'https://x.example.org/p.jpg', 'FAIL 2a: new facilitator row'; n := n + 1;
  assert exists (select 1 from public.circle_cofacilitators where circle_id = c1 and facilitator_id = f.id), 'FAIL 2b: not linked'; n := n + 1;
  assert (select pending_cohost from public.circles where id = c1) is null, 'FAIL 2c: pending not cleared'; n := n + 1;
  assert exists (select 1 from public.audit_log where circle_id = c1 and action = 'cohost_added' and detail ->> 'result' = 'added (new facilitator)'), 'FAIL 2d: audit'; n := n + 1;
  assert (select status from public.circles where id = c1) = 'live', 'FAIL 2e: circle still live'; n := n + 1;

  -- 3. An existing facilitator is reused and only empty fields are filled.
  update public.circles set status = 'live', zoom_meeting_id = 'T' || sfx || '2' where id = c2;
  select * into f from public.facilitators where id = existing;
  assert f.name = 'Test Old Name' and f.phone = '+44 1' and f.first_name = 'Filled' and f.photo_url = 'https://x.example.org/q.jpg', 'FAIL 3a: existing row overwritten or not filled'; n := n + 1;
  assert exists (select 1 from public.circle_cofacilitators where circle_id = c2 and facilitator_id = existing), 'FAIL 3b: existing not linked'; n := n + 1;
  select count(*) into cnt from public.facilitators where email = old_email;
  assert cnt = 1, 'FAIL 3c: duplicate facilitator'; n := n + 1;

  -- 4. The host's own email adds nothing; the same new person on a second circle is reused.
  update public.circles set status = 'live', zoom_meeting_id = 'T' || sfx || '3' where id = c3;
  assert not exists (select 1 from public.circle_cofacilitators where circle_id = c3), 'FAIL 4a: host added as co-host'; n := n + 1;
  assert (select pending_cohost from public.circles where id = c3) is null, 'FAIL 4b: pending kept'; n := n + 1;
  update public.circles set status = 'live', zoom_meeting_id = 'T' || sfx || '4' where id = c4;
  select count(*) into cnt from public.facilitators where email = new_email;
  assert cnt = 1 and exists (select 1 from public.circle_cofacilitators cc join public.facilitators x on x.id = cc.facilitator_id
                                 where cc.circle_id = c4 and x.email = new_email), 'FAIL 4c: second circle'; n := n + 1;

  -- 5. A bad email is skipped, logged, and approval still goes through.
  update public.circles set status = 'live', zoom_meeting_id = 'T' || sfx || '5' where id = c5;
  assert (select status from public.circles where id = c5) = 'live', 'FAIL 5a: approval blocked'; n := n + 1;
  assert exists (select 1 from public.audit_log where circle_id = c5 and action = 'cohost_added' and detail ->> 'result' like 'skipped%'), 'FAIL 5b: skip logged'; n := n + 1;

  -- 6. Rejected circles never create anyone; later edits of a live circle don't re-run.
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, source, is_demo, pending_cohost)
  values ('Test cohost six', false, host, 1, '16:00', 60, 'Europe/London', la, 'pending', 'tally', true,
          jsonb_build_object('email', 'tg-test-cohost-rej-' || sfx || '@example.org'))
  returning id into c5;
  update public.circles set status = 'rejected', licence_id = null where id = c5;
  assert not exists (select 1 from public.facilitators where email = 'tg-test-cohost-rej-' || sfx || '@example.org'), 'FAIL 6a: rejected created'; n := n + 1;
  update public.circles set pending_cohost = jsonb_build_object('email', 'tg-test-cohost-late-' || sfx || '@example.org') where id = c1;
  update public.circles set start_time = '06:30' where id = c1;
  assert not exists (select 1 from public.facilitators where email = 'tg-test-cohost-late-' || sfx || '@example.org'), 'FAIL 6b: re-ran on a live circle'; n := n + 1;

  -- 7. The trigger function is not callable from the API.
  assert not has_function_privilege('authenticated', 'public.circles_attach_cohost()', 'execute'), 'FAIL 7: callable'; n := n + 1;

  raise exception 'TESTS PASSED: 09_pending_cohost % checks', n;
end $$;
