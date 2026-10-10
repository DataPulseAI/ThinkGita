-- 07_circle_names.sql
-- Circle names (migration 20261010000026): new circles always get automatic names (imports and demo rows excepted),
-- automatic names still follow the schedule, and imported "TG <type> | <Day> | <time> <zone> | <host>" names get
-- their day and time segments rewritten when the weekday, start time or timezone changes. Other custom names stay.
-- Safety: one DO block that always ends in an exception, so every change rolls back. Made-up names only.

do $$
declare
  n int := 0;
  sfx text := substr(md5(random()::text), 1, 8);
  admin_email text := 'tg-test-admin-' || sfx || '@example.org';
  fac uuid;
  c uuid;
  r public.circles;
  d date;
  want text;
  fn_name text;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claim.email', '', true);
  insert into public.admin_emails (email, name) values (admin_email, 'Test Admin');
  insert into public.facilitators (name, email) values ('Test Host', 'tg-test-names-' || sfx || '@example.org') returning id into fac;

  -- 1. Formatting helpers.
  assert public.circle_time_label('17:00') = '5pm', 'FAIL 1a'; n := n + 1;
  assert public.circle_time_label('19:30') = '7.30pm', 'FAIL 1b'; n := n + 1;
  assert public.circle_time_label('18:15', ':') = '6:15pm', 'FAIL 1c'; n := n + 1;
  assert public.circle_time_label('00:00') = '12am' and public.circle_time_label('12:00') = '12pm'
     and public.circle_time_label('12:05') = '12.05pm' and public.circle_time_label('09:00') = '9am', 'FAIL 1d: midnight and noon'; n := n + 1;
  assert public.circle_zone_label('Europe/London') = 'UK' and public.circle_zone_label('America/Chicago') = 'CT'
     and public.circle_zone_label('Europe/Brussels') = 'CET' and public.circle_zone_label('Asia/Kolkata') = 'IST'
     and public.circle_zone_label('Asia/Tehran') = 'Tehran' and public.circle_zone_label('Etc/GMT+5') = 'GMT-5', 'FAIL 1e: zone labels'; n := n + 1;
  assert public.circle_zone_for_label('uk') = 'Europe/London' and public.circle_zone_for_label('CST') = 'America/Chicago'
     and public.circle_zone_for_label('Polska') = 'Europe/Warsaw' and public.circle_zone_for_label('CET') = 'Europe/Paris'
     and public.circle_zone_for_label('Mars') is null, 'FAIL 1f: labels read back'; n := n + 1;

  -- 2. Inserts through the API always get the automatic name.
  perform set_config('request.jwt.claims', json_build_object('email', admin_email, 'role', 'authenticated')::text, true);
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, source)
  values ('My own name', false, fac, 3, '19:30', 60, 'Europe/London', 'conflict', 'manual') returning * into r;
  assert r.name_auto and r.name = 'Gita Circles | Test Host | Wednesday 19:30 (UK time)', 'FAIL 2a: dashboard insert kept a custom name: ' || r.name; n := n + 1;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, source)
  values ('Form name', false, fac, 4, '20:00', 60, 'Europe/London', 'conflict', 'tally') returning * into r;
  assert r.name_auto and r.name like 'Gita Circles | Test Host | Thursday 20:00%', 'FAIL 2b: intake insert kept a custom name: ' || r.name; n := n + 1;
  -- Imports and demo rows keep the name they are given.
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, source)
  values ('TG Circles | Fri | 8pm IST | Test Host', false, fac, 5, '20:00', 60, 'Asia/Kolkata', 'conflict', 'import') returning * into r;
  assert not r.name_auto and r.name = 'TG Circles | Fri | 8pm IST | Test Host', 'FAIL 2c: import lost its name'; n := n + 1;
  perform set_config('request.jwt.claims', '', true);
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, is_demo)
  values ('Demo name', false, fac, 1, '10:00', 60, 'Europe/London', 'conflict', true) returning * into r;
  assert not r.name_auto and r.name = 'Demo name', 'FAIL 2d: demo row lost its name'; n := n + 1;
  -- Default name_auto on a plain insert is still automatic.
  insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, status, source)
  values ('t', fac, 2, '07:00', 60, 'Europe/London', 'conflict', 'manual') returning * into r;
  assert r.name_auto and r.name = 'Gita Circles | Test Host | Tuesday 07:00 (UK time)', 'FAIL 2e: ' || r.name; n := n + 1;

  -- 3. Automatic names still follow the schedule, and "Use automatic name" switches a custom name back.
  update public.circles set weekday = 6, start_time = '09:00', timezone = 'America/Chicago' where id = r.id returning * into r;
  assert r.name = 'Gita Circles | Test Host | Saturday 09:00 (Chicago time)', 'FAIL 3a: ' || r.name; n := n + 1;
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, source)
  values ('Old imported title', false, fac, 1, '18:00', 60, 'Europe/London', 'conflict', 'import') returning id into c;
  update public.circles set name_auto = true where id = c returning * into r;
  assert r.name = 'Gita Circles | Test Host | Monday 18:00 (UK time)', 'FAIL 3b: use automatic name: ' || r.name; n := n + 1;

  -- 4. The real case: Tuesday 17:00 to Saturday 09:00 in Chicago.
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, source)
  values ('TG Circles | Tue | 5pm CT | Test Host', false, fac, 2, '17:00', 60, 'America/Chicago', 'conflict', 'import') returning id into c;
  update public.circles set weekday = 6, start_time = '09:00' where id = c returning * into r;
  assert r.name = 'TG Circles | Sat | 9am CT | Test Host', 'FAIL 4a: ' || r.name; n := n + 1;
  assert not r.name_auto, 'FAIL 4b: still a custom name'; n := n + 1;
  -- Putting the old values back with the old name (what provision-circle does when Zoom refuses) restores it exactly.
  update public.circles set weekday = 2, start_time = '17:00', name = 'TG Circles | Tue | 5pm CT | Test Host' where id = c returning * into r;
  assert r.name = 'TG Circles | Tue | 5pm CT | Test Host', 'FAIL 4c: revert: ' || r.name; n := n + 1;
  -- A name typed in the same update wins.
  update public.circles set weekday = 3, name = 'TG Circles | Typed | 1pm CT | Test Host' where id = c returning * into r;
  assert r.name = 'TG Circles | Typed | 1pm CT | Test Host', 'FAIL 4d: typed name overwritten: ' || r.name; n := n + 1;
  -- Changes that are not the day, time or zone leave the name alone.
  update public.circles set name = 'TG Circles | Wed | 5pm CT | Test Host' where id = c;
  update public.circles set duration_min = 90, notes = 'longer' where id = c returning * into r;
  assert r.name = 'TG Circles | Wed | 5pm CT | Test Host', 'FAIL 4e: ' || r.name; n := n + 1;

  -- 5. Style is kept: dots, colons, type words, extra name segments, full day names.
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, source)
  values ('TG Circles | Mon | 7.30pm UK | Test Host', false, fac, 1, '19:30', 60, 'Europe/London', 'conflict', 'import') returning id into c;
  update public.circles set start_time = '20:15' where id = c returning * into r;
  assert r.name = 'TG Circles | Mon | 8.15pm UK | Test Host', 'FAIL 5a: ' || r.name; n := n + 1;
  update public.circles set start_time = '20:00' where id = c returning * into r;
  assert r.name = 'TG Circles | Mon | 8pm UK | Test Host', 'FAIL 5b: ' || r.name; n := n + 1;

  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, source)
  values ('TG Bhakti Circles | Tues | 6:15pm CET | Test Host', false, fac, 2, '18:15', 60, 'Europe/Paris', 'conflict', 'import') returning id into c;
  update public.circles set weekday = 3, start_time = '18:45' where id = c returning * into r;
  assert r.name = 'TG Bhakti Circles | Wed | 6:45pm CET | Test Host', 'FAIL 5c: ' || r.name; n := n + 1;

  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, source)
  values ('TG Circles Morning Japa | Thu | 5am UK | Test Host', false, fac, 4, '05:00', 60, 'Europe/London', 'conflict', 'import') returning id into c;
  update public.circles set weekday = 5 where id = c returning * into r;
  assert r.name = 'TG Circles Morning Japa | Fri | 5am UK | Test Host', 'FAIL 5d: day only: ' || r.name; n := n + 1;
  update public.circles set timezone = 'Europe/Brussels' where id = c returning * into r;
  assert r.name = 'TG Circles Morning Japa | Fri | 5am CET | Test Host', 'FAIL 5e: zone only: ' || r.name; n := n + 1;
  update public.circles set timezone = 'Asia/Tehran', start_time = '06:30' where id = c returning * into r;
  assert r.name = 'TG Circles Morning Japa | Fri | 6.30am Tehran | Test Host', 'FAIL 5f: unlisted zone: ' || r.name; n := n + 1;

  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, source)
  values ('TG Circles | Sat | 5pm CDMX | Second Name | Test Host', false, fac, 6, '17:00', 60, 'America/Mexico_City', 'conflict', 'import') returning id into c;
  update public.circles set weekday = 7, start_time = '16:30' where id = c returning * into r;
  assert r.name = 'TG Circles | Sun | 4.30pm CDMX | Second Name | Test Host', 'FAIL 5g: ' || r.name; n := n + 1;

  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, source)
  values ('TG Circles | Monday | 7pm UK | Test Host', false, fac, 1, '19:00', 60, 'Europe/London', 'conflict', 'import') returning id into c;
  update public.circles set weekday = 2 where id = c returning * into r;
  assert r.name = 'TG Circles | Tuesday | 7pm UK | Test Host', 'FAIL 5h: ' || r.name; n := n + 1;

  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, source)
  values ('TG Circles | Thu | 7.30pmEAT | Test Host', false, fac, 4, '19:30', 60, 'Africa/Nairobi', 'conflict', 'import') returning id into c;
  update public.circles set start_time = '20:00' where id = c returning * into r;
  assert r.name = 'TG Circles | Thu | 8pm EAT | Test Host', 'FAIL 5i: ' || r.name; n := n + 1;

  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, source)
  values ('TG Circles | Sat | 8:30 am ECT | Test Host', false, fac, 6, '08:30', 60, 'America/Guayaquil', 'conflict', 'import') returning id into c;
  update public.circles set start_time = '09:00' where id = c returning * into r;
  assert r.name = 'TG Circles | Sat | 9am ECT | Test Host', 'FAIL 5j: ' || r.name; n := n + 1;

  -- 6. Extra time segments are converted when their zone is known, and kept when it is not.
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, source)
  values ('TG Circles | Fri | 8pm IST | 11.30pm Korea | Test Host', false, fac, 5, '20:00', 60, 'Asia/Kolkata', 'conflict', 'import') returning id into c;
  update public.circles set start_time = '18:00' where id = c returning * into r;
  assert r.name = 'TG Circles | Fri | 6pm IST | 9.30pm Korea | Test Host', 'FAIL 6a: ' || r.name; n := n + 1;

  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, source)
  values ('TG Circles | Sat | 9am CT | 3pm UK | 7:30pm IST | Test Host', false, fac, 6, '09:00', 60, 'America/Chicago', 'conflict', 'import') returning id into c;
  update public.circles set start_time = '10:00' where id = c returning * into r;
  d := current_date + ((6 - extract(isodow from current_date)::int + 7) % 7);
  want := 'TG Circles | Sat | 10am CT | '
    || public.circle_time_label((((d + time '10:00') at time zone 'America/Chicago') at time zone 'Europe/London')::time) || ' UK | '
    || public.circle_time_label((((d + time '10:00') at time zone 'America/Chicago') at time zone 'Asia/Kolkata')::time, ':') || ' IST | Test Host';
  assert r.name = want, 'FAIL 6b: ' || r.name || ' expected ' || want; n := n + 1;

  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, source)
  values ('TG Circles | Mon | 6pm UK | 7pm Mars | Test Host', false, fac, 1, '18:00', 60, 'Europe/London', 'conflict', 'import') returning id into c;
  update public.circles set start_time = '18:30' where id = c returning * into r;
  assert r.name = 'TG Circles | Mon | 6.30pm UK | 7pm Mars | Test Host', 'FAIL 6c: ' || r.name; n := n + 1;

  -- 7. Other custom names stay exactly as they are.
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, source)
  values ('Bhakti Circles - Monday', false, fac, 1, '18:00', 60, 'Europe/London', 'conflict', 'import') returning id into c;
  update public.circles set weekday = 2, start_time = '19:00' where id = c returning * into r;
  assert r.name = 'Bhakti Circles - Monday', 'FAIL 7a: ' || r.name; n := n + 1;
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, source)
  values ('Test Host 6PM MST Friday', false, fac, 5, '18:00', 60, 'America/Phoenix', 'conflict', 'import') returning id into c;
  update public.circles set start_time = '19:00' where id = c returning * into r;
  assert r.name = 'Test Host 6PM MST Friday', 'FAIL 7b: ' || r.name; n := n + 1;
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, source)
  values ('TG Circles | Weekly | 7pm UK | Test Host', false, fac, 1, '19:00', 60, 'Europe/London', 'conflict', 'import') returning id into c;
  update public.circles set start_time = '20:00' where id = c returning * into r;
  assert r.name = 'TG Circles | Weekly | 7pm UK | Test Host', 'FAIL 7c: no day segment, left alone: ' || r.name; n := n + 1;

  -- 8. The helpers are internal: not callable over the API.
  foreach fn_name in array array['circle_zone_labels', 'circle_zone_label', 'circle_zone_for_label', 'circle_time_label', 'circle_name_follow_schedule', 'circles_auto_name'] loop
    assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = fn_name
                        and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
      'FAIL 8: ' || fn_name || ' is callable by an API role';
    assert exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = fn_name
                    and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'), 'FAIL 8: ' || fn_name || ' missing or no search_path';
    n := n + 2;
  end loop;

  raise exception 'TESTS PASSED: 07_circle_names % checks', n;
end $$;
