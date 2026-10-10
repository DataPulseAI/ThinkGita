-- 10 Oct 2026: facilitators edit their own profile from the portal (photo, phone, names).
-- They can read their own row already (policy self_read). Writes go through update_my_profile(), never a direct UPDATE,
-- so a facilitator can only change these five fields on their own row. Email stays admin-only: it is their login.

-- The signed-in person's facilitator row id (null for admins without one, or anyone else).
create or replace function public.my_facilitator_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.facilitators
   where email = lower(coalesce(auth.jwt() ->> 'email', ''))
   limit 1;
$$;
revoke execute on function public.my_facilitator_id() from public, anon;
grant execute on function public.my_facilitator_id() to authenticated;

-- Saves the facilitator's own details. Empty text clears a field. The photo must be their current photo or one they
-- uploaded to their own folder in the facilitator-photos bucket (so nobody can point the website at another image host).
create or replace function public.update_my_profile(
  p_initiated_name text, p_first_name text, p_last_name text, p_phone text, p_photo_url text)
returns public.facilitators language plpgsql security definer set search_path = '' as $$
declare
  me public.facilitators;
  nw public.facilitators;
  pattern text;
  changes jsonb := '{}'::jsonb;
  k text;
begin
  select * into me from public.facilitators where id = public.my_facilitator_id() for update;
  if me.id is null then raise exception 'not_a_facilitator: no facilitator profile for this sign-in'; end if;

  nw := me;
  nw.initiated_name := nullif(btrim(p_initiated_name), '');
  nw.first_name := nullif(btrim(p_first_name), '');
  nw.last_name := nullif(btrim(p_last_name), '');
  nw.phone := nullif(btrim(p_phone), '');
  nw.photo_url := nullif(btrim(p_photo_url), '');

  if greatest(length(nw.initiated_name), length(nw.first_name), length(nw.last_name)) > 80 then
    raise exception 'invalid_profile: names must be 80 characters or fewer';
  end if;
  if nw.initiated_name is null and nw.first_name is null then
    raise exception 'invalid_profile: add your first name or initiated name';
  end if;
  if nw.phone is not null and nw.phone !~ '^\+?[0-9 ()./-]{6,30}$' then
    raise exception 'invalid_profile: phone numbers can use digits, spaces, brackets, dashes and a leading +';
  end if;
  pattern := '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/facilitator-photos/' || me.id::text || '/[A-Za-z0-9_-]+\.(jpg|png|webp)$';
  if nw.photo_url is distinct from me.photo_url and nw.photo_url is not null and nw.photo_url !~ pattern then
    raise exception 'invalid_profile: upload the photo from this page';
  end if;

  foreach k in array array['initiated_name', 'first_name', 'last_name', 'phone', 'photo_url'] loop
    if to_jsonb(me) -> k is distinct from to_jsonb(nw) -> k then
      changes := changes || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(me) -> k, 'to', to_jsonb(nw) -> k));
    end if;
  end loop;
  if changes = '{}'::jsonb then return me; end if;

  update public.facilitators
     set initiated_name = nw.initiated_name, first_name = nw.first_name, last_name = nw.last_name,
         phone = nw.phone, photo_url = nw.photo_url
   where id = me.id
  returning * into nw;

  -- First and last names feed automatic circle names but don't fire the facilitator trigger: refresh those circles.
  if changes ?| array['first_name', 'last_name', 'initiated_name'] then
    update public.circles set name_auto = true where facilitator_id = me.id and name_auto;
    update public.circles set framer_dirty = true
     where id in (select circle_id from public.circle_cofacilitators where facilitator_id = me.id);
  end if;

  insert into public.audit_log (actor, action, circle_id, detail)
  values (me.email, 'facilitator_self_edit', null, jsonb_build_object('facilitator_id', me.id, 'name', me.name, 'changes', changes));
  return nw;
end $$;
revoke execute on function public.update_my_profile(text, text, text, text, text) from public, anon;
grant execute on function public.update_my_profile(text, text, text, text, text) to authenticated;

-- Facilitators may upload photos into their own folder (<facilitator id>/...) of the public facilitator-photos bucket.
create policy "facilitator photos own insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'facilitator-photos' and (storage.foldername(name))[1] = (select public.my_facilitator_id())::text);
