-- 01_circles_capacity.sql
-- Licence capacity (circles_capacity_check): a Zoom licence may host 2 overlapping meetings, never 3.
-- Also covers slot computation in circles_before_write: buffer minutes from settings, reference (UK) day and
-- time across timezones, the Sunday to Monday week wrap, and clock changes (several UK positions per circle).
--
-- Safety: one DO block that always ends in an exception, so every change rolls back.
-- Minute-of-week numbers: Monday 00:00 = 0, Monday 18:00 = 1080, Sunday 23:30 = 10050, week = 10080.

do $$
declare
  n int := 0;
  sfx text := substr(md5(random()::text), 1, 8);
  f1 uuid;
  l1 uuid; l2 uuid; l3 uuid; l4 uuid; l5 uuid; l6 uuid; l7 uuid;
  a uuid; b uuid; c uuid; d uuid; h uuid; k uuid; x uuid;
  r public.circles;
  st text; msg text;
begin
  -- Run as a plain database session: no signed-in user.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claim.email', '', true);
  -- Park live clashes so the licences created below are not handed to them by the re-check trigger.
  update public.circles set status = 'rejected' where status = 'conflict';
  update public.settings set buffer_minutes = 15, term_start = null, term_end = null where id = 1;

  insert into public.facilitators (name, email) values ('Test Host One', 'tg-test-cap-' || sfx || '@example.org') returning id into f1;
  insert into public.licences (label, sort_order) values ('zz-test-' || sfx || '-1', -100007) returning id into l1;
  insert into public.licences (label, sort_order) values ('zz-test-' || sfx || '-2', -100006) returning id into l2;
  insert into public.licences (label, sort_order) values ('zz-test-' || sfx || '-3', -100005) returning id into l3;
  insert into public.licences (label, sort_order) values ('zz-test-' || sfx || '-4', -100004) returning id into l4;
  insert into public.licences (label, sort_order) values ('zz-test-' || sfx || '-5', -100003) returning id into l5;
  insert into public.licences (label, sort_order) values ('zz-test-' || sfx || '-6', -100002) returning id into l6;
  insert into public.licences (label, sort_order) values ('zz-test-' || sfx || '-7', -100001) returning id into l7;

  -- 1. Slot computation for a plain UK circle (Mon 18:00, 60 min, 15 min buffer).
  insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('t', f1, 1, '18:00', 60, 'Europe/London', l1, 'pending', '2027-01-04', '2027-03-01', true) returning * into r;
  a := r.id;
  assert r.slots = '{[1080,1155)}'::int4multirange, 'FAIL 1a: slots ' || r.slots::text; n := n + 1;
  assert r.ref_weekday = 1 and r.ref_start_time = '18:00', 'FAIL 1b: ref time'; n := n + 1;
  assert not r.uk_time_shifts, 'FAIL 1c: uk_time_shifts should be false'; n := n + 1;
  assert r.slot is null, 'FAIL 1d: legacy slot column should be null'; n := n + 1;
  assert r.status = 'pending', 'FAIL 1e: status'; n := n + 1;

  -- 2. Second overlapping meeting on the same licence is allowed (Zoom allows 2 at once).
  insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('t', f1, 1, '18:00', 60, 'Europe/London', l1, 'pending', '2027-01-04', '2027-03-01', true) returning id into b;
  assert b is not null, 'FAIL 2: second meeting rejected'; n := n + 1;

  -- 3. A third one at the same time is rejected with errcode 23P01 and a no_licence_clash message.
  begin
    insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
    values ('t', f1, 1, '18:00', 60, 'Europe/London', l1, 'pending', '2027-01-04', '2027-03-01', true);
    raise exception 'FAIL 3: third overlapping meeting was accepted';
  exception when sqlstate '23P01' then
    get stacked diagnostics st = returned_sqlstate, msg = message_text;
    assert msg like 'no_licence_clash:%', 'FAIL 3b: message ' || msg;
    assert position(('zz-test-' || sfx || '-1') in msg) > 0, 'FAIL 3c: message should name the licence: ' || msg;
  end;
  n := n + 3;

  -- 4. The same time on another licence is fine.
  insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('t', f1, 1, '18:00', 60, 'Europe/London', l2, 'pending', '2027-01-04', '2027-03-01', true) returning id into c;
  assert c is not null, 'FAIL 4'; n := n + 1;

  -- 5. Buffer counts: 19:00 starts inside the 15 minute buffer of the two 18:00 meetings, so 3 overlap.
  begin
    insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
    values ('t', f1, 1, '19:00', 60, 'Europe/London', l1, 'pending', '2027-01-04', '2027-03-01', true);
    raise exception 'FAIL 5a: meeting inside the buffer was accepted';
  exception when sqlstate '23P01' then null;
  end;
  n := n + 1;
  -- 19:15 starts exactly when the buffer ends (ranges are half open): allowed.
  insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('t', f1, 1, '19:15', 60, 'Europe/London', l1, 'pending', '2027-01-04', '2027-03-01', true) returning id into d;
  assert d is not null, 'FAIL 5b'; n := n + 1;

  -- 6. Pairwise overlaps that never all meet at one moment are allowed (E 18:00, F 19:30, G 18:45 on l3).
  insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('t', f1, 1, '18:00', 60, 'Europe/London', l3, 'pending', '2027-01-04', '2027-03-01', true),
         ('t', f1, 1, '19:30', 60, 'Europe/London', l3, 'pending', '2027-01-04', '2027-03-01', true);
  insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('t', f1, 1, '18:45', 60, 'Europe/London', l3, 'pending', '2027-01-04', '2027-03-01', true) returning id into x;
  assert x is not null, 'FAIL 6'; n := n + 1;

  -- 7. Statuses that do not hold a licence are ignored: ended, rejected and conflict rows on a full licence.
  insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('t', f1, 1, '18:00', 60, 'Europe/London', l1, 'ended', '2027-01-04', '2027-03-01', true),
         ('t', f1, 1, '18:00', 60, 'Europe/London', l1, 'rejected', '2027-01-04', '2027-03-01', true);
  insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('t', f1, 1, '18:00', 60, 'Europe/London', l1, 'conflict', '2027-01-04', '2027-03-01', true) returning id into h;
  n := n + 1;
  -- ...but turning that conflict row into pending on the full licence is rejected (update path).
  begin
    update public.circles set status = 'pending' where id = h;
    raise exception 'FAIL 7b: update to pending on a full licence was accepted';
  exception when sqlstate '23P01' then null;
  end;
  n := n + 1;

  -- 8. Paused circles hold capacity.
  insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('t', f1, 2, '10:00', 60, 'Europe/London', l4, 'paused', '2027-01-04', '2027-03-01', true),
         ('t', f1, 2, '10:00', 60, 'Europe/London', l4, 'live', '2027-01-04', '2027-03-01', true);
  begin
    insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
    values ('t', f1, 2, '10:00', 60, 'Europe/London', l4, 'pending', '2027-01-04', '2027-03-01', true);
    raise exception 'FAIL 8: paused + live + pending accepted';
  exception when sqlstate '23P01' then null;
  end;
  n := n + 1;

  -- 9. Buffer minutes come from settings. With buffer 0, back to back meetings do not overlap.
  update public.settings set buffer_minutes = 0 where id = 1;
  insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('t', f1, 3, '18:00', 60, 'Europe/London', l5, 'pending', '2027-01-04', '2027-03-01', true),
         ('t', f1, 3, '18:00', 60, 'Europe/London', l5, 'pending', '2027-01-04', '2027-03-01', true);
  insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('t', f1, 3, '19:00', 45, 'Europe/London', l5, 'pending', '2027-01-04', '2027-03-01', true) returning * into r;
  k := r.id;
  assert r.slots = '{[4020,4065)}'::int4multirange, 'FAIL 9a: buffer 0 slots ' || r.slots::text; n := n + 1;
  -- Raising the buffer and recomputing these circles (what save_settings does) surfaces the clash and fails.
  update public.settings set buffer_minutes = 30 where id = 1;
  begin
    update public.circles set duration_min = duration_min where licence_id = l5;
    raise exception 'FAIL 9b: recompute with a bigger buffer did not report the clash';
  exception when sqlstate '23P01' then null;
  end;
  n := n + 1;
  select * into r from public.circles where id = k;
  assert r.slots = '{[4020,4065)}'::int4multirange, 'FAIL 9c: failed recompute should leave slots unchanged'; n := n + 1;
  update public.circles set duration_min = 50 where id = k returning * into r;
  assert upper(r.slots) - lower(r.slots) = 80, 'FAIL 9d: slot width should be duration + buffer (50 + 30)'; n := n + 1;
  update public.settings set buffer_minutes = 15 where id = 1;
  -- Out of range buffer is refused by the settings check.
  begin
    update public.settings set buffer_minutes = 121 where id = 1;
    raise exception 'FAIL 9e: buffer 121 accepted';
  exception when check_violation then null;
  end;
  n := n + 1;

  -- 10. Timezones: Kolkata Mon 23:30 and New York Mon 13:00 are both Mon 18:00 UK in January.
  insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('t', f1, 1, '23:30', 60, 'Asia/Kolkata', l2, 'pending', '2027-01-04', '2027-03-01', true) returning * into r;
  assert r.ref_weekday = 1 and r.ref_start_time = '18:00', 'FAIL 10a: Kolkata ref ' || r.ref_weekday || ' ' || r.ref_start_time; n := n + 1;
  assert r.slots = '{[1080,1155)}'::int4multirange, 'FAIL 10b: Kolkata slots ' || r.slots::text; n := n + 1;
  -- l2 now has c (London 18:00) and the Kolkata circle: a New York circle at the same moment is the third.
  begin
    insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
    values ('t', f1, 1, '13:00', 60, 'America/New_York', l2, 'pending', '2027-01-04', '2027-03-01', true);
    raise exception 'FAIL 10c: cross timezone third meeting accepted';
  exception when sqlstate '23P01' then null;
  end;
  n := n + 1;
  -- A local Tuesday can be a UK Monday: Kolkata Tue 02:00 = UK Mon 20:30.
  insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('t', f1, 2, '02:00', 60, 'Asia/Kolkata', null, 'conflict', '2027-01-04', '2027-03-01', true) returning * into r;
  assert r.ref_weekday = 1 and r.ref_start_time = '20:30', 'FAIL 10d: day shift ' || r.ref_weekday || ' ' || r.ref_start_time; n := n + 1;

  -- 11. Week wrap: Sun 23:30 for 60 min (+15) runs into Monday and is split into two ranges.
  insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('t', f1, 7, '23:30', 60, 'Europe/London', l6, 'pending', '2027-01-03', '2027-03-01', true) returning * into r;
  assert r.slots = '{[0,45),[10050,10080)}'::int4multirange, 'FAIL 11a: wrap slots ' || r.slots::text; n := n + 1;
  insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('t', f1, 7, '23:30', 60, 'Europe/London', l6, 'pending', '2027-01-03', '2027-03-01', true);
  begin
    insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
    values ('t', f1, 1, '00:15', 30, 'Europe/London', l6, 'pending', '2027-01-04', '2027-03-01', true);
    raise exception 'FAIL 11b: Monday 00:15 clash with Sunday late meetings not detected';
  exception when sqlstate '23P01' then null;
  end;
  n := n + 1;
  insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('t', f1, 1, '00:45', 30, 'Europe/London', l6, 'pending', '2027-01-04', '2027-03-01', true) returning id into x;
  assert x is not null, 'FAIL 11c'; n := n + 1;

  -- 12. Clock changes. UK goes back on 25 Oct 2026, US on 1 Nov 2026, so New York Mon 12:00 is UK 16:00 for
  --     one week and UK 17:00 otherwise. Both positions are held (merged here because of the buffer).
  insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('t', f1, 1, '15:00', 60, 'Europe/London', l7, 'pending', '2026-10-12', '2026-11-30', true),
         ('t', f1, 1, '15:00', 60, 'Europe/London', l7, 'pending', '2026-10-12', '2026-11-30', true);
  begin
    insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
    values ('t', f1, 1, '12:00', 60, 'America/New_York', null, 'conflict', '2026-10-12', '2026-11-30', true) returning * into r;
    assert r.uk_time_shifts, 'FAIL 12a: uk_time_shifts should be true';
    assert r.ref_weekday = 1 and r.ref_start_time = '17:00', 'FAIL 12b: ref should be the first session (17:00 UK)';
    assert r.slots = '{[960,1095)}'::int4multirange, 'FAIL 12c: DST slots ' || r.slots::text;
    -- Assigning it to l7 clashes in the 16:00 week (15:00 meetings + buffer run to 16:15).
    update public.circles set licence_id = l7, status = 'pending' where id = r.id;
    raise exception 'FAIL 12d: clock change clash not detected';
  exception when sqlstate '23P01' then null;
  end;
  n := n + 4;
  -- The same circle after both clock changes never moves (always 17:00 UK) and fits.
  insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, starts_on, ends_on, is_demo)
  values ('t', f1, 1, '12:00', 60, 'America/New_York', l7, 'pending', '2026-11-02', '2026-12-28', true) returning * into r;
  assert not r.uk_time_shifts and r.slots = '{[1020,1095)}'::int4multirange, 'FAIL 12e: post DST slots ' || r.slots::text; n := n + 1;

  -- 13. Moving a meeting onto a full licence by changing its time is checked too (update of start_time).
  begin
    update public.circles set start_time = '18:00' where id = d;
    raise exception 'FAIL 13: moving into a full slot accepted';
  exception when sqlstate '23P01' then null;
  end;
  n := n + 1;

  raise exception 'TESTS PASSED: 01_circles_capacity % checks', n;
end $$;
