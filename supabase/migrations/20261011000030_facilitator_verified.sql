-- 11 Oct 2026: verified facilitators.
-- A facilitator is verified once an admin has vouched for them: either by approving a circle they run (the circle
-- goes live with them as host or co-facilitator), or directly from their profile (set_facilitator_verified).
-- Unverified people can't be put on the website before their circle is approved.
alter table public.facilitators add column if not exists verified_at timestamptz;
alter table public.facilitators add column if not exists verified_by text;

-- Everyone already running a circle, or already shown on the website, is verified now.
update public.facilitators f set verified_at = now(), verified_by = 'existing circle'
 where verified_at is null and exists (
   select 1 from public.circles c
    where (c.facilitator_id = f.id or c.id in (select circle_id from public.circle_cofacilitators where facilitator_id = f.id))
      and ((c.status in ('live', 'paused', 'ended') and c.zoom_meeting_id is not null) or c.website_visible));

-- Approving (or handing over, or adding a co-facilitator to) a running circle verifies its people.
create or replace function public.verify_circle_team(p_circle uuid, p_by text)
returns void language sql security definer set search_path = '' as $$
  update public.facilitators set verified_at = now(), verified_by = p_by
   where verified_at is null
     and id in (select facilitator_id from public.circles where id = p_circle
                union select facilitator_id from public.circle_cofacilitators where circle_id = p_circle);
$$;
revoke execute on function public.verify_circle_team(uuid, text) from public, anon, authenticated;

create or replace function public.circles_verify_team()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.verify_circle_team(new.id, case when tg_op = 'UPDATE' and old.status is distinct from new.status then 'approval' else 'circle change' end);
  return null;
end $$;
revoke execute on function public.circles_verify_team() from public, anon, authenticated;
create trigger circles_verify_team after insert or update of status, facilitator_id on public.circles
  for each row when (new.status in ('live', 'paused')) execute function public.circles_verify_team();

create or replace function public.cofac_verify()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.circles where id = new.circle_id and status in ('live', 'paused')) then
    update public.facilitators set verified_at = now(), verified_by = 'added to a running circle'
     where id = new.facilitator_id and verified_at is null;
  end if;
  return null;
end $$;
revoke execute on function public.cofac_verify() from public, anon, authenticated;
create trigger cofac_verify after insert on public.circle_cofacilitators
  for each row execute function public.cofac_verify();

-- An admin verifies (or un-verifies) someone directly, from their profile. Logged in Settings > Activity.
create or replace function public.set_facilitator_verified(p_facilitator uuid, p_verified boolean)
returns public.facilitators language plpgsql security definer set search_path = '' as $$
declare
  who text := lower(coalesce(auth.jwt() ->> 'email', ''));
  r public.facilitators;
begin
  if not public.is_admin() then raise exception 'not_admin: only admins can verify facilitators'; end if;
  update public.facilitators
     set verified_at = case when p_verified then coalesce(verified_at, now()) end,
         verified_by = case when p_verified then coalesce(case when verified_at is not null then verified_by end, who) end
   where id = p_facilitator
  returning * into r;
  if r.id is null then raise exception 'not_found: no such facilitator'; end if;
  insert into public.audit_log (actor, action, circle_id, detail)
  values (who, case when p_verified then 'facilitator_verified' else 'facilitator_unverified' end, null,
          jsonb_build_object('facilitator_id', r.id, 'name', r.name, 'email', r.email));
  return r;
end $$;
revoke execute on function public.set_facilitator_verified(uuid, boolean) from public, anon;
grant execute on function public.set_facilitator_verified(uuid, boolean) to authenticated;

-- Website: a circle that isn't running yet can only be switched on when its host is verified.
create or replace function public.circles_website_needs_verified()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.website_visible and not coalesce(old.website_visible, false) and new.status not in ('live', 'paused')
     and not exists (select 1 from public.facilitators where id = new.facilitator_id and verified_at is not null) then
    raise exception 'host_unverified: verify the host before showing this circle on the website';
  end if;
  return new;
end $$;
revoke execute on function public.circles_website_needs_verified() from public, anon, authenticated;
create trigger circles_website_needs_verified before insert or update of website_visible on public.circles
  for each row execute function public.circles_website_needs_verified();
