-- 06_settings_names_misc.sql
-- Settings (singleton, checks, save_settings, term dates in slot computation), circle auto names, table checks
-- for change_requests / attendance / email_log / email_templates / circles, close_finished(), the pure slot
-- helpers, and security definer hygiene (search_path set, nothing callable by anon, internals not callable by
-- signed-in users).
-- Note: there are no Tally intake helpers in SQL; tally-intake is an edge function and is not covered here.
-- Safety: one DO block that always ends in an exception, so every change rolls back.

do $$
declare
  n int := 0;
  sfx text := substr(md5(random()::text), 1, 8);
  admin_email text := 'tg-test-admin-' || sfx || '@example.org';
  fi uuid; fp uuid; fn uuid; fx uuid;
  la uuid; lb uuid;
  c uuid; c_live uuid; c_paused uuid; c_today uuid; c_pend uuid;
  sess uuid;
  r public.circles;
  s public.settings;
  rt record;
  cnt int;
  msg text;
  fn_rec record;
  internal text[] := array['_allocate', '_reallocate_conflicts', 'free_licence', 'free_licence_for', 'close_finished',
    'framer_sync_tick', 'framer_daily_refresh', 'framer_cron_ok', 'circle_auto_name', 'my_circles',
    'circles_after_write', 'circles_audit', 'circles_auto_name', 'circles_capacity_check', 'cofac_mark_framer_dirty',
    'facilitator_mark_framer_dirty', 'licences_after_write', 'licences_before_write', 'guard_admin_emails',
    'circles_mark_framer_dirty'];
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claim.email', '', true);
  update public.circles set status = 'rejected' where status = 'conflict';
  insert into public.admin_emails (email, name) values (admin_email, 'Test Admin');
  insert into public.licences (label, sort_order) values ('zz-test-' || sfx || '-a', -100002) returning id into la;
  insert into public.licences (label, sort_order) values ('zz-test-' || sfx || '-b', -100001) returning id into lb;

  -- 1. Settings is a single row with sane checks.
  begin insert into public.settings (id) values (2); raise exception 'FAIL 1a: second settings row accepted';
  exception when check_violation then null; end;
  begin insert into public.settings (id) values (1); raise exception 'FAIL 1b: duplicate settings row accepted';
  exception when unique_violation then null; end;
  begin update public.settings set term_start = '2027-03-01', term_end = '2027-01-01' where id = 1; raise exception 'FAIL 1c: term end before start accepted';
  exception when check_violation then null; end;
  begin update public.settings set buffer_minutes = -1 where id = 1; raise exception 'FAIL 1d: negative buffer accepted';
  exception when check_violation then null; end;
  n := n + 4;

  -- 2. save_settings: admin only, saves every field (same buffer and term so live circles are unaffected).
  select * into s from public.settings where id = 1;
  begin
    perform public.save_settings(s.buffer_minutes, 45, 'Asia/Kolkata', s.term_start, s.term_end);
    raise exception 'FAIL 2a: save_settings without admin';
  exception when others then
    get stacked diagnostics msg = message_text;
    assert msg = 'not authorised', 'FAIL 2a: ' || msg;
  end;
  n := n + 1;
  perform set_config('request.jwt.claims', json_build_object('email', admin_email, 'role', 'authenticated')::text, true);
  perform public.save_settings(s.buffer_minutes, 45, 'Asia/Kolkata', s.term_start, s.term_end);
  assert (select default_duration_min = 45 and default_timezone = 'Asia/Kolkata' and updated_at >= s.updated_at from public.settings where id = 1),
    'FAIL 2b: save_settings did not save'; n := n + 1;
  assert public.recompute_slots() >= 1, 'FAIL 2c: recompute_slots should touch circles'; n := n + 1;
  perform set_config('request.jwt.claims', '', true);
  begin perform public.recompute_slots(); raise exception 'FAIL 2d: recompute_slots without admin';
  exception when others then
    get stacked diagnostics msg = message_text;
    assert msg = 'not authorised', 'FAIL 2d: ' || msg;
  end;
  n := n + 1;

  -- 3. Term dates decide the run used for slots when a circle has no start date of its own.
  --    New York Mon 12:00 across 12 Oct to 30 Nov 2026 crosses both clock changes; from 2 Nov it does not.
  update public.settings set term_start = '2026-10-12', term_end = '2026-11-30' where id = 1;
  insert into public.circles (name, weekday, start_time, duration_min, timezone, status, is_demo)
  values ('t', 1, '12:00', 60, 'America/New_York', 'conflict', true) returning * into r;
  c := r.id;
  assert r.uk_time_shifts and r.ref_start_time = '17:00', 'FAIL 3a: term window should include the clock changes'; n := n + 1;
  update public.circles set preferred_start = '2026-11-02' where id = c returning * into r;
  assert not r.uk_time_shifts and r.slots = '{[1020,1095)}'::int4multirange, 'FAIL 3b: preferred_start should start the run'; n := n + 1;
  update public.circles set starts_on = '2026-10-12', ends_on = '2026-10-19' where id = c returning * into r;
  assert not r.uk_time_shifts and r.ref_start_time = '17:00', 'FAIL 3c: starts_on/ends_on should win over preferred_start and term'; n := n + 1;
  update public.settings set term_start = s.term_start, term_end = s.term_end where id = 1;

  -- 4. Pure helpers.
  assert public.week_slot(1::smallint, '18:00', 60, 15) = int4range(1080, 1155), 'FAIL 4a: week_slot'; n := n + 1;
  select * into rt from public.reference_time(1::smallint, '23:30', 'Asia/Kolkata', '2027-01-04');
  assert rt.ref_weekday = 1 and rt.ref_start = '18:00', 'FAIL 4b: reference_time'; n := n + 1;
  select * into rt from public.circle_slots(7::smallint, '23:30', 60, 'Europe/London', '2027-01-03', '2027-03-01', 15);
  assert rt.slots = '{[0,45),[10050,10080)}'::int4multirange and not rt.shifts, 'FAIL 4c: circle_slots wrap'; n := n + 1;
  select * into rt from public.circle_slots(1::smallint, '12:00', 60, '', '2027-01-04', '2027-01-04', 0);
  assert rt.slots = '{[720,780)}'::int4multirange, 'FAIL 4d: empty timezone should mean UK time'; n := n + 1;

  -- 5. Auto names.
  insert into public.facilitators (name, email, first_name, last_name, initiated_name)
  values ('Ann Example', 'tg-test-n1-' || sfx || '@example.org', 'Ann', 'Example', 'Isvari Test') returning id into fi;
  insert into public.facilitators (name, email, first_name, last_name)
  values ('Ignored Name', 'tg-test-n2-' || sfx || '@example.org', 'Ben', 'Sample') returning id into fp;
  insert into public.facilitators (name, email) values ('Cara Plain', 'tg-test-n3-' || sfx || '@example.org') returning id into fn;
  insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, status, starts_on, ends_on, is_demo)
  values ('typed', fi, 3, '19:30', 60, 'Europe/London', 'conflict', '2027-01-06', '2027-03-03', true) returning * into r;
  c := r.id;
  assert r.name = 'Gita Circles | Isvari Test (Ann Example) | Wednesday 19:30 (UK time)', 'FAIL 5a: ' || r.name; n := n + 1;
  update public.circles set facilitator_id = fp where id = c returning * into r;
  assert r.name = 'Gita Circles | Ben Sample | Wednesday 19:30 (UK time)', 'FAIL 5b: ' || r.name; n := n + 1;
  update public.circles set facilitator_id = fn, timezone = 'Asia/Kolkata' where id = c returning * into r;
  assert r.name = 'Gita Circles | Cara Plain | Wednesday 19:30 (Kolkata time)', 'FAIL 5c: ' || r.name; n := n + 1;
  update public.circles set facilitator_id = null, timezone = 'America/New_York', weekday = 7, start_time = '08:05' where id = c returning * into r;
  assert r.name = 'Gita Circles | New host | Sunday 08:05 (New York time)', 'FAIL 5d: ' || r.name; n := n + 1;
  update public.circles set timezone = 'Etc/GMT+5' where id = c returning * into r;
  assert r.name = 'Gita Circles | New host | Sunday 08:05 (GMT-5)', 'FAIL 5e: ' || r.name; n := n + 1;
  -- A typed name sticks (name_auto false) through time changes, until automatic naming is switched back on.
  update public.circles set name = 'Custom test name', name_auto = false where id = c;
  update public.circles set start_time = '09:00' where id = c returning * into r;
  assert r.name = 'Custom test name', 'FAIL 5f: custom name overwritten: ' || r.name; n := n + 1;
  update public.circles set name_auto = true, facilitator_id = fn where id = c returning * into r;
  assert r.name = 'Gita Circles | Cara Plain | Sunday 09:00 (GMT-5)', 'FAIL 5g: ' || r.name; n := n + 1;
  -- Renaming the facilitator renames their auto-named circles (through the website dirty trigger).
  update public.facilitators set name = 'Cara Renamed' where id = fn;
  assert (select name from public.circles where id = c) = 'Gita Circles | Cara Renamed | Sunday 09:00 (GMT-5)', 'FAIL 5h: rename not followed'; n := n + 1;
  -- Current behaviour: a first_name/last_name change alone does not rename existing circles (see report).
  update public.facilitators set first_name = 'Cara', last_name = 'Plainer' where id = fn;
  assert (select name from public.circles where id = c) = 'Gita Circles | Cara Renamed | Sunday 09:00 (GMT-5)', 'FAIL 5i: behaviour changed, update this check'; n := n + 1;
  assert public.circle_auto_name(fn, 7::smallint, '09:00', 'Etc/GMT+5') = 'Gita Circles | Cara Plainer | Sunday 09:00 (GMT-5)', 'FAIL 5j: circle_auto_name'; n := n + 1;

  -- 6. Table checks.
  begin insert into public.circles (name, name_auto, weekday, start_time, duration_min) values ('t', false, 8, '09:00', 60); raise exception 'FAIL 6a: weekday 8';
  exception when check_violation then null; end;
  begin insert into public.circles (name, weekday, start_time, duration_min) values ('t', 1, '09:00', 10); raise exception 'FAIL 6b: duration 10';
  exception when check_violation then null; end;
  begin update public.circles set website_order = 0 where id = c; raise exception 'FAIL 6c: website_order 0';
  exception when check_violation then null; end;
  begin update public.circles set preference_used = 3 where id = c; raise exception 'FAIL 6d: preference_used 3';
  exception when check_violation then null; end;
  update public.circles set tally_submission_id = 'tally-' || sfx where id = c;
  begin
    insert into public.circles (name, weekday, start_time, duration_min, status, tally_submission_id) values ('t', 1, '09:00', 60, 'conflict', 'tally-' || sfx);
    raise exception 'FAIL 6e: duplicate tally_submission_id';
  exception when unique_violation then null; end;
  begin insert into public.change_requests (circle_id, requested_by, message, request_type) values (c, 'x@example.org', 'm', 'teleport'); raise exception 'FAIL 6f: request_type';
  exception when check_violation then null; end;
  begin insert into public.change_requests (circle_id, requested_by, message) values (c, 'x@example.org', ''); raise exception 'FAIL 6g: empty message';
  exception when check_violation then null; end;
  begin insert into public.change_requests (circle_id, requested_by, message) values (c, 'x@example.org', repeat('a', 2001)); raise exception 'FAIL 6h: long message';
  exception when check_violation then null; end;
  begin insert into public.change_requests (circle_id, requested_by, message, status) values (c, 'x@example.org', 'm', 'maybe'); raise exception 'FAIL 6i: status';
  exception when check_violation then null; end;
  n := n + 9;
  insert into public.change_requests (circle_id, requested_by, message) values (c, 'x@example.org', 'm');
  assert (select request_type = 'other' and details = '{}'::jsonb and status = 'open' from public.change_requests where circle_id = c),
    'FAIL 6j: change request defaults'; n := n + 1;
  insert into public.attendance_sessions (circle_id, zoom_meeting_id, zoom_uuid, started_at) values (c, '1', 'u-' || sfx, now()) returning id into sess;
  insert into public.attendance (session_id, person_key) values (sess, 'p@example.org');
  begin insert into public.attendance (session_id, person_key) values (sess, 'p@example.org'); raise exception 'FAIL 6k: duplicate attendee';
  exception when unique_violation then null; end;
  begin insert into public.attendance_sessions (zoom_meeting_id, zoom_uuid, started_at) values ('1', 'u-' || sfx, now()); raise exception 'FAIL 6l: duplicate zoom_uuid';
  exception when unique_violation then null; end;
  begin insert into public.email_log (kind, status) values ('test', 'lost'); raise exception 'FAIL 6m: email_log status';
  exception when check_violation then null; end;
  begin insert into public.email_templates (key, subject, body) values ('reminder', 's', 'b'); raise exception 'FAIL 6n: email template key';
  exception when check_violation then null; end;
  begin insert into public.facilitators (name, email) values ('Upper', 'Upper-' || sfx || '@example.org'); raise exception 'FAIL 6o: facilitator email case';
  exception when check_violation then null; end;
  n := n + 5;

  -- 7. close_finished: live and paused circles past their end date are ended and release their licence.
  insert into public.circles (name, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('t', 2, '06:00', 60, 'Europe/London', la, 'live', current_date - 60, current_date - 1, true) returning id into c_live;
  insert into public.circles (name, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('t', 2, '06:00', 60, 'Europe/London', la, 'paused', current_date - 60, current_date - 1, true) returning id into c_paused;
  insert into public.circles (name, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('t', 2, '06:00', 60, 'Europe/London', lb, 'live', current_date - 60, current_date, true) returning id into c_today;
  insert into public.circles (name, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('t', 2, '06:00', 60, 'Europe/London', lb, 'pending', current_date - 60, current_date - 1, true) returning id into c_pend;
  assert public.close_finished() >= 2, 'FAIL 7a: close_finished count'; n := n + 1;
  assert (select status = 'ended' and licence_id is null from public.circles where id = c_live), 'FAIL 7b: live past end not closed'; n := n + 1;
  assert (select status = 'ended' and licence_id is null from public.circles where id = c_paused), 'FAIL 7c: paused past end not closed'; n := n + 1;
  assert (select status = 'live' and licence_id = lb from public.circles where id = c_today), 'FAIL 7d: circle ending today closed early'; n := n + 1;
  assert (select status = 'pending' from public.circles where id = c_pend), 'FAIL 7e: pending circle should not be closed'; n := n + 1;

  -- 8. Security definer hygiene.
  for fn_rec in
    select p.oid, p.proname, coalesce(array_to_string(p.proconfig, ','), '') cfg
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
  loop
    assert fn_rec.cfg like '%search_path=%', 'FAIL 8a: security definer ' || fn_rec.proname || ' has no fixed search_path';
    assert not has_function_privilege('anon', fn_rec.oid, 'EXECUTE'), 'FAIL 8b: anon can execute ' || fn_rec.proname;
    if fn_rec.proname = any(internal) then
      assert not has_function_privilege('authenticated', fn_rec.oid, 'EXECUTE'), 'FAIL 8c: authenticated can execute internal ' || fn_rec.proname;
      n := n + 1;
    end if;
    if fn_rec.cfg not like '%search_path=""%' then
      raise warning 'NOTE: security definer % uses search_path % rather than an empty one', fn_rec.proname, fn_rec.cfg;
    end if;
    n := n + 2;
  end loop;
  select count(*) into cnt from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname = any(internal);
  assert cnt >= 19, 'FAIL 8d: expected the internal functions to exist, found ' || cnt; n := n + 1;

  raise exception 'TESTS PASSED: 06_settings_names_misc % checks', n;
end $$;
