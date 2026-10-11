-- 11 Oct 2026: a co-host's photo from the Tally form. tally-intake copies it into the facilitator-photos bucket and
-- keeps its link in pending_cohost.photo_url; when the circle goes live the co-host's facilitator row gets it
-- (a new row, or an existing one that has no photo yet; a photo already on file is never replaced).
create or replace function public.circles_attach_cohost()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  p jsonb := new.pending_cohost;
  em text := lower(btrim(coalesce(p ->> 'email', '')));
  fn text := nullif(btrim(p ->> 'first_name'), '');
  ln text := nullif(btrim(p ->> 'last_name'), '');
  ini text := nullif(btrim(p ->> 'initiated_name'), '');
  ph text := nullif(btrim(p ->> 'phone'), '');
  pu text := nullif(btrim(p ->> 'photo_url'), '');
  full_name text;
  lead_email text;
  fac public.facilitators;
  result text;
begin
  begin
    select email into lead_email from public.facilitators where id = new.facilitator_id;
    if em !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
      result := 'skipped: no valid email';
    elsif em = lead_email then
      result := 'skipped: same as the main facilitator';
    else
      select * into fac from public.facilitators where email = em;
      if fac.id is null then
        full_name := nullif(concat_ws(' ', fn, ln), '');
        insert into public.facilitators (name, email, phone, first_name, last_name, initiated_name, photo_url)
        values (case when ini is not null then ini || ' (' || coalesce(full_name, em) || ')' else coalesce(full_name, em) end,
                em, ph, fn, ln, ini, pu)
        returning * into fac;
        result := 'added (new facilitator)';
      else
        update public.facilitators
           set phone = coalesce(phone, ph), first_name = coalesce(first_name, fn),
               last_name = coalesce(last_name, ln), initiated_name = coalesce(initiated_name, ini),
               photo_url = coalesce(photo_url, pu)
         where id = fac.id;
        result := 'added (existing facilitator)';
      end if;
      insert into public.circle_cofacilitators (circle_id, facilitator_id) values (new.id, fac.id)
      on conflict do nothing;
    end if;
    update public.circles set pending_cohost = null where id = new.id;
    insert into public.audit_log (actor, action, circle_id, detail)
    values ('system', 'cohost_added', new.id, jsonb_build_object('name', new.name, 'email', em, 'facilitator_id', fac.id, 'result', result));
  exception when others then
    -- Never block an approval: keep pending_cohost so an admin can add them by hand.
    insert into public.audit_log (actor, action, circle_id, detail)
    values ('system', 'cohost_failed', new.id, jsonb_build_object('name', new.name, 'email', em, 'error', sqlerrm));
  end;
  return null;
end $$;
revoke execute on function public.circles_attach_cohost() from public, anon, authenticated;
