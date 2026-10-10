-- 03_framer_sync.sql
-- Website (Framer) sync bookkeeping: circles_mark_framer_dirty (framer_dirty, framer_rev), co-facilitator and
-- facilitator triggers, framer_daily_refresh selection, and framer_sync_tick's "is a sync due" decision.
-- framer_sync_tick queues an HTTP request with pg_net when due. The request only reaches the queue table inside
-- this transaction, which always rolls back, so nothing is ever sent. Requests are counted by xmin so rows from
-- other sessions never affect the result.
-- Safety: one DO block that always ends in an exception, so every change rolls back.

do $$
declare
  n int := 0;
  sfx text := substr(md5(random()::text), 1, 8);
  f1 uuid; f2 uuid; f3 uuid;
  la uuid; lb uuid;
  c1 uuid; c2 uuid; c3 uuid;
  d1 uuid; d2 uuid; d3 uuid; d4 uuid; d5 uuid; d6 uuid;
  r public.circles;
  rev0 bigint;
  i int;
  flds text[] := array['name', 'weekday', 'start_time', 'timezone', 'status', 'website_visible', 'starts_on', 'ends_on',
                       'language', 'circle_type', 'whatsapp_group_link', 'facilitator_id', 'preferred_start',
                       'website_name', 'website_photo_url', 'website_order', 'licence_id', 'is_demo'];
  vals text[];
  quiet text[] := array['notes', 'join_url', 'passcode', 'zoom_meeting_id', 'framer_error', 'framer_has', 'framer_photo_src',
                        'framer_item_id', 'duration_min', 'raw_submission', 'conflict_reason'];
  qvals text[] := array['''n''', '''https://meet.example.org/j''', '''123''', '''999''', '''err''', '''{"a":1}''', '''p''',
                        '''item-q''', '75', '''{"k":1}''', '''why'''];
  q0 int; q1 int;
  expected boolean;
  req record;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claim.email', '', true);
  update public.circles set status = 'rejected' where status = 'conflict';

  insert into public.facilitators (name, email) values ('Test Lead', 'tg-test-lead-' || sfx || '@example.org') returning id into f1;
  insert into public.facilitators (name, email) values ('Test Cofac', 'tg-test-cofac-' || sfx || '@example.org') returning id into f2;
  insert into public.facilitators (name, email) values ('Test Other', 'tg-test-other-' || sfx || '@example.org') returning id into f3;
  insert into public.licences (label, sort_order) values ('zz-test-' || sfx || '-a', -100002) returning id into la;
  insert into public.licences (label, sort_order) values ('zz-test-' || sfx || '-b', -100001) returning id into lb;

  -- 1. New circles start dirty with framer_rev 0.
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('Test circle one', false, f1, 4, '10:00', 60, 'Europe/London', la, 'pending', '2027-01-07', '2027-03-04', true) returning * into r;
  c1 := r.id;
  assert r.framer_dirty and r.framer_rev = 0, 'FAIL 1: new circle should be dirty with rev 0'; n := n + 1;

  -- 2. The sync's own write (framer_synced_at changes) clears dirty without bumping the counter.
  update public.circles set framer_dirty = false, framer_synced_at = clock_timestamp(), framer_item_id = 'item-' || sfx
   where id = c1 returning * into r;
  assert not r.framer_dirty and r.framer_rev = 0, 'FAIL 2: sync write should clear dirty, rev stays 0'; n := n + 1;

  -- 3. Fields the website does not show leave the circle clean.
  for i in 1 .. array_length(quiet, 1) loop
    execute format('update public.circles set %I = %s where id = $1', quiet[i], qvals[i]) using c1;
    select * into r from public.circles where id = c1;
    assert not r.framer_dirty and r.framer_rev = 0, 'FAIL 3: changing ' || quiet[i] || ' marked the circle dirty';
    n := n + 1;
  end loop;

  -- 4. Every website field marks the circle dirty and bumps framer_rev by exactly 1.
  vals := array['''Renamed test circle''', '5', '''10:30''', '''Asia/Kolkata''', '''approved''', 'true', '''2027-01-14''',
                '''2027-04-01''', '''Hindi''', '''Youth''', '''https://chat.example.org/g''', quote_literal(f3::text),
                '''2027-01-10''', '''Short Name''', '''https://img.example.org/a.jpg''', '7', quote_literal(lb::text), 'false'];
  for i in 1 .. array_length(flds, 1) loop
    update public.circles set framer_dirty = false, framer_synced_at = clock_timestamp() where id = c1 returning framer_rev into rev0;
    execute format('update public.circles set %I = %s where id = $1', flds[i], vals[i]) using c1;
    select * into r from public.circles where id = c1;
    assert r.framer_dirty, 'FAIL 4a: changing ' || flds[i] || ' did not mark the circle dirty';
    assert r.framer_rev = rev0 + 1, 'FAIL 4b: changing ' || flds[i] || ' should bump framer_rev by 1, got ' || r.framer_rev || ' from ' || rev0;
    n := n + 2;
  end loop;
  -- Writing the same value again is not a change.
  update public.circles set framer_dirty = false, framer_synced_at = clock_timestamp() where id = c1 returning framer_rev into rev0;
  update public.circles set website_name = 'Short Name' where id = c1 returning * into r;
  assert not r.framer_dirty and r.framer_rev = rev0, 'FAIL 4c: same-value update marked dirty'; n := n + 1;

  -- 5. While dirty, any edit bumps framer_rev (so a sync that loaded the old row will not clear dirty).
  update public.circles set website_order = 8 where id = c1 returning framer_rev into rev0;
  update public.circles set notes = 'edited during sync' where id = c1 returning * into r;
  assert r.framer_dirty and r.framer_rev = rev0 + 1, 'FAIL 5: edit while dirty should bump framer_rev'; n := n + 1;
  -- The sync's write in the same state does not bump it, even if it also writes other sync columns.
  update public.circles set framer_dirty = false, framer_synced_at = clock_timestamp(), framer_error = null, framer_has = '{}'
   where id = c1 returning * into r;
  assert not r.framer_dirty and r.framer_rev = rev0 + 1, 'FAIL 5b: sync write bumped framer_rev'; n := n + 1;

  -- 6. Co-facilitator added or removed marks the circle dirty.
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('Test circle two', false, f1, 2, '09:00', 60, 'Europe/London', la, 'pending', '2027-01-05', '2027-03-02', true) returning id into c2;
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('Test circle three', false, f3, 3, '09:00', 60, 'Europe/London', la, 'pending', '2027-01-06', '2027-03-03', true) returning id into c3;
  update public.circles set framer_dirty = false, framer_synced_at = clock_timestamp() where id in (c2, c3);
  insert into public.circle_cofacilitators (circle_id, facilitator_id) values (c3, f2);
  select * into r from public.circles where id = c3;
  assert r.framer_dirty and r.framer_rev = 1, 'FAIL 6a: adding a co-facilitator did not mark dirty'; n := n + 1;
  update public.circles set framer_dirty = false, framer_synced_at = clock_timestamp() where id = c3;
  execute 'del' || 'ete from public.circle_cofacilitators where circle_id = $1 and facilitator_id = $2' using c3, f2;
  select * into r from public.circles where id = c3;
  assert r.framer_dirty, 'FAIL 6b: removing a co-facilitator did not mark dirty'; n := n + 1;
  insert into public.circle_cofacilitators (circle_id, facilitator_id) values (c3, f2);

  -- 7. Facilitator name, initiated name and photo changes mark the circles they lead or co-facilitate.
  update public.circles set framer_dirty = false, framer_synced_at = clock_timestamp() where id in (c1, c2, c3);
  update public.facilitators set name = 'Test Lead Renamed' where id = f1;
  assert (select framer_dirty from public.circles where id = c2), 'FAIL 7a: lead rename did not mark led circle'; n := n + 1;
  assert not (select framer_dirty from public.circles where id = c3), 'FAIL 7b: lead rename marked an unrelated circle'; n := n + 1;
  update public.circles set framer_dirty = false, framer_synced_at = clock_timestamp() where id in (c2, c3);
  update public.facilitators set initiated_name = 'Test Initiated' where id = f2;
  assert (select framer_dirty from public.circles where id = c3), 'FAIL 7c: co-facilitator initiated name did not mark circle'; n := n + 1;
  assert not (select framer_dirty from public.circles where id = c2), 'FAIL 7d: co-facilitator change marked unrelated circle'; n := n + 1;
  update public.circles set framer_dirty = false, framer_synced_at = clock_timestamp() where id in (c1, c3);
  update public.facilitators set photo_url = 'https://img.example.org/p.jpg' where id = f3;
  assert (select framer_dirty from public.circles where id = c3), 'FAIL 7e: lead photo did not mark led circle'; n := n + 1;
  assert (select framer_dirty from public.circles where id = c1), 'FAIL 7f: c1 is led by f3 since check 4, photo should mark it'; n := n + 1;
  update public.circles set framer_dirty = false, framer_synced_at = clock_timestamp() where id in (c1, c2, c3);
  update public.facilitators set phone = '+44 0000 000000' where id = f1;
  assert not (select framer_dirty from public.circles where id = c2), 'FAIL 7g: phone change marked dirty'; n := n + 1;
  -- Current behaviour: first_name / last_name changes do not mark circles dirty (see report).
  update public.facilitators set first_name = 'Testfirst' where id = f1;
  assert not (select framer_dirty from public.circles where id = c2), 'FAIL 7h: first_name behaviour changed, update this check'; n := n + 1;

  -- 8. Removing a circle that has co-facilitators works (cascade plus the co-facilitator trigger).
  execute 'del' || 'ete from public.circles where id = $1' using c3;
  assert not exists (select 1 from public.circle_cofacilitators where circle_id = c3), 'FAIL 8: co-facilitator rows not cascaded'; n := n + 1;

  -- 9. framer_daily_refresh marks only listed, not finished, clean circles whose text depends on the date.
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, starts_on, framer_item_id, is_demo)
  values ('d1', false, f1, 1, '10:00', 60, 'Asia/Kolkata', 'conflict', current_date - 1, 'i1-' || sfx, true) returning id into d1;
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, starts_on, framer_item_id, is_demo)
  values ('d2', false, f1, 1, '10:00', 60, 'Asia/Kolkata', 'conflict', current_date - 10, 'i2-' || sfx, true) returning id into d2;
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, starts_on, framer_item_id, is_demo)
  values ('d3', false, f1, 1, '10:00', 60, 'Asia/Kolkata', 'ended', current_date, 'i3-' || sfx, true) returning id into d3;
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, starts_on, framer_item_id, is_demo)
  values ('d4', false, f1, 1, '10:00', 60, 'Asia/Kolkata', 'conflict', current_date - 1, null, true) returning id into d4;
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, preferred_start, framer_item_id, is_demo)
  values ('d5', false, f1, 1, '10:00', 60, 'Asia/Kolkata', 'conflict', current_date - 2, 'i5-' || sfx, true) returning id into d5;
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, status, starts_on, framer_item_id, is_demo)
  values ('d6', false, f1, 1, '10:00', 60, 'Europe/London', 'conflict', current_date - 30, 'i6-' || sfx, true) returning id into d6;
  update public.circles set framer_dirty = false, framer_synced_at = clock_timestamp() where id in (d1, d2, d3, d4, d5, d6);
  perform public.framer_daily_refresh();
  assert (select framer_dirty from public.circles where id = d1), 'FAIL 9a: started yesterday should be marked'; n := n + 1;
  assert not (select framer_dirty from public.circles where id = d2), 'FAIL 9b: started 10 days ago (no clock change zone) marked'; n := n + 1;
  assert not (select framer_dirty from public.circles where id = d3), 'FAIL 9c: ended circle marked'; n := n + 1;
  assert not (select framer_dirty from public.circles where id = d4), 'FAIL 9d: circle without a Framer item marked'; n := n + 1;
  assert (select framer_dirty from public.circles where id = d5), 'FAIL 9e: preferred_start 2 days ago should be marked'; n := n + 1;
  -- UK clock change within the next 8 days decides d6.
  expected := ((now() at time zone 'Europe/London') - (now() at time zone 'UTC'))
              <> (((now() + interval '8 days') at time zone 'Europe/London') - ((now() + interval '8 days') at time zone 'UTC'));
  assert (select framer_dirty from public.circles where id = d6) = expected,
    'FAIL 9f: UK circle refresh should be ' || expected::text; n := n + 1;

  -- 10. framer_sync_tick: start from a quiet state (nothing dirty, no publish pending, no lock, no failures).
  update public.circles set framer_dirty = false where framer_dirty;
  update public.settings set framer_sync_lock = null, framer_fail_count = 0, framer_failed_at = null,
         framer_publish_pending = false, framer_auto_publish = true, framer_publish_attempts = 0, framer_publish_tried_at = null
   where id = 1;
  select count(*) into q0 from net.http_request_queue where xmin::text = (pg_current_xact_id()::xid)::text;
  perform public.framer_sync_tick();
  select count(*) into q1 from net.http_request_queue where xmin::text = (pg_current_xact_id()::xid)::text;
  assert q1 = q0, 'FAIL 10a: tick queued a request with nothing to do'; n := n + 1;

  -- A dirty circle makes a sync due; check what would be called.
  update public.circles set framer_dirty = true, framer_error = null where id = c1;
  perform public.framer_sync_tick();
  select count(*) into q1 from net.http_request_queue where xmin::text = (pg_current_xact_id()::xid)::text;
  assert q1 = q0 + 1, 'FAIL 10b: dirty circle did not queue a sync'; n := n + 1;
  select * into req from net.http_request_queue where xmin::text = (pg_current_xact_id()::xid)::text order by id desc limit 1;
  assert req.url like 'https://%.supabase.co/functions/v1/framer-sync', 'FAIL 10c: url ' || req.url; n := n + 1;
  assert req.headers ? 'x-cron-secret' and convert_from(req.body, 'utf8')::jsonb ->> 'action' = 'sync', 'FAIL 10d: request headers/body'; n := n + 1;
  q0 := q1;

  -- A fresh lock (another sync running) stops it; a lock older than 3 minutes does not.
  update public.settings set framer_sync_lock = now() where id = 1;
  perform public.framer_sync_tick();
  select count(*) into q1 from net.http_request_queue where xmin::text = (pg_current_xact_id()::xid)::text;
  assert q1 = q0, 'FAIL 10e: tick ran while locked'; n := n + 1;
  update public.settings set framer_sync_lock = now() - interval '4 minutes' where id = 1;
  perform public.framer_sync_tick();
  select count(*) into q1 from net.http_request_queue where xmin::text = (pg_current_xact_id()::xid)::text;
  assert q1 = q0 + 1, 'FAIL 10f: stale lock blocked the tick'; n := n + 1;
  q0 := q1;
  update public.settings set framer_sync_lock = null where id = 1;

  -- Whole-sync failures back off 2^n minutes (3 failures: 8 minutes).
  update public.settings set framer_fail_count = 3, framer_failed_at = now() - interval '5 minutes' where id = 1;
  perform public.framer_sync_tick();
  select count(*) into q1 from net.http_request_queue where xmin::text = (pg_current_xact_id()::xid)::text;
  assert q1 = q0, 'FAIL 10g: tick ignored the failure backoff'; n := n + 1;
  update public.settings set framer_failed_at = now() - interval '9 minutes' where id = 1;
  perform public.framer_sync_tick();
  select count(*) into q1 from net.http_request_queue where xmin::text = (pg_current_xact_id()::xid)::text;
  assert q1 = q0 + 1, 'FAIL 10h: tick still backing off after 9 minutes'; n := n + 1;
  q0 := q1;
  update public.settings set framer_fail_count = 0, framer_failed_at = null where id = 1;

  -- A circle whose last push failed is retried only in the first 2 minutes of each hour...
  update public.circles set framer_error = 'Framer refused the item' where id = c1;
  expected := extract(minute from now()) < 2;
  perform public.framer_sync_tick();
  select count(*) into q1 from net.http_request_queue where xmin::text = (pg_current_xact_id()::xid)::text;
  assert (q1 = q0 + 1) = expected, 'FAIL 10i: failed-item retry should be due = ' || expected::text; n := n + 1;
  q0 := q1;
  -- ...but one held back only for missing website fields is always due.
  update public.circles set framer_error = 'Not shown on the website until set: photo' where id = c1;
  perform public.framer_sync_tick();
  select count(*) into q1 from net.http_request_queue where xmin::text = (pg_current_xact_id()::xid)::text;
  assert q1 = q0 + 1, 'FAIL 10j: missing-fields item should always be due'; n := n + 1;
  q0 := q1;
  update public.circles set framer_dirty = false, framer_error = null where id = c1;

  -- Publish retry: never when auto publish is off; otherwise with backoff 2^attempts minutes, capped at 30.
  update public.settings set framer_publish_pending = true, framer_auto_publish = false where id = 1;
  perform public.framer_sync_tick();
  select count(*) into q1 from net.http_request_queue where xmin::text = (pg_current_xact_id()::xid)::text;
  assert q1 = q0, 'FAIL 10k: publish retry ran with auto publish off'; n := n + 1;
  update public.settings set framer_auto_publish = true, framer_publish_tried_at = null where id = 1;
  perform public.framer_sync_tick();
  select count(*) into q1 from net.http_request_queue where xmin::text = (pg_current_xact_id()::xid)::text;
  assert q1 = q0 + 1, 'FAIL 10l: pending publish never tried should be due'; n := n + 1;
  q0 := q1;
  update public.settings set framer_publish_attempts = 2, framer_publish_tried_at = now() - interval '3 minutes' where id = 1;
  perform public.framer_sync_tick();
  select count(*) into q1 from net.http_request_queue where xmin::text = (pg_current_xact_id()::xid)::text;
  assert q1 = q0, 'FAIL 10m: publish retried before its 4 minute backoff'; n := n + 1;
  update public.settings set framer_publish_tried_at = now() - interval '5 minutes' where id = 1;
  perform public.framer_sync_tick();
  select count(*) into q1 from net.http_request_queue where xmin::text = (pg_current_xact_id()::xid)::text;
  assert q1 = q0 + 1, 'FAIL 10n: publish not retried after backoff'; n := n + 1;
  q0 := q1;
  update public.settings set framer_publish_attempts = 12, framer_publish_tried_at = now() - interval '29 minutes' where id = 1;
  perform public.framer_sync_tick();
  select count(*) into q1 from net.http_request_queue where xmin::text = (pg_current_xact_id()::xid)::text;
  assert q1 = q0, 'FAIL 10o: backoff should be capped at 30 minutes, not shorter'; n := n + 1;
  update public.settings set framer_publish_tried_at = now() - interval '31 minutes' where id = 1;
  perform public.framer_sync_tick();
  select count(*) into q1 from net.http_request_queue where xmin::text = (pg_current_xact_id()::xid)::text;
  assert q1 = q0 + 1, 'FAIL 10p: capped backoff did not allow a retry after 31 minutes'; n := n + 1;

  raise exception 'TESTS PASSED: 03_framer_sync % checks', n;
end $$;
