-- 14_assessment_submit.sql
-- Migration 20261023000036: assessors submit an assessment with a recommendation; it locks for them; admins reopen.
-- Safety: one DO block that always ends in an exception, so every change rolls back. Made-up names only.

do $$
declare
  n int := 0;
  sfx text := substr(md5(random()::text), 1, 8);
  admin_email text := 'tg-test-sub-admin-' || sfx || '@example.org';
  asr text := 'tg-test-sub-assessor-' || sfx || '@example.org';
  t1 uuid;
  r public.trainees;
  ok boolean;
  msg text;
begin
  if to_regprocedure('public.submit_assessment(uuid, jsonb, text, text)') is null then
    raise exception 'NOT READY: migration 20261023000036_assessment_submit is not applied yet. Run supabase db push from the repo root first.';
  end if;
  perform set_config('request.jwt.claims', '', true);
  insert into public.admin_emails (email, name) values (admin_email, 'Test Admin');
  insert into public.assessors (email, name) values (asr, 'Test Assessor');
  insert into public.trainees (email, first_name) values ('tg-test-sub-t1-' || sfx || '@example.org', 'One') returning id into t1;
  update public.trainees set assigned_to = asr where id = t1;

  -- 1. The assessor needs a recommendation to submit.
  perform set_config('request.jwt.claims', json_build_object('email', asr, 'role', 'authenticated')::text, true);
  begin perform public.submit_assessment(t1, '{}'::jsonb, 'x', null); msg := null; ok := false;
  exception when others then msg := sqlerrm; ok := sqlerrm like 'no_recommendation%'; end;
  assert ok, 'FAIL 1a: submitted without a recommendation (got: ' || coalesce(msg, 'no error') || ')'; n := n + 1;
  r := public.submit_assessment(t1, '{"delivery": {"rating": "meets"}}'::jsonb, 'Clear', 'certify');
  assert r.recommendation = 'certify' and r.assessment_submitted_at is not null and r.assessment_submitted_by = asr, 'FAIL 1b: submit'; n := n + 1;
  assert r.status <> 'certified', 'FAIL 1c: submitting must not decide the outcome'; n := n + 1;

  -- 2. Locked for the assessor once submitted.
  begin perform public.save_assessment(t1, '{}'::jsonb, 'changed'); msg := null; ok := false;
  exception when others then msg := sqlerrm; ok := sqlerrm like 'submitted%'; end;
  assert ok, 'FAIL 2a: assessor changed a submitted assessment (got: ' || coalesce(msg, 'no error') || ')'; n := n + 1;
  begin perform public.submit_assessment(t1, '{}'::jsonb, 'again', 'not_yet'); msg := null; ok := false;
  exception when others then msg := sqlerrm; ok := sqlerrm like 'submitted%'; end;
  assert ok, 'FAIL 2b: submitted twice (got: ' || coalesce(msg, 'no error') || ')'; n := n + 1;
  begin perform public.reopen_assessment(t1); msg := null; ok := false;
  exception when others then msg := sqlerrm; ok := sqlerrm like 'not_admin%'; end;
  assert ok, 'FAIL 2c: assessor reopened (got: ' || coalesce(msg, 'no error') || ')'; n := n + 1;

  -- 3. Admins can still edit, and reopen it for the assessor.
  perform set_config('request.jwt.claims', json_build_object('email', admin_email, 'role', 'authenticated')::text, true);
  r := public.save_assessment(t1, '{}'::jsonb, 'Admin note');
  assert r.feedback = 'Admin note', 'FAIL 3a: admin edit'; n := n + 1;
  r := public.reopen_assessment(t1);
  assert r.assessment_submitted_at is null and r.recommendation = 'certify', 'FAIL 3b: reopen keeps the old recommendation'; n := n + 1;
  perform set_config('request.jwt.claims', json_build_object('email', asr, 'role', 'authenticated')::text, true);
  r := public.save_assessment(t1, '{}'::jsonb, 'Editing again');
  assert r.feedback = 'Editing again', 'FAIL 3c: assessor can edit after reopen'; n := n + 1;
  assert exists (select 1 from public.audit_log where action = 'training_assessment_reopened' and detail ->> 'trainee_id' = t1::text), 'FAIL 3d: reopen logged'; n := n + 1;

  -- 4. Grants.
  assert not has_function_privilege('anon', 'public.submit_assessment(uuid, jsonb, text, text)', 'execute'), 'FAIL 4a'; n := n + 1;
  assert not has_function_privilege('anon', 'public.reopen_assessment(uuid)', 'execute'), 'FAIL 4b'; n := n + 1;

  raise exception 'TESTS PASSED: 14_assessment_submit % checks', n;
end $$;
