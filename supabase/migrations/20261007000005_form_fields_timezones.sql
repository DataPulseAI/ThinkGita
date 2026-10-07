-- Real Tally form support: name parts, circle type, language, preferred start,
-- second preference, and timezone-aware clash checking.
-- weekday/start_time stay in the facilitator's own timezone (what Zoom uses).
-- ref_weekday/ref_start_time are the same moment in UK time, used for clash checks and admin views.

alter table public.facilitators
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists initiated_name text;

alter table public.circles
  add column if not exists circle_type text,
  add column if not exists language text,
  add column if not exists preferred_start date,
  add column if not exists timezone_label text,
  add column if not exists alt_weekday smallint check (alt_weekday between 1 and 7),
  add column if not exists alt_start_time time,
  add column if not exists preference_used smallint not null default 1 check (preference_used in (1, 2)),
  add column if not exists ref_weekday smallint,
  add column if not exists ref_start_time time;

-- Local day/time in a timezone -> UK day/time, evaluated on the first matching date on/after p_from.
create or replace function public.reference_time(
  p_weekday smallint, p_start time, p_tz text, p_from date,
  out ref_weekday smallint, out ref_start time)
language plpgsql stable set search_path = '' as $$
declare
  d date;
  ts timestamp;
begin
  d := p_from + ((p_weekday - extract(isodow from p_from)::int + 7) % 7);
  ts := ((d + p_start) at time zone coalesce(nullif(p_tz, ''), 'Europe/London')) at time zone 'Europe/London';
  ref_weekday := extract(isodow from ts)::smallint;
  ref_start := ts::time;
end;
$$;
revoke execute on function public.reference_time(smallint, time, text, date) from public, anon;
grant execute on function public.reference_time(smallint, time, text, date) to authenticated, service_role;

create or replace function public.circles_before_write()
returns trigger language plpgsql set search_path = '' as $$
declare
  buf int;
  term_from date;
  r record;
begin
  select buffer_minutes, term_start into buf, term_from from public.settings where id = 1;
  select * into r from public.reference_time(
    new.weekday, new.start_time, new.timezone,
    coalesce(new.preferred_start, term_from, current_date));
  new.ref_weekday := r.ref_weekday;
  new.ref_start_time := r.ref_start;
  new.slot := public.week_slot(new.ref_weekday, new.ref_start_time, new.duration_min, buf);
  new.updated_at := now();
  return new;
end;
$$;

create or replace trigger circles_before_write
before insert or update of weekday, start_time, duration_min, timezone, preferred_start, status, licence_id
on public.circles
for each row execute function public.circles_before_write();

-- First free active licence for a slot (internal helper).
create or replace function public.free_licence(p_circle uuid, p_slot int4range)
returns uuid language sql stable security definer set search_path = '' as $$
  select l.id from public.licences l
   where l.active and not exists (
     select 1 from public.circles o
      where o.licence_id = l.id and o.id <> p_circle
        and o.status in ('pending', 'approved', 'live') and o.slot && p_slot)
   order by l.sort_order, l.label
   limit 1;
$$;
revoke execute on function public.free_licence(uuid, int4range) from public, anon, authenticated;

-- Allocator: first preference, then second preference, else conflict.
create or replace function public.allocate_circle(p_circle uuid)
returns public.circles language plpgsql security definer set search_path = '' as $$
declare
  c public.circles;
  lic uuid;
  has_alt boolean;
begin
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'not authorised';
  end if;

  perform pg_advisory_xact_lock(7001);
  select * into c from public.circles where id = p_circle for update;
  if not found then raise exception 'circle not found'; end if;
  if c.status in ('live', 'ended', 'rejected', 'paused') then return c; end if;

  lic := public.free_licence(c.id, c.slot);
  has_alt := c.alt_weekday is not null and c.alt_start_time is not null;

  if lic is null and has_alt then
    -- Swap to the other preference and try again.
    update public.circles
       set weekday = c.alt_weekday, start_time = c.alt_start_time,
           alt_weekday = c.weekday, alt_start_time = c.start_time,
           preference_used = case when c.preference_used = 1 then 2 else 1 end
     where id = c.id
    returning * into c;
    lic := public.free_licence(c.id, c.slot);
    if lic is null then
      -- Neither fits: put the original preference back.
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
       set licence_id = lic,
           status = case when c.status = 'conflict' then 'pending'::public.circle_status else c.status end,
           conflict_reason = null
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

-- Suggestions: nearby local start times on the same local day that have a free licence.
create or replace function public.suggest_slots(p_circle uuid, p_window_min int default 180, p_step int default 15)
returns table (weekday smallint, start_time time, licence_label text)
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.circles;
  buf int;
  term_from date;
  off int;
  m int;
  r record;
  s int4range;
  lic uuid;
  n int := 0;
begin
  if not public.is_admin() then raise exception 'not authorised'; end if;
  select * into c from public.circles where id = p_circle;
  select buffer_minutes, term_start into buf, term_from from public.settings where id = 1;

  for off in select g from generate_series(-p_window_min, p_window_min, p_step) g order by abs(g), g loop
    m := extract(hour from c.start_time)::int * 60 + extract(minute from c.start_time)::int + off;
    continue when m < 0 or m + c.duration_min > 1440;
    select * into r from public.reference_time(c.weekday, make_time(m / 60, m % 60, 0), c.timezone,
      coalesce(c.preferred_start, term_from, current_date));
    s := public.week_slot(r.ref_weekday, r.ref_start, c.duration_min, buf);
    lic := public.free_licence(c.id, s);
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

-- Backfill reference times for existing rows.
update public.circles set duration_min = duration_min where id is not null;
