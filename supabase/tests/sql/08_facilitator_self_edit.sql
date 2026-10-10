-- 08_facilitator_self_edit.sql
-- Facilitators edit their own details (migration 20261010000027): update_my_profile() changes only names, phone and
-- photo on the caller's own row, checks every value, logs the change, and refuses anyone without a facilitator row.
-- Direct updates stay blocked by RLS. Photo uploads are limited to the caller's own folder.
-- Safety: one DO block that always ends in an exception, so every change rolls back. Made-up names only.

do $$
declare
  n int := 0;
  sfx text := substr(md5(random()::text), 1, 8);
  em text := 'tg-test-self-' || sfx || '@example.org';
  other_em text := 'tg-test-other-' || sfx || '@example.org';
  me uuid;
  other uuid;
  r public.facilitators;
  cnt int;
  ok boolean;
  photo text;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.facilitators (name, email, phone) values ('Test Self', em, '+44 7700 900001') returning id into me;
  insert into public.facilitators (name, email, phone) values ('Test Other', other_em, '+44 7700 900002') returning id into other;
  photo := 'https://abcdefgh.supabase.co/storage/v1/object/public/facilitator-photos/' || me || '/1700000000000.jpg';

  perform set_config('request.jwt.claims', json_build_object('email', em, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- 1. The caller's own id, and nobody else's.
  assert public.my_facilitator_id() = me, 'FAIL 1: my_facilitator_id'; n := n + 1;

  -- 2. Saving names, phone and an uploaded photo.
  r := public.update_my_profile(' Isvari ', 'Test', 'Self', '+44 (0)7700-900.555', photo);
  assert r.initiated_name = 'Isvari' and r.first_name = 'Test' and r.last_name = 'Self' and r.phone = '+44 (0)7700-900.555'
     and r.photo_url = photo and r.email = em and r.name = 'Test Self', 'FAIL 2: saved values'; n := n + 1;

  -- 3. Empty text clears a field; saving the same values again changes nothing.
  r := public.update_my_profile('Isvari', 'Test', '', '', photo);
  assert r.last_name is null and r.phone is null, 'FAIL 3a: empty clears'; n := n + 1;
  r := public.update_my_profile('Isvari', 'Test', '', '', photo);
  assert r.last_name is null, 'FAIL 3b: no-op save'; n := n + 1;

  -- 4. Refused values.
  begin perform public.update_my_profile('Isvari', 'Test', 'Self', 'call me', photo); ok := false;
  exception when others then ok := sqlerrm like 'invalid_profile: phone%'; end;
  assert ok, 'FAIL 4a: bad phone accepted'; n := n + 1;
  begin perform public.update_my_profile('', '', 'Self', null, photo); ok := false;
  exception when others then ok := sqlerrm like 'invalid_profile: add your first name%'; end;
  assert ok, 'FAIL 4b: no name accepted'; n := n + 1;
  begin perform public.update_my_profile(repeat('x', 81), 'Test', null, null, photo); ok := false;
  exception when others then ok := sqlerrm like 'invalid_profile: names%'; end;
  assert ok, 'FAIL 4c: long name accepted'; n := n + 1;
  begin perform public.update_my_profile('Isvari', 'Test', null, null, 'https://evil.example/x.jpg'); ok := false;
  exception when others then ok := sqlerrm like 'invalid_profile: upload the photo%'; end;
  assert ok, 'FAIL 4d: outside photo accepted'; n := n + 1;
  begin perform public.update_my_profile('Isvari', 'Test', null, null,
    'https://abcdefgh.supabase.co/storage/v1/object/public/facilitator-photos/' || other || '/1.jpg'); ok := false;
  exception when others then ok := sqlerrm like 'invalid_profile: upload the photo%'; end;
  assert ok, 'FAIL 4e: another facilitator''s folder accepted'; n := n + 1;
  begin perform public.update_my_profile('Isvari', 'Test', null, null, photo || '/../x.jpg'); ok := false;
  exception when others then ok := sqlerrm like 'invalid_profile: upload the photo%'; end;
  assert ok, 'FAIL 4f: path trick accepted'; n := n + 1;
  -- Removing the photo is allowed.
  r := public.update_my_profile('Isvari', 'Test', null, null, '');
  assert r.photo_url is null, 'FAIL 4g: remove photo'; n := n + 1;

  -- 5. Direct writes stay blocked, and the other facilitator is untouched.
  update public.facilitators set phone = '+1 555 0000' where id in (me, other);
  get diagnostics cnt = row_count;
  assert cnt = 0, 'FAIL 5a: direct update allowed'; n := n + 1;

  -- 6. Strangers are refused.
  perform set_config('request.jwt.claims', json_build_object('email', 'tg-test-nobody-' || sfx || '@example.org', 'role', 'authenticated')::text, true);
  assert public.my_facilitator_id() is null, 'FAIL 6a: stranger has an id'; n := n + 1;
  begin perform public.update_my_profile('A', 'B', null, null, null); ok := false;
  exception when others then ok := sqlerrm like 'not_a_facilitator%'; end;
  assert ok, 'FAIL 6b: stranger saved'; n := n + 1;

  -- 7. As the owner again: audit lines, and the other row unchanged.
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  assert (select phone from public.facilitators where id = other) = '+44 7700 900002', 'FAIL 7a: other row changed'; n := n + 1;
  select count(*) into cnt from public.audit_log where action = 'facilitator_self_edit' and detail ->> 'facilitator_id' = me::text;
  assert cnt = 3, 'FAIL 7b: expected 3 audit lines, got ' || cnt; n := n + 1;
  assert exists (select 1 from public.audit_log where action = 'facilitator_self_edit' and actor = em
                  and detail -> 'changes' ? 'phone' and detail -> 'changes' ? 'photo_url'), 'FAIL 7c: audit detail'; n := n + 1;

  -- 8. Grants and the storage policy.
  assert not has_function_privilege('anon', 'public.update_my_profile(text, text, text, text, text)', 'execute'), 'FAIL 8a: anon can call'; n := n + 1;
  assert has_function_privilege('authenticated', 'public.update_my_profile(text, text, text, text, text)', 'execute'), 'FAIL 8b: authenticated cannot call'; n := n + 1;
  assert exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'facilitator photos own insert'
                  and with_check like '%my_facilitator_id%'), 'FAIL 8c: storage policy'; n := n + 1;

  raise exception 'TESTS PASSED: 08_facilitator_self_edit % checks', n;
end $$;
