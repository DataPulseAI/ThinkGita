-- 11_training.sql
-- Facilitator training (migration 20261021000031): the seeded forms, trainee email clean-up, the status check, a
-- training form moving an applicant into training, certified trainees becoming verified facilitators, the training
-- email template keys, and grants.
-- Safety: one DO block that always ends in an exception, so every change rolls back. Made-up names only.

do $$
declare
  n int := 0;
  sfx text := substr(md5(random()::text), 1, 8);
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; fac uuid; fac2 uuid;
  r public.trainees;
  ok boolean;
begin
  -- 1. The six forms are seeded.
  assert (select count(*) from public.training_forms) = 6, 'FAIL 1a: form count'; n := n + 1;
  assert (select array_agg(key order by sort) from public.training_forms)
         = array['application', 'agreement', 'scene', 'empowerment', 'wisdom', 'video'], 'FAIL 1b: form keys'; n := n + 1;
  assert not (select required from public.training_forms where key = 'application'), 'FAIL 1c: application required'; n := n + 1;

  -- 2. Emails are trimmed and lowercased; updated_at is always set by the trigger.
  insert into public.trainees (email, first_name) values ('  TG-Test-Train-A-' || sfx || '@Example.ORG ', 'Ana') returning id into t1;
  select * into r from public.trainees where id = t1;
  assert r.email = 'tg-test-train-a-' || sfx || '@example.org', 'FAIL 2a: email not cleaned'; n := n + 1;
  assert r.status = 'applied', 'FAIL 2b: default status'; n := n + 1;
  update public.trainees set updated_at = '2000-01-01', notes = 'x' where id = t1;
  assert (select updated_at from public.trainees where id = t1) > '2001-01-01', 'FAIL 2c: updated_at not bumped'; n := n + 1;

  -- 3. Status check.
  begin update public.trainees set status = 'maybe' where id = t1; ok := false;
  exception when check_violation then ok := true; end;
  assert ok, 'FAIL 3: bad status accepted'; n := n + 1;

  -- 4. Application submissions don't start training; a training form does; certified trainees are left alone.
  insert into public.training_submissions (trainee_id, form_key, response_id, matched_by) values (t1, 'application', 'tg-test-app-' || sfx, 'email');
  assert (select status from public.trainees where id = t1) = 'applied', 'FAIL 4a: application started training'; n := n + 1;
  insert into public.training_submissions (trainee_id, form_key, response_id, matched_by) values (t1, 'agreement', 'tg-test-agr-' || sfx, 'tid');
  assert (select status from public.trainees where id = t1) = 'in_training', 'FAIL 4b: training form did not start training'; n := n + 1;
  insert into public.trainees (email, status) values ('tg-test-train-c-' || sfx || '@example.org', 'certified') returning id into t2;
  insert into public.training_submissions (trainee_id, form_key, response_id, matched_by) values (t2, 'wisdom', 'tg-test-wis-' || sfx, 'email');
  assert (select status from public.trainees where id = t2) = 'certified', 'FAIL 4c: certified trainee changed'; n := n + 1;

  -- 5. An unmatched submission matched later (trainee_id set by an admin) also starts training.
  insert into public.trainees (email) values ('tg-test-train-m-' || sfx || '@example.org') returning id into t3;
  insert into public.training_submissions (form_key, response_id) values ('scene', 'tg-test-scn-' || sfx);
  assert (select status from public.trainees where id = t3) = 'applied', 'FAIL 5a: changed before matching'; n := n + 1;
  update public.training_submissions set trainee_id = t3, matched_by = 'admin' where response_id = 'tg-test-scn-' || sfx;
  assert (select status from public.trainees where id = t3) = 'in_training', 'FAIL 5b: matching did not start training'; n := n + 1;

  -- 6. A certified trainee who becomes a facilitator is linked and verified, and their photo is used if they have none.
  update public.trainees set photo_url = 'https://example.org/tg-test-' || sfx || '.jpg', decided_at = now() where id = t2;
  insert into public.facilitators (name, email) values ('Test Train Cert', 'tg-test-train-c-' || sfx || '@example.org') returning id into fac;
  assert (select facilitator_id from public.trainees where id = t2) = fac, 'FAIL 6a: trainee not linked'; n := n + 1;
  assert (select verified_at is not null and verified_by = 'certified in training' from public.facilitators where id = fac), 'FAIL 6b: not verified'; n := n + 1;
  assert (select photo_url from public.facilitators where id = fac) = 'https://example.org/tg-test-' || sfx || '.jpg', 'FAIL 6c: photo not copied'; n := n + 1;

  -- 7. Not certified: nothing happens.
  insert into public.trainees (email, status) values ('tg-test-train-n-' || sfx || '@example.org', 'not_certified') returning id into t4;
  insert into public.facilitators (name, email) values ('Test Train Not', 'tg-test-train-n-' || sfx || '@example.org') returning id into fac2;
  assert (select facilitator_id from public.trainees where id = t4) is null, 'FAIL 7a: not certified linked'; n := n + 1;
  assert (select verified_at from public.facilitators where id = fac2) is null, 'FAIL 7b: not certified verified'; n := n + 1;

  -- 8. Email template keys.
  insert into public.email_templates (key, subject, body) values ('training_certified', 'Test', 'Test')
  on conflict (key) do update set subject = excluded.subject;
  assert (select subject from public.email_templates where key = 'training_certified') = 'Test', 'FAIL 8a: training template'; n := n + 1;
  begin insert into public.email_templates (key, subject, body) values ('nope', 'x', 'x'); ok := false;
  exception when check_violation then ok := true; end;
  assert ok, 'FAIL 8b: unknown template key accepted'; n := n + 1;
  assert exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'email_log' and column_name = 'trainee_id'), 'FAIL 8c: email_log.trainee_id'; n := n + 1;

  -- 9. Grants and row security.
  assert not has_table_privilege('anon', 'public.trainees', 'select'), 'FAIL 9a: anon reads trainees'; n := n + 1;
  assert not has_table_privilege('anon', 'public.training_submissions', 'select'), 'FAIL 9b: anon reads submissions'; n := n + 1;
  assert has_table_privilege('authenticated', 'public.trainees', 'select'), 'FAIL 9c: authenticated select'; n := n + 1;
  assert (select bool_and(relrowsecurity) from pg_class where oid in ('public.trainees'::regclass, 'public.training_submissions'::regclass, 'public.training_forms'::regclass)), 'FAIL 9d: RLS off'; n := n + 1;
  assert not has_function_privilege('authenticated', 'public.training_submission_started()', 'execute'), 'FAIL 9e'; n := n + 1;
  assert not has_function_privilege('authenticated', 'public.facilitator_from_certified_trainee()', 'execute'), 'FAIL 9f'; n := n + 1;
  assert not has_function_privilege('authenticated', 'public.trainees_touch()', 'execute'), 'FAIL 9g'; n := n + 1;

  raise exception 'TESTS PASSED: 11_training % checks', n;
end $$;
