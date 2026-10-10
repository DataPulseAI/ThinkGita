-- 10 Oct 2026: fields a good website listing needs, so synced Course items match the hand-made ones.
-- Every approved hand-made listing has a facilitator photo (AuthorImg), a LessonNumber (its place on the page),
-- a short display name, a WhatsApp group link and a start date. These columns let the dashboard hold them.
-- framer-sync keeps a circle's item as a draft until websiteMissing() in framer-sync/index.ts is empty
-- (the same rule is shown in the dashboard by app/src/WebsiteFields.jsx).
-- Safe to run more than once.

-- Facilitator photo, reused by every circle they lead. A public image URL: Framer imports images from URLs.
alter table public.facilitators add column if not exists photo_url text;
comment on column public.facilitators.photo_url is
  'Public image URL of the facilitator photo shown on website listings (Framer AuthorImg). Upload to the facilitator-photos bucket or paste a URL.';

alter table public.circles
  add column if not exists website_name text,
  add column if not exists website_photo_url text,
  add column if not exists website_order int,
  add column if not exists framer_photo_src text;
comment on column public.circles.website_name is
  'Short name shown on the website card (Framer AuthorName), e.g. "Isvara, Isvari & Gopali". Empty = derived from the facilitator names. The signup link keeps the fuller name.';
comment on column public.circles.website_photo_url is
  'Photo for this circle''s website card when it should differ from the lead facilitator''s photo (e.g. a group photo for co-facilitated circles).';
comment on column public.circles.website_order is
  'Position on the website (Framer LessonNumber, written as text). Required before the circle can be shown.';
comment on column public.circles.framer_photo_src is
  'Set by framer-sync: the photo URL last sent to Framer, so a photo is only re-sent when it changes.';

do $$ begin
  alter table public.circles add constraint circles_website_order_positive check (website_order is null or website_order > 0);
exception when duplicate_object then null; end $$;

-- What the circle's Framer item already holds (photo, order, name, WhatsApp link, link), written by framer-sync, so
-- hand-made items count as ready without copying those fields into the dashboard.
alter table public.circles add column if not exists framer_has jsonb not null default '{}'::jsonb;
-- Edit counter: bumped by every change that needs a re-sync. framer-sync clears framer_dirty only when the counter is
-- unchanged since it loaded the circle, so an edit made while a sync runs is not lost.
alter table public.circles add column if not exists framer_rev bigint not null default 0;

-- Re-sync when anything shown on the website changes (same as migration 021, plus the new fields, preferred_start
-- (the advertised start of circles awaiting approval), licence and demo changes (test circles are never listed)).
-- framer-sync's own writes always change framer_synced_at, which is how they are told apart from real edits.
create or replace function public.circles_mark_framer_dirty()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.framer_dirty := true; return new; end if;
  if (new.name, new.weekday, new.start_time, new.timezone, new.status, new.website_visible, new.starts_on, new.ends_on,
      new.language, new.circle_type, new.whatsapp_group_link, new.facilitator_id,
      new.preferred_start, new.website_name, new.website_photo_url, new.website_order, new.licence_id, new.is_demo)
     is distinct from
     (old.name, old.weekday, old.start_time, old.timezone, old.status, old.website_visible, old.starts_on, old.ends_on,
      old.language, old.circle_type, old.whatsapp_group_link, old.facilitator_id,
      old.preferred_start, old.website_name, old.website_photo_url, old.website_order, old.licence_id, old.is_demo) then
    new.framer_dirty := true;
  end if;
  if new.framer_dirty and new.framer_synced_at is not distinct from old.framer_synced_at then
    new.framer_rev := old.framer_rev + 1;
  end if;
  return new;
end $$;

create or replace function public.facilitator_mark_framer_dirty()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.name is distinct from old.name or new.initiated_name is distinct from old.initiated_name
     or new.photo_url is distinct from old.photo_url then
    update public.circles set framer_dirty = true
     where facilitator_id = new.id
        or id in (select circle_id from public.circle_cofacilitators where facilitator_id = new.id);
  end if;
  return null;
end $$;

revoke execute on function public.circles_mark_framer_dirty(), public.facilitator_mark_framer_dirty()
  from public, anon, authenticated;

-- Daily: some website text depends on the date, not on a column change.
--  * Lesson flips from "Starts 18 Oct" to the running text once the start date has passed.
--  * Time shows CET or CEST (and similar) for the next session, so it changes around clock changes.
-- Marks those circles dirty; framer-sync then skips items whose text did not actually change.
create or replace function public.framer_daily_refresh()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.circles c set framer_dirty = true
   where c.framer_item_id is not null and not c.framer_dirty
     and c.status not in ('ended', 'rejected')
     and (
       coalesce(c.starts_on, c.preferred_start) between current_date - 2 and current_date
       or (c.timezone in (select name from pg_catalog.pg_timezone_names)
           and (now() at time zone c.timezone) - (now() at time zone 'UTC')
               is distinct from ((now() + interval '8 days') at time zone c.timezone) - ((now() + interval '8 days') at time zone 'UTC'))
     );
end $$;
revoke execute on function public.framer_daily_refresh() from public, anon, authenticated;

select cron.schedule('framer-daily-refresh', '7 0 * * *', 'select public.framer_daily_refresh()');

-- Facilitator photos: a public bucket admins upload to from the dashboard. Anyone can view (the website needs to);
-- only admins can add, replace or delete.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('facilitator-photos', 'facilitator-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "facilitator photos admin insert" on storage.objects;
drop policy if exists "facilitator photos admin update" on storage.objects;
drop policy if exists "facilitator photos admin delete" on storage.objects;
drop policy if exists "facilitator photos admin read" on storage.objects;
create policy "facilitator photos admin read" on storage.objects for select to authenticated
  using (bucket_id = 'facilitator-photos' and (select public.is_admin()));
create policy "facilitator photos admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'facilitator-photos' and (select public.is_admin()));
create policy "facilitator photos admin update" on storage.objects for update to authenticated
  using (bucket_id = 'facilitator-photos' and (select public.is_admin()))
  with check (bucket_id = 'facilitator-photos' and (select public.is_admin()));
create policy "facilitator photos admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'facilitator-photos' and (select public.is_admin()));

-- Whole-sync failures (bad key, Framer down): shown in Settings, and the cron tick backs off 2, 4, 8 ... 30 minutes.
alter table public.settings
  add column if not exists framer_last_error text,
  add column if not exists framer_fail_count int not null default 0,
  add column if not exists framer_failed_at timestamptz;

create or replace function public.framer_sync_tick()
returns void language plpgsql security definer set search_path = '' as $$
declare
  st public.settings;
  due boolean;
begin
  select * into st from public.settings where id = 1;
  if st.framer_sync_lock is not null and st.framer_sync_lock > now() - interval '3 minutes' then return; end if;
  if st.framer_fail_count > 0
     and st.framer_failed_at > now() - make_interval(mins => least(30, power(2, least(st.framer_fail_count, 5))::int)) then
    return;
  end if;
  -- Dirty circles: always; ones whose last push failed (not just held back for missing fields): once an hour.
  due := exists (select 1 from public.circles
                  where framer_dirty and (framer_error is null or framer_error like 'Not shown on the website until set:%'
                                          or extract(minute from now()) < 2))
      or (st.framer_publish_pending and st.framer_auto_publish
          and coalesce(st.framer_publish_tried_at, '-infinity') < now() - make_interval(mins => least(30, power(2, least(st.framer_publish_attempts, 5))::int)));
  if not due then return; end if;
  perform net.http_post(
    url := 'https://rxvehsmunykipwevtpmb.supabase.co/functions/v1/framer-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select secret from private.cron_secret where id = 1)),
    body := '{"action":"sync"}'::jsonb,
    timeout_milliseconds := 140000
  );
end $$;
revoke execute on function public.framer_sync_tick() from public, anon, authenticated;

-- pg_net is only for the cron tick: the API roles must not queue requests or read responses
-- (the request queue briefly holds the cron secret header).
revoke all on all tables in schema net from anon, authenticated;
revoke all on all functions in schema net from anon, authenticated;
revoke usage on schema net from anon, authenticated;
