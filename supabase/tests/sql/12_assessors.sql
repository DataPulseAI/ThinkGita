-- 12_assessors.sql
-- Assessors, assignment, and the cancelled / revoked outcomes (migration 20261021000034).
-- Safety: one DO block that always ends in an exception, so every change rolls back. Made-up names only.

do $$
declare
  n int := 0;
  sfx text := substr(md5(random()::text), 1, 8);
  admin_email text := 'tg-test-as-admin-' || sfx || '@example.org';
  asr text := 'tg-test-as-assessor-' || sfx || '@example.org';
  other text := 'tg-test-as-other-' || sfx || '@example.org';
  t1 uuid; t2 uuid; t3 uuid; fac uuid; la uuid; c1 uuid;
  r public.trainees;
  ok boolean;
  seen int;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.admin_emails (email, name) values (admin_email, 'Test Admin');
  insert into public.assessors (email, name) values (asr, 'Test Assessor');
  insert into public.trainees (email, first_name) values ('tg-test-as-t1-' || sfx || '@example.org', 'One') returning id into t1;
  insert into public.trainees (email, first_name) values ('tg-test-as-t2-' || sfx || '@example.org', 'Two') returning id into t2;

  -- 1. Assigning: to an assessor or an admin, stamped; anyone else is refused.
  perform set_config('request.jwt.claims', json_build_object('email', admin_email, 'role', 'authenticated')::text, true);
  update public.trainees set assigned_to = upper(asr) where id = t1;
  select * into r from public.trainees where id = t1;
  assert r.assigned_to = asr and r.assigned_at is not null and r.assigned_by = admin_email, 'FAIL 1a: assignment stamped'; n := n + 1;
  update public.trainees set assigned_to = admin_email where id = t2;
  assert (select assigned_to from public.trainees where id = t2) = admin_email, 'FAIL 1b: assign to an admin'; n := n + 1;
  begin update public.trainees set assigned_to = other where id = t2; ok := false;
  exception when others then ok := sqlerrm like 'bad_assignee%'; end;
  assert ok, 'FAIL 1c: assigned to someone who is neither'; n := n + 1;
  update public.trainees set assigned_to = null where id = t2;
  assert (select assigned_at from public.trainees where id = t2) is null, 'FAIL 1d: unassign clears the date'; n := n + 1;

  -- 2. The assessor: sees only their trainees, saves an assessment, nothing else.
  perform set_config('request.jwt.claims', json_build_object('email', asr, 'role', 'authenticated')::text, true);
  assert public.is_assessor(), 'FAIL 2a: is_assessor'; n := n + 1;
  r := public.save_assessment(t1, '{"delivery": {"rating": "meets"}}'::jsonb, 'Clear and warm');
  assert r.feedback = 'Clear and warm' and r.assessment -> 'delivery' ->> 'rating' = 'meets', 'FAIL 2b: save_assessment'; n := n + 1;
  begin perform public.save_assessment(t2, '{}'::jsonb, 'x'); ok := false;
  exception when others then ok := sqlerrm like 'not_allowed%'; end;
  assert ok, 'FAIL 2c: assessed someone not assigned to them'; n := n + 1;
  set local role authenticated;
  select count(*) into seen from public.trainees where id in (t1, t2);
  assert seen = 1, 'FAIL 2d: RLS shows only their own trainee'; n := n + 1;
  reset role;

  -- 3. Cancelled and revoked are statuses; email templates allow their keys.
  perform set_config('request.jwt.claims', '', true);
  update public.trainees set status = 'cancelled' where id = t2;
  assert (select status from public.trainees where id = t2) = 'cancelled', 'FAIL 3a: cancelled'; n := n + 1;
  insert into public.email_templates (key, subject, body) values ('training_revoked', 's', 'b')
    on conflict (key) do update set subject = excluded.subject;
  n := n + 1;

  -- 4. Revoking a trainee who facilitates: unverified for good, circles off the website, future applications revoked.
  insert into public.facilitators (name, email, verified_at, verified_by) values ('Test As Fac', 'tg-test-as-t1-' || sfx || '@example.org', now(), 'approval') returning id into fac;
  insert into public.licences (label, sort_order) values ('zz-test-' || sfx || '-as', -100004) returning id into la;
  insert into public.circles (name, name_auto, facilitator_id, weekday, start_time, duration_min, timezone, licence_id, status, source, is_demo, website_visible)
  values ('Test as one', false, fac, 3, '06:00', 60, 'Europe/London', la, 'pending', 'manual', true, true) returning id into c1;
  update public.trainees set status = 'revoked', decided_by = admin_email where id = t1;
  assert (select revoked_at is not null and verified_at is null from public.facilitators where id = fac), 'FAIL 4a: facilitator revoked'; n := n + 1;
  assert not (select website_visible from public.circles where id = c1), 'FAIL 4b: circle off the website'; n := n + 1;
  update public.facilitators set verified_at = now(), verified_by = 'approval' where id = fac;
  assert (select verified_at from public.facilitators where id = fac) is null, 'FAIL 4c: re-verified'; n := n + 1;
  begin update public.circles set website_visible = true where id = c1; ok := false;
  exception when others then ok := sqlerrm like 'facilitator_revoked%' or sqlerrm like 'host_unverified%'; end;
  assert ok, 'FAIL 4d: revoked host back on the website'; n := n + 1;
  insert into public.trainees (email, first_name) values (upper('tg-test-as-t1-' || sfx || '@example.org'), 'Again') returning id into t3;
  assert (select status from public.trainees where id = t3) = 'revoked', 'FAIL 4e: new application not revoked'; n := n + 1;

  -- 5. Grants.
  assert not has_function_privilege('anon', 'public.save_assessment(uuid, jsonb, text)', 'execute'), 'FAIL 5a'; n := n + 1;
  assert not has_function_privilege('authenticated', 'public.can_assess(uuid, text)', 'execute'), 'FAIL 5b'; n := n + 1;
  assert not has_function_privilege('authenticated', 'public.revoke_facilitator(uuid, text)', 'execute'), 'FAIL 5c'; n := n + 1;

  raise exception 'TESTS PASSED: 12_assessors % checks', n;
end $$;
