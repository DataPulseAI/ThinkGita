-- 15_circle_signups.sql
-- Migration 20261024000037: circle attendees. Admins see all and pick circles (a manual match); facilitators only see
-- their own circles' attendees, without date of birth; my_circle_link_parts gives the sign-up link parts.
-- Safety: one DO block that always ends in an exception, so every change rolls back. Made-up names only.

do $$
declare
  n int := 0;
  sfx text := substr(md5(random()::text), 1, 8);
  admin_email text := 'tg-test-su-admin-' || sfx || '@example.org';
  fac_email text := 'tg-test-su-fac-' || sfx || '@example.org';
  co_email text := 'tg-test-su-co-' || sfx || '@example.org';
  f1 uuid; f2 uuid; c1 uuid; c2 uuid; s1 uuid; s2 uuid; s3 uuid;
  r public.circle_signups;
  cnt int;
  ok boolean;
  hosts text[];
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.admin_emails (email, name) values (admin_email, 'Test Admin');
  insert into public.facilitators (name, email, initiated_name) values ('Test Fac', fac_email, 'Test Initiated') returning id into f1;
  insert into public.facilitators (name, email) values ('Test Co', co_email) returning id into f2;
  insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, status, is_demo)
    values ('x', f1, 1, '19:00', 60, 'ended', true) returning id into c1;
  insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, status, is_demo)
    values ('y', f2, 2, '19:00', 60, 'ended', true) returning id into c2;
  insert into public.circle_cofacilitators (circle_id, facilitator_id) values (c1, f2);
  insert into public.circle_signups (response_id, form_id, submitted_at, circle_id, match_method, first_name, email, date_of_birth)
    values ('tg-test-' || sfx || '-1', 'test', now(), c1, 'link', 'One', 'one@example.org', '1990-01-01') returning id into s1;
  insert into public.circle_signups (response_id, form_id, submitted_at, circle_id, match_method, first_name)
    values ('tg-test-' || sfx || '-2', 'test', now(), c2, 'auto', 'Two') returning id into s2;
  insert into public.circle_signups (response_id, form_id, submitted_at, first_name)
    values ('tg-test-' || sfx || '-3', 'test', now(), 'Three') returning id into s3;

  -- 1. Facilitators: only their own circles' attendees (lead and co-facilitator), never the table itself.
  perform set_config('request.jwt.claims', json_build_object('email', fac_email, 'role', 'authenticated')::text, true);
  select count(*) into cnt from public.my_circle_signups() where id in (s1, s2, s3);
  assert cnt = 1, 'FAIL 1a: lead sees ' || cnt; n := n + 1;
  perform set_config('request.jwt.claims', json_build_object('email', co_email, 'role', 'authenticated')::text, true);
  select count(*) into cnt from public.my_circle_signups() where id in (s1, s2, s3);
  assert cnt = 2, 'FAIL 1b: co-facilitator sees ' || cnt; n := n + 1;
  assert not exists (select 1 from pg_proc where oid = 'public.my_circle_signups()'::regprocedure and 'date_of_birth' = any (proargnames)),
    'FAIL 1c: date of birth shown to facilitators'; n := n + 1;
  set local role authenticated;
  select count(*) into cnt from public.circle_signups where id in (s1, s2, s3);
  reset role;
  assert cnt = 0, 'FAIL 1d: facilitator read the table'; n := n + 1;

  -- 2. Link parts: hosts in order, initiated name first.
  perform set_config('request.jwt.claims', json_build_object('email', fac_email, 'role', 'authenticated')::text, true);
  select l.hosts into hosts from public.my_circle_link_parts() l where l.id = c1;
  assert hosts = array['Test Initiated', 'Test Co'], 'FAIL 2a: hosts ' || coalesce(hosts::text, 'null'); n := n + 1;
  assert not exists (select 1 from public.my_circle_link_parts() where id = c2), 'FAIL 2b: other circle'; n := n + 1;

  -- 3. Admins: see all; picking a circle is a manual match, logged; clearing it means "no circle".
  perform set_config('request.jwt.claims', json_build_object('email', admin_email, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into cnt from public.circle_signups where id in (s1, s2, s3);
  update public.circle_signups set circle_id = c2 where id = s3;
  reset role;
  assert cnt = 3, 'FAIL 3a: admin sees ' || cnt; n := n + 1;
  select * into r from public.circle_signups where id = s3;
  assert r.circle_id = c2 and r.match_method = 'manual' and r.matched_by = admin_email, 'FAIL 3b: manual match'; n := n + 1;
  assert exists (select 1 from public.audit_log where action = 'signup_matched' and detail ->> 'signup_id' = s3::text), 'FAIL 3c: logged'; n := n + 1;
  set local role authenticated;
  update public.circle_signups set circle_id = null where id = s2;
  reset role;
  select * into r from public.circle_signups where id = s2;
  assert r.circle_id is null and r.match_method = 'none', 'FAIL 3d: no circle'; n := n + 1;

  -- 4. Admins can't edit what the person wrote.
  set local role authenticated;
  begin update public.circle_signups set email = 'changed@example.org' where id = s1; ok := false;
  exception when insufficient_privilege then ok := true; end;
  reset role;
  assert ok, 'FAIL 4a: admin changed an answer'; n := n + 1;

  -- 5. The function (service role, no email) keeps its own method.
  perform set_config('request.jwt.claims', '', true);
  update public.circle_signups set circle_id = c1, match_method = 'auto' where id = s3;
  assert (select match_method from public.circle_signups where id = s3) = 'auto', 'FAIL 5a'; n := n + 1;

  -- 6. Grants and new columns.
  assert not has_function_privilege('anon', 'public.my_circle_signups()', 'execute'), 'FAIL 6a'; n := n + 1;
  assert not has_table_privilege('anon', 'public.circle_signups', 'select'), 'FAIL 6b'; n := n + 1;
  assert (select zoom_registration from public.circles where id = c1) = false, 'FAIL 6c: zoom_registration default'; n := n + 1;

  raise exception 'TESTS PASSED: 15_circle_signups % checks', n;
end $$;
