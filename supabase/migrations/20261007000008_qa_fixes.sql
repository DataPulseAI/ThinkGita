-- QA fixes (report 7 Oct 2026)
-- H1 week wrap, H2 clock changes: a circle now occupies a SET of UK minute-of-week ranges (int4multirange),
--    one per distinct UK time across its run, split at the Sunday/Monday boundary.
-- M2 paused circles keep their licence. M5 live circles can't lose their licence. M6 deactivating a
--    licence moves its pending circles. M12 pending circles without a licence become clashes.
-- Auto re-check of clashes when capacity frees up. "Who's in this slot". Atomic settings save.
-- Daily close-out of finished circles. L1 request status. L3 term date order.

alter table public.circles
  add column if not exists slots int4multirange,
  add column if not exists uk_time_shifts boolean not null default false;
comment on column public.circles.slot is 'Legacy, no longer used. Superseded by slots.';

-- Every distinct UK weekly position of a circle between p_from and p_to, plus buffer.
create or replace function public.circle_slots(
  p_weekday smallint, p_start time, p_duration int, p_tz text, p_from date, p_to date, p_buffer int,
  out slots int4multirange, out ref_weekday smallint, out ref_start time, out shifts boolean)
language plpgsql stable set search_path = '' as $$
declare
  d date;
  ts timestamp;
  lo int;
  hi int;
  rs int4range[] := '{}';
  seen text[] := '{}';
  k text;
  n int := 0;
begin
  d := p_from + ((p_weekday - extract(isodow from p_from)::int + 7) % 7);
  loop
    ts := ((d + p_start) at time zone coalesce(nullif(p_tz, ''), 'Europe/London')) at time zone 'Europe/London';
    if n = 0 then
      ref_weekday := extract(isodow from ts)::smallint;
      ref_start := ts::time;
    end if;
    k := extract(isodow from ts)::text || ' ' || ts::time::text;
    if not (k = any(seen)) then
      seen := seen || k;
      lo := (extract(isodow from ts)::int - 1) * 1440 + extract(hour from ts)::int * 60 + extract(minute from ts)::int;
      hi := lo + p_duration + p_buffer;
      if hi > 10080 then
        rs := rs || int4range(lo, 10080) || int4range(0, hi - 10080);
      else
        rs := rs || int4range(lo, hi);
      end if;
    end if;
    d := d + 7;
    n := n + 1;
    exit when d > p_to or n >= 60;
  end loop;
  shifts := coalesce(array_length(seen, 1), 0) > 1;
  select range_agg(r) into slots from unnest(rs) r;
end;
$$;
revoke execute on function public.circle_slots(smallint, time, int, text, date, date, int) from public, anon;
grant execute on function public.circle_slots(smallint, time, int, text, date, date, int) to authenticated, service_role;

create or replace function public.circles_before_write()
returns trigger language plpgsql set search_path = '' as $$
declare
  buf int;
  t_start date;
  t_end date;
  f date;
  t date;
  r record;
begin
  select buffer_minutes, term_start, term_end into buf, t_start, t_end from public.settings where id = 1;
  f := coalesce(new.starts_on, new.preferred_start, t_start, new.created_at::date, current_date);
  t := greatest(f, coalesce(new.ends_on, t_end, f + 364));
  select * into r from public.circle_slots(new.weekday, new.start_time, new.duration_min, new.timezone, f, t, buf);
  new.slots := r.slots;
  new.ref_weekday := r.ref_weekday;
  new.ref_start_time := r.ref_start;
  new.uk_time_shifts := r.shifts;
  new.slot := null;

  -- Live circles keep their licence: the Zoom meeting belongs to that licence's Zoom user.
  -- Only the server (service role, used by "Move to another licence") may change it.
  if tg_op = 'UPDATE' and old.status in ('live', 'paused') and new.status in ('live', 'paused')
     and new.licence_id is distinct from old.licence_id
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'A live circle can''t change licence directly. Use "Move to another licence".';
  end if;

  -- A circle waiting for approval must hold a licence; otherwise it's a clash to resolve.
  if new.status in ('pending', 'approved') and new.licence_id is null then
    new.status := 'conflict';
    new.conflict_reason := coalesce(new.conflict_reason, 'No licence assigned yet');
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace trigger circles_before_write
before insert or update on public.circles
for each row execute function public.circles_before_write();

-- Recompute every circle with the new logic, then enforce the new constraint.
update public.circles set duration_min = duration_min where id is not null;

alter table public.circles add constraint no_licence_clash_v2
  exclude using gist (licence_id with =, slots with &&)
  where (licence_id is not null and status in ('pending', 'approved', 'live', 'paused'));

-- First free active licence for a set of slots (internal).
create or replace function public.free_licence_for(p_circle uuid, p_slots int4multirange)
returns uuid language sql stable security definer set search_path = '' as $$
  select l.id from public.licences l
   where l.active and not exists (
     select 1 from public.circles o
      where o.licence_id = l.id and o.id <> p_circle
        and o.status in ('pending', 'approved', 'live', 'paused') and o.slots && p_slots)
   order by l.sort_order, l.label
   limit 1;
$$;
revoke execute on function public.free_licence_for(uuid, int4multirange) from public, anon, authenticated;

-- Allocator without the auth check (internal). First preference, then second, else clash.
create or replace function public._allocate(p_circle uuid)
returns public.circles language plpgsql security definer set search_path = '' as $$
declare
  c public.circles;
  lic uuid;
  has_alt boolean;
begin
  perform pg_advisory_xact_lock(7001);
  select * into c from public.circles where id = p_circle for update;
  if not found then raise exception 'circle not found'; end if;
  if c.status in ('live', 'ended', 'rejected', 'paused') then return c; end if;

  lic := public.free_licence_for(c.id, c.slots);
  has_alt := c.alt_weekday is not null and c.alt_start_time is not null;

  if lic is null and has_alt then
    update public.circles
       set weekday = c.alt_weekday, start_time = c.alt_start_time,
           alt_weekday = c.weekday, alt_start_time = c.start_time,
           preference_used = case when c.preference_used = 1 then 2 else 1 end
     where id = c.id
    returning * into c;
    lic := public.free_licence_for(c.id, c.slots);
    if lic is null then
      update public.circles
         set weekday = c.alt_weekday, start_time = c.alt_start_time,
             alt_weekday = c.weekday, alt_start_time = c.start_time,
             preference_used = case when c.preference_used = 1 then 2 else 1 end
       where id = c.id
      returning * into c;
    end if;
  end if;

  if lic is not null then
    update public.circles
       set licence_id = lic, status = 'pending', conflict_reason = null
     where id = c.id
    returning * into c;
    return c;
  end if;

  update public.circles
     set licence_id = null, status = 'conflict',
         conflict_reason = case when has_alt
           then 'Neither preferred time has a free licence'
           else 'Every active licence is already booked at this time' end
   where id = c.id
  returning * into c;
  return c;
end;
$$;
revoke execute on function public._allocate(uuid) from public, anon, authenticated;

create or replace function public.allocate_circle(p_circle uuid)
returns public.circles language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'not authorised';
  end if;
  return public._allocate(p_circle);
end;
$$;

-- Re-check every clash, oldest first (internal + admin wrapper). Returns how many got a licence.
create or replace function public._reallocate_conflicts()
returns int language plpgsql security definer set search_path = '' as $$
declare
  r record;
  out_c public.circles;
  n int := 0;
begin
  for r in select id from public.circles where status = 'conflict' order by created_at loop
    out_c := public._allocate(r.id);
    if out_c.status = 'pending' then n := n + 1; end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public._reallocate_conflicts() from public, anon, authenticated;

create or replace function public.recheck_conflicts()
returns int language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not authorised'; end if;
  return public._reallocate_conflicts();
end;
$$;
revoke execute on function public.recheck_conflicts() from public, anon;
grant execute on function public.recheck_conflicts() to authenticated;

-- When a circle frees capacity (ended, rejected, deleted, moved, released), re-check clashes automatically.
create or replace function public.circles_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.licence_id is null then return null; end if;
  if tg_op = 'DELETE'
     or new.licence_id is distinct from old.licence_id
     or new.status in ('ended', 'rejected')
     or new.slots is distinct from old.slots then
    perform public._reallocate_conflicts();
  end if;
  return null;
end;
$$;
create or replace trigger circles_after_write
after update or delete on public.circles
for each row execute function public.circles_after_write();

-- Licence protection: can't delete a licence with booked circles; can't deactivate one with live circles.
-- Deactivating moves its pending circles elsewhere; adding/activating a licence re-checks clashes.
create or replace function public.licences_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.circles where licence_id = old.id and status in ('pending', 'approved', 'live', 'paused')) then
      raise exception 'This licence still has circles booked on it. Move or end them first.';
    end if;
    return old;
  end if;
  if old.active and not new.active
     and exists (select 1 from public.circles where licence_id = old.id and status in ('live', 'paused')) then
    raise exception 'This licence has live circles. Move them to another licence before deactivating it.';
  end if;
  return new;
end;
$$;
create or replace trigger licences_before_write
before update or delete on public.licences
for each row execute function public.licences_before_write();

create or replace function public.licences_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.active and not new.active then
    update public.circles set licence_id = null
     where licence_id = new.id and status in ('pending', 'approved');
  end if;
  if new.active then
    perform public._reallocate_conflicts();
  end if;
  return null;
end;
$$;
create or replace trigger licences_after_write
after insert or update of active on public.licences
for each row execute function public.licences_after_write();

-- Who already holds this circle's time on each licence (admin).
create or replace function public.slot_holders(p_circle uuid)
returns table (licence_label text, circle_id uuid, circle_name text, status public.circle_status,
               weekday smallint, start_time time, duration_min int, timezone text, facilitator text)
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.circles;
begin
  if not public.is_admin() then raise exception 'not authorised'; end if;
  select * into c from public.circles where id = p_circle;
  return query
    select l.label, o.id, o.name, o.status, o.ref_weekday, o.ref_start_time, o.duration_min, o.timezone, f.name
      from public.circles o
      join public.licences l on l.id = o.licence_id
      left join public.facilitators f on f.id = o.facilitator_id
     where o.id <> c.id and l.active
       and o.status in ('pending', 'approved', 'live', 'paused')
       and o.slots && c.slots
     order by l.sort_order, l.label;
end;
$$;
revoke execute on function public.slot_holders(uuid) from public, anon;
grant execute on function public.slot_holders(uuid) to authenticated;

-- Suggestions use the same slot logic.
create or replace function public.suggest_slots(p_circle uuid, p_window_min int default 180, p_step int default 15)
returns table (weekday smallint, start_time time, licence_label text)
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.circles;
  buf int;
  t_start date;
  t_end date;
  f date;
  t date;
  off int;
  m int;
  r record;
  lic uuid;
  n int := 0;
begin
  if not public.is_admin() then raise exception 'not authorised'; end if;
  select * into c from public.circles where id = p_circle;
  select buffer_minutes, term_start, term_end into buf, t_start, t_end from public.settings where id = 1;
  f := coalesce(c.starts_on, c.preferred_start, t_start, c.created_at::date, current_date);
  t := greatest(f, coalesce(c.ends_on, t_end, f + 364));

  for off in select g from generate_series(-p_window_min, p_window_min, p_step) g order by abs(g), g loop
    m := extract(hour from c.start_time)::int * 60 + extract(minute from c.start_time)::int + off;
    continue when m < 0 or m + c.duration_min > 1440;
    select * into r from public.circle_slots(c.weekday, make_time(m / 60, m % 60, 0), c.duration_min, c.timezone, f, t, buf);
    lic := public.free_licence_for(c.id, r.slots);
    if lic is not null then
      weekday := c.weekday;
      start_time := make_time(m / 60, m % 60, 0);
      select label into licence_label from public.licences where id = lic;
      return next;
      n := n + 1;
      exit when n >= 5;
    end if;
  end loop;
end;
$$;

-- Save settings and recompute every circle in one transaction (fails as a whole on a clash).
create or replace function public.save_settings(
  p_buffer int, p_duration int, p_timezone text, p_term_start date, p_term_end date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not authorised'; end if;
  update public.settings
     set buffer_minutes = p_buffer, default_duration_min = p_duration, default_timezone = p_timezone,
         term_start = p_term_start, term_end = p_term_end, updated_at = now()
   where id = 1;
  update public.circles set duration_min = duration_min where id is not null;
end;
$$;
revoke execute on function public.save_settings(int, int, text, date, date) from public, anon;
grant execute on function public.save_settings(int, int, text, date, date) to authenticated;

alter table public.settings add constraint term_order
  check (term_start is null or term_end is null or term_end >= term_start);

-- Daily: circles whose run has finished become ended and release their licence.
create or replace function public.close_finished()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.circles set status = 'ended', licence_id = null
   where status in ('live', 'paused') and ends_on is not null and ends_on < current_date;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.close_finished() from public, anon, authenticated;

-- Facilitators can only create open requests.
alter policy own_insert on public.change_requests
  with check (
    requested_by = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    and status = 'open'
    and public.is_my_circle(circle_id)
  );

-- Run the close-out daily at 02:15 UTC.
create extension if not exists pg_cron;
select cron.schedule('close-finished-circles', '15 2 * * *', 'select public.close_finished()');

-- Active licences that are free for a circle's whole run (admin), for "Move to another licence".
create or replace function public.free_licences_for_circle(p_circle uuid)
returns table (licence_id uuid, label text, is_mock boolean, has_zoom boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.circles;
begin
  if not public.is_admin() then raise exception 'not authorised'; end if;
  select * into c from public.circles where id = p_circle;
  return query
    select l.id, l.label, l.is_mock, (l.zoom_user_email is not null)
      from public.licences l
     where l.active and l.id is distinct from c.licence_id
       and not exists (
         select 1 from public.circles o
          where o.licence_id = l.id and o.id <> c.id
            and o.status in ('pending', 'approved', 'live', 'paused') and o.slots && c.slots)
     order by l.sort_order, l.label;
end;
$$;
revoke execute on function public.free_licences_for_circle(uuid) from public, anon;
grant execute on function public.free_licences_for_circle(uuid) to authenticated;

-- Trigger functions must not be callable over the API.
revoke execute on function public.circles_after_write(), public.licences_after_write(), public.licences_before_write() from public, anon, authenticated;
