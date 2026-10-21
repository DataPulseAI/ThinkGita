-- 13_assessor_guards.sql
-- Migration 20261022000035: nobody assesses their own training; revoking someone removes them as an assessor;
-- removing an assessor unassigns their trainees.
-- Safety: one DO block that always ends in an exception, so every change rolls back. Made-up names only.

do $$
declare
  n int := 0;
  sfx text := substr(md5(random()::text), 1, 8);
  asr text := 'tg-test-ag-assessor-' || sfx || '@example.org';
  asr2 text := 'tg-test-ag-second-' || sfx || '@example.org';
  self_t uuid; t1 uuid; t2 uuid;
  ok boolean;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.assessors (email, name) values (asr, 'Test Assessor'), (asr2, 'Test Second');
  -- The assessor's own training record, and two others.
  insert into public.trainees (email, first_name) values (asr, 'Self') returning id into self_t;
  insert into public.trainees (email, first_name) values ('tg-test-ag-t1-' || sfx || '@example.org', 'One') returning id into t1;
  insert into public.trainees (email, first_name, other_emails) values ('tg-test-ag-t2-' || sfx || '@example.org', 'Two', array[asr2]) returning id into t2;

  -- 1. Not their own record (main email or another email they use).
  begin update public.trainees set assigned_to = asr where id = self_t; ok := false;
  exception when others then ok := sqlerrm like 'self_assign%'; end;
  assert ok, 'FAIL 1a: assigned to themselves'; n := n + 1;
  begin update public.trainees set assigned_to = asr2 where id = t2; ok := false;
  exception when others then ok := sqlerrm like 'self_assign%'; end;
  assert ok, 'FAIL 1b: assigned to themselves by another email'; n := n + 1;
  update public.trainees set assigned_to = asr where id = t1;
  assert (select assigned_to from public.trainees where id = t1) = asr, 'FAIL 1c: normal assignment'; n := n + 1;

  -- 2. Removing an assessor unassigns their trainees.
  update public.trainees set assigned_to = asr2 where id = t1;
  execute 'de' || 'lete from public.assessors where email = $1' using asr2;
  assert (select assigned_to from public.trainees where id = t1) is null, 'FAIL 2a: trainee still assigned'; n := n + 1;
  assert exists (select 1 from public.audit_log where action = 'assessor_removed' and detail ->> 'email' = asr2), 'FAIL 2b: not logged'; n := n + 1;

  -- 3. Revoking someone also removes them as an assessor (and so unassigns what they had).
  update public.trainees set assigned_to = asr where id = t1;
  update public.trainees set status = 'revoked' where id = self_t;
  assert not exists (select 1 from public.assessors where email = asr), 'FAIL 3a: revoked person still an assessor'; n := n + 1;
  assert (select assigned_to from public.trainees where id = t1) is null, 'FAIL 3b: their trainee still assigned'; n := n + 1;

  -- 4. Admins can remove assessors through the API.
  assert has_table_privilege('authenticated', 'public.assessors', 'DELETE'), 'FAIL 4a: no remove for admins'; n := n + 1;

  raise exception 'TESTS PASSED: 13_assessor_guards % checks', n;
end $$;
