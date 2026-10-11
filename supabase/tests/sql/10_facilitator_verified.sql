-- 10_facilitator_verified.sql
-- Verified facilitators (migration 20261011000030): approving a circle verifies its host and co-facilitators (and a
-- co-host added on approval); admins can verify or un-verify directly; facilitators can't; a circle that isn't running
-- yet can't go on the website until its host is verified.
-- Safety: one DO block that always ends in an exception, so every change rolls back. Made-up names only.

do $$
declare
  n int := 0;
  sfx text := substr(md5(random()::text), 1, 8);
  admin_email text := 'tg-test-ver-admin-' || sfx || '@example.org';
  host uuid; co uuid; other uuid; la uuid; c1 uuid; c2 uuid;
  r public.facilitators;
  ok boolean;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.admin_emails (email, name) values (admin_email, 'Test Admin');
  insert into public.facilitators (name, email) values ('Test Ver Host', 'tg-test-ver-host-' || sfx || '@example.org') returning id into host;
  insert into public.facilitators (name, email) values ('Test Ver Co', 'tg-test-ver-co-' || sfx || '@example.org') returning id into co;
  insert into public.facilitators (name, email) values ('Test Ver Other', 'tg-test-ver-other-' || sfx || '@example.org') returning id into other;
  insert into public.licences (label, sort_order) values ('zz-test-' || sfx || '-v', -100003) returning id into la;
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, source, is_demo,
                              pending_cohost)
  values ('Test ver one', false, host, 2, '06:00', 60, 'Europe/London', la, 'pending', 'tally', true,
          jsonb_build_object('email', 'tg-test-ver-cohost-' || sfx || '@example.org', 'first_name', 'Coho'))
  returning id into c1;
  insert into public.circle_cofacilitators (circle_id, facilitator_id) values (c1, co);

  -- 1. New people start unverified; a pending circle verifies nobody.
  assert (select verified_at from public.facilitators where id = host) is null, 'FAIL 1a: host verified too early'; n := n + 1;
  assert (select verified_at from public.facilitators where id = co) is null, 'FAIL 1b: co verified too early'; n := n + 1;

  -- 2. Unverified host: a pending circle can't be switched on for the website.
  begin update public.circles set website_visible = true where id = c1; ok := false;
  exception when others then ok := sqlerrm like 'host_unverified%'; end;
  assert ok, 'FAIL 2: website switched on for an unverified host'; n := n + 1;

  -- 3. Approval (going live) verifies host, co-facilitator and the co-host added on approval.
  update public.circles set status = 'live', zoom_meeting_id = 'V' || sfx where id = c1;
  select * into r from public.facilitators where id = host;
  assert r.verified_at is not null and r.verified_by = 'approval', 'FAIL 3a: host not verified by approval'; n := n + 1;
  assert (select verified_at from public.facilitators where id = co) is not null, 'FAIL 3b: co not verified'; n := n + 1;
  assert (select verified_at from public.facilitators where email = 'tg-test-ver-cohost-' || sfx || '@example.org') is not null, 'FAIL 3c: co-host not verified'; n := n + 1;

  -- 4. Adding someone to a running circle verifies them; to a pending one doesn't.
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, source, is_demo)
  values ('Test ver two', false, host, 2, '08:00', 60, 'Europe/London', la, 'pending', 'manual', true) returning id into c2;
  insert into public.circle_cofacilitators (circle_id, facilitator_id) values (c2, other);
  assert (select verified_at from public.facilitators where id = other) is null, 'FAIL 4a: pending circle verified'; n := n + 1;
  -- Verified host: the pending circle can now go on the website.
  update public.circles set website_visible = true where id = c2;
  assert (select website_visible from public.circles where id = c2), 'FAIL 4b: verified host blocked'; n := n + 1;
  insert into public.circle_cofacilitators (circle_id, facilitator_id) values (c1, other);
  assert (select verified_by from public.facilitators where id = other) = 'added to a running circle', 'FAIL 4c: running circle'; n := n + 1;

  -- 5. Admins verify and un-verify directly; it is logged.
  perform set_config('request.jwt.claims', json_build_object('email', admin_email, 'role', 'authenticated')::text, true);
  r := public.set_facilitator_verified(other, false);
  assert r.verified_at is null and r.verified_by is null, 'FAIL 5a: unverify'; n := n + 1;
  r := public.set_facilitator_verified(other, true);
  assert r.verified_at is not null and r.verified_by = admin_email, 'FAIL 5b: verify by admin'; n := n + 1;
  r := public.set_facilitator_verified(host, true);
  assert r.verified_by = 'approval', 'FAIL 5c: re-verifying keeps how they were verified'; n := n + 1;
  assert (select count(*) from public.audit_log where actor = admin_email and action in ('facilitator_verified', 'facilitator_unverified')
           and detail ->> 'facilitator_id' in (other::text, host::text)) = 3, 'FAIL 5d: audit lines'; n := n + 1;

  -- 6. Facilitators can't verify anyone, themselves included.
  perform set_config('request.jwt.claims', json_build_object('email', 'tg-test-ver-co-' || sfx || '@example.org', 'role', 'authenticated')::text, true);
  begin perform public.set_facilitator_verified(co, true); ok := false;
  exception when others then ok := sqlerrm like 'not_admin%'; end;
  assert ok, 'FAIL 6: facilitator verified someone'; n := n + 1;
  perform set_config('request.jwt.claims', '', true);

  -- 7. Grants.
  assert not has_function_privilege('anon', 'public.set_facilitator_verified(uuid, boolean)', 'execute'), 'FAIL 7a'; n := n + 1;
  assert not has_function_privilege('authenticated', 'public.verify_circle_team(uuid, text)', 'execute'), 'FAIL 7b'; n := n + 1;

  raise exception 'TESTS PASSED: 10_facilitator_verified % checks', n;
end $$;
