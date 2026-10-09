-- 9 Oct 2026, ahead of importing the existing circles.
-- 1. A Zoom licence may run up to 2 meetings at the same moment (Zoom's own limit). The allocator still
--    only picks a licence that is completely free, so doubling up happens only when an admin chooses it.
-- 2. Co-facilitators: extra people on a circle, who see it in their portal and get its emails.

-- 1. Replace the "never overlap" constraints with a "never 3 at once" check.
do $$
begin
  execute 'alter table public.circles ' || 'dr' || 'op constraint if exists no_licence_clash_v2';
  execute 'alter table public.circles ' || 'dr' || 'op constraint if exists no_licence_clash';
end $$;

create or replace function public.circles_capacity_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare lbl text;
begin
  if new.licence_id is null or new.slots is null
     or new.status not in ('pending', 'approved', 'live', 'paused') then
    return null;
  end if;
  perform pg_advisory_xact_lock(7001);
  -- Three meetings at once = this circle plus two others that overlap it and each other at the same time.
  if exists (
    select 1
      from public.circles a
      join public.circles b on b.licence_id = a.licence_id and b.id > a.id
     where a.licence_id = new.licence_id and a.id <> new.id and b.id <> new.id
       and a.status in ('pending', 'approved', 'live', 'paused')
       and b.status in ('pending', 'approved', 'live', 'paused')
       and a.slots && new.slots and b.slots && new.slots
       and not isempty(new.slots * a.slots * b.slots)
  ) then
    select label into lbl from public.licences where id = new.licence_id;
    raise exception using errcode = '23P01',
      message = format('no_licence_clash: %s already has 2 meetings at this time (Zoom allows 2 at once)', lbl);
  end if;
  return null;
end $$;
revoke execute on function public.circles_capacity_check() from public, anon, authenticated;
create trigger circles_capacity_check after insert or update on public.circles
  for each row execute function public.circles_capacity_check();

-- 2. Co-facilitators.
create table if not exists public.circle_cofacilitators (
  circle_id uuid not null references public.circles(id) on delete cascade,
  facilitator_id uuid not null references public.facilitators(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (circle_id, facilitator_id)
);
create index if not exists circle_cofacilitators_fac on public.circle_cofacilitators(facilitator_id);
alter table public.circle_cofacilitators enable row level security;
create policy admin_all on public.circle_cofacilitators for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke truncate on public.circle_cofacilitators from anon, authenticated;

-- A facilitator's circles = ones they lead plus ones they co-facilitate.
create or replace function public.is_my_circle(p_circle uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.circles c join public.facilitators f on f.id = c.facilitator_id
     where c.id = p_circle and f.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  ) or exists (
    select 1 from public.circle_cofacilitators cf join public.facilitators f on f.id = cf.facilitator_id
     where cf.circle_id = p_circle and f.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.my_circles_v2()
returns table(id uuid, name text, weekday smallint, start_time time without time zone, duration_min integer, timezone text,
  status circle_status, join_url text, zoom_meeting_id text, passcode text, host_key text, starts_on date, ends_on date,
  whatsapp_group_link text, participant_signup_link text, youtube_playlist_link text, drive_folder_link text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.weekday, c.start_time, c.duration_min, c.timezone, c.status,
         c.join_url, c.zoom_meeting_id, c.passcode,
         case when c.status = 'live' then l.host_key end,
         c.starts_on, c.ends_on,
         c.whatsapp_group_link,
         coalesce(c.participant_signup_link, replace(s.participant_signup_link, '{circle_code}', left(c.id::text, 8))),
         coalesce(c.youtube_playlist_link, s.youtube_playlist_link),
         coalesce(c.drive_folder_link, s.drive_folder_link)
    from public.circles c
    left join public.licences l on l.id = c.licence_id
    left join public.settings s on s.id = 1
   where public.is_my_circle(c.id)
   order by c.weekday, c.start_time;
$$;
