-- 9 Oct 2026: sync circles to the website (Framer CMS "Course" collection) via the framer-sync edge function.
alter table public.circles
  add column if not exists framer_item_id text,
  add column if not exists framer_synced_at timestamptz,
  add column if not exists framer_error text,
  add column if not exists framer_dirty boolean not null default true;
comment on column public.circles.framer_item_id is 'Framer CMS item id in the Course collection (set by framer-sync).';
comment on column public.circles.framer_dirty is 'True when the website copy needs updating; framer-sync clears it.';

alter table public.settings
  add column if not exists framer_auto_publish boolean not null default true,
  add column if not exists framer_sync_lock timestamptz;
comment on column public.settings.framer_auto_publish is 'Publish the Framer site after each sync. Publishing also ships any unpublished design edits in Framer.';

-- Mark a circle for re-sync when anything shown on the website changes.
create or replace function public.circles_mark_framer_dirty()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.framer_dirty := true; return new; end if;
  if (new.name, new.weekday, new.start_time, new.timezone, new.status, new.website_visible, new.starts_on, new.ends_on,
      new.language, new.circle_type, new.whatsapp_group_link, new.facilitator_id)
     is distinct from
     (old.name, old.weekday, old.start_time, old.timezone, old.status, old.website_visible, old.starts_on, old.ends_on,
      old.language, old.circle_type, old.whatsapp_group_link, old.facilitator_id) then
    new.framer_dirty := true;
  end if;
  return new;
end $$;
create trigger circles_mark_framer_dirty before insert or update on public.circles
  for each row execute function public.circles_mark_framer_dirty();

-- Co-facilitator or facilitator name changes also change the website text.
create or replace function public.cofac_mark_framer_dirty()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.circles set framer_dirty = true where id = coalesce(new.circle_id, old.circle_id);
  return null;
end $$;
create trigger cofac_mark_framer_dirty after insert or update or delete on public.circle_cofacilitators
  for each row execute function public.cofac_mark_framer_dirty();

create or replace function public.facilitator_mark_framer_dirty()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.name is distinct from old.name or new.initiated_name is distinct from old.initiated_name then
    update public.circles set framer_dirty = true
     where facilitator_id = new.id
        or id in (select circle_id from public.circle_cofacilitators where facilitator_id = new.id);
  end if;
  return null;
end $$;
create trigger facilitator_mark_framer_dirty after update on public.facilitators
  for each row execute function public.facilitator_mark_framer_dirty();

revoke execute on function public.circles_mark_framer_dirty(), public.cofac_mark_framer_dirty(), public.facilitator_mark_framer_dirty()
  from public, anon, authenticated;

-- Items the sync created itself (true) vs existing items it took over (false): taken-over items keep their hand-made
-- title, name and link; only draft, Time and Lesson are updated.
alter table public.circles add column if not exists framer_created boolean not null default false;
