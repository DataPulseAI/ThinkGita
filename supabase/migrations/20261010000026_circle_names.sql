-- 10 Oct 2026: circle names follow the schedule, and new circles always get automatic names.
--
-- 1. Imported names in the pattern "TG <type> | <Day> | <time> <zone> | <host>" (name_auto = false) get their day
--    and time segments rewritten when the weekday, start time or timezone changes, in the style those names use:
--    "TG Circles | Tue | 5pm CT | Host" becomes "TG Circles | Sat | 9am CT | Host". Extra time segments with a known
--    zone ("3pm UK", "7:30pm IST") are converted to the new time as well. Everything else in the name is kept.
--    A name changed in the same update is left as typed, and other custom names are never touched.
-- 2. Automatic names regenerate as before (circle_auto_name, unchanged).
-- 3. On insert, name_auto is forced on, so new circles always get the automatic name. Imports (source 'import')
--    and demo or test rows (is_demo) keep the name they are given.
--
-- Safe on live data: this only replaces functions. No rows are updated here; a name changes on that circle's next
-- day, time or timezone change. The app keeps the matching JavaScript copy in app/src/lib.js (followSchedule,
-- ZONE_LABELS); a unit test checks the zone list below matches it.

-- Zone labels used in circle names. use: 'both' = zone shown with this label and label read back as this zone,
-- 'label' = zone shown with this label only, 'zone' = label read back as this zone only (aliases).
create or replace function public.circle_zone_labels()
returns table (label text, tz text, use text) language sql immutable set search_path = '' as $$
  values
    ('UK', 'Europe/London', 'both'),
    ('CET', 'Europe/Paris', 'both'),
    ('CET', 'Europe/Brussels', 'label'),
    ('CET', 'Europe/Madrid', 'label'),
    ('CET', 'Europe/Berlin', 'label'),
    ('CET', 'Europe/Rome', 'label'),
    ('CET', 'Europe/Amsterdam', 'label'),
    ('CET', 'Europe/Copenhagen', 'label'),
    ('CET', 'Europe/Stockholm', 'label'),
    ('CET', 'Europe/Oslo', 'label'),
    ('CET', 'Europe/Vienna', 'label'),
    ('CET', 'Europe/Zurich', 'label'),
    ('CET', 'Europe/Prague', 'label'),
    ('CET', 'Europe/Warsaw', 'label'),
    ('CET', 'Europe/Budapest', 'label'),
    ('CET', 'Europe/Zagreb', 'label'),
    ('CET', 'Europe/Bratislava', 'label'),
    ('CEST', 'Europe/Paris', 'zone'),
    ('Polska', 'Europe/Warsaw', 'zone'),
    ('Ireland', 'Europe/Dublin', 'both'),
    ('Portugal', 'Europe/Lisbon', 'both'),
    ('EET', 'Europe/Athens', 'both'),
    ('EET', 'Europe/Bucharest', 'label'),
    ('EET', 'Europe/Helsinki', 'label'),
    ('EET', 'Africa/Cairo', 'label'),
    ('MSK', 'Europe/Moscow', 'both'),
    ('SAST', 'Africa/Johannesburg', 'both'),
    ('EAT', 'Africa/Nairobi', 'both'),
    ('WAT', 'Africa/Lagos', 'both'),
    ('Dubai', 'Asia/Dubai', 'both'),
    ('GST', 'Asia/Dubai', 'zone'),
    ('PKT', 'Asia/Karachi', 'both'),
    ('IST', 'Asia/Kolkata', 'both'),
    ('Nepal', 'Asia/Kathmandu', 'both'),
    ('Dhaka', 'Asia/Dhaka', 'both'),
    ('Sri Lanka', 'Asia/Colombo', 'both'),
    ('Bangkok', 'Asia/Bangkok', 'both'),
    ('SGT', 'Asia/Singapore', 'both'),
    ('HKT', 'Asia/Hong_Kong', 'both'),
    ('China', 'Asia/Shanghai', 'both'),
    ('JST', 'Asia/Tokyo', 'both'),
    ('Korea', 'Asia/Seoul', 'both'),
    ('KST', 'Asia/Seoul', 'zone'),
    ('AWST', 'Australia/Perth', 'both'),
    ('Adelaide', 'Australia/Adelaide', 'both'),
    ('Sydney', 'Australia/Sydney', 'both'),
    ('AEST', 'Australia/Sydney', 'zone'),
    ('AEDT', 'Australia/Sydney', 'zone'),
    ('NZ', 'Pacific/Auckland', 'both'),
    ('Fiji', 'Pacific/Fiji', 'both'),
    ('Newfoundland', 'America/St_Johns', 'both'),
    ('AT', 'America/Halifax', 'both'),
    ('EST', 'America/New_York', 'both'),
    ('ET', 'America/New_York', 'zone'),
    ('EDT', 'America/New_York', 'zone'),
    ('CT', 'America/Chicago', 'both'),
    ('CST', 'America/Chicago', 'zone'),
    ('CDT', 'America/Chicago', 'zone'),
    ('MT', 'America/Denver', 'both'),
    ('MDT', 'America/Denver', 'zone'),
    ('MST', 'America/Phoenix', 'both'),
    ('PT', 'America/Los_Angeles', 'both'),
    ('PST', 'America/Los_Angeles', 'zone'),
    ('PDT', 'America/Los_Angeles', 'zone'),
    ('Alaska', 'America/Anchorage', 'both'),
    ('Hawaii', 'Pacific/Honolulu', 'both'),
    ('BRT', 'America/Sao_Paulo', 'both'),
    ('ART', 'America/Argentina/Buenos_Aires', 'both'),
    ('CDMX', 'America/Mexico_City', 'both'),
    ('COT', 'America/Bogota', 'both'),
    ('PET', 'America/Lima', 'both'),
    ('ECT', 'America/Guayaquil', 'both'),
    ('VET', 'America/Caracas', 'both'),
    ('CLT', 'America/Santiago', 'both')
$$;

-- Label for a zone in a circle name: "UK", "CT", "IST"; otherwise "GMT-5" or the place name ("Kolkata").
create or replace function public.circle_zone_label(p_tz text)
returns text language sql immutable set search_path = '' as $$
  select coalesce(
    (select z.label from public.circle_zone_labels() z where z.tz = p_tz and z.use <> 'zone' limit 1),
    case
      when p_tz is null then ''
      when p_tz ~ '^Etc/GMT[+-]\d+$' then 'GMT' || translate(substring(p_tz from '[+-]\d+$'), '+-', '-+')
      else replace(regexp_replace(p_tz, '^.*/', ''), '_', ' ')
    end);
$$;

-- Zone for a label read from a name ("uk", "CST", "Polska"); null when unknown.
create or replace function public.circle_zone_for_label(p_label text)
returns text language sql immutable set search_path = '' as $$
  select z.tz from public.circle_zone_labels() z
  where lower(z.label) = lower(trim(p_label)) and z.use <> 'label' limit 1;
$$;

-- Time in the style of imported names: 17:00 -> "5pm", 19:30 -> "7.30pm" (or "7:30pm" with p_sep ':'), 00:00 -> "12am".
create or replace function public.circle_time_label(p_time time, p_sep text default '.')
returns text language sql immutable set search_path = '' as $$
  select (mod(extract(hour from p_time)::int + 11, 12) + 1)::text
    || case when extract(minute from p_time)::int = 0 then ''
            else coalesce(p_sep, '.') || lpad(extract(minute from p_time)::int::text, 2, '0') end
    || case when extract(hour from p_time)::int < 12 then 'am' else 'pm' end;
$$;

-- Rewrite the day and time segments of an imported "TG ..." name for a new schedule. Any other name comes back as is.
create or replace function public.circle_name_follow_schedule(
  p_name text, p_old_weekday smallint, p_old_start time, p_old_tz text,
  p_weekday smallint, p_start time, p_tz text)
returns text language plpgsql stable set search_path = '' as $$
declare
  day_re constant text := '^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$';
  time_re constant text := '^(\d{1,2})(?:([.:])(\d{2}))?\s*([ap]m)\s*(.*)$';
  short_days constant text[] := array['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  long_days constant text[] := array['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  segs text[];
  m text[];
  label text;
  other_tz text;
  session_date date;
  session_at timestamptz;
  day_changed boolean := p_weekday is distinct from p_old_weekday;
  tz_changed boolean := coalesce(p_tz, '') <> coalesce(p_old_tz, '');
  time_changed boolean := p_start is distinct from p_old_start or coalesce(p_tz, '') <> coalesce(p_old_tz, '');
begin
  if p_name is null or p_weekday is null or p_start is null or not (day_changed or time_changed) then
    return p_name;
  end if;
  segs := regexp_split_to_array(trim(p_name), '\s*\|\s*');
  if coalesce(array_length(segs, 1), 0) < 3 or segs[1] !~* '^TG(\s|$)'
     or lower(segs[2]) !~ day_re or segs[3] !~* time_re then
    return p_name;
  end if;

  if day_changed then
    segs[2] := case when length(segs[2]) > 5 then long_days[p_weekday] else short_days[p_weekday] end;
  end if;

  if time_changed then
    m := regexp_match(segs[3], time_re, 'i');
    label := case when tz_changed then public.circle_zone_label(p_tz) else trim(m[5]) end;
    segs[3] := concat_ws(' ', public.circle_time_label(p_start, coalesce(m[2], '.')), nullif(label, ''));

    -- Extra time segments ("3pm UK"): the same moment in their own zone, on the next session date (clocks change
    -- on different dates around the world). Segments with an unknown zone are left as they are.
    session_date := current_date + ((p_weekday - extract(isodow from current_date)::int + 7) % 7);
    session_at := (session_date + p_start) at time zone coalesce(p_tz, 'Europe/London');
    for i in 4 .. array_length(segs, 1) loop
      m := regexp_match(segs[i], time_re, 'i');
      continue when m is null;
      other_tz := public.circle_zone_for_label(m[5]);
      continue when other_tz is null;
      segs[i] := concat_ws(' ', public.circle_time_label((session_at at time zone other_tz)::time, coalesce(m[2], '.')),
                           nullif(trim(m[5]), ''));
    end loop;
  end if;

  return array_to_string(segs, ' | ');
exception when others then
  return p_name; -- never block saving a circle over its name
end;
$$;

-- Same trigger as before (circles_auto_name, runs before circles_before_write), now also:
-- forcing automatic names on insert, and keeping imported names in step with the schedule.
create or replace function public.circles_auto_name()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.source is distinct from 'import' and not coalesce(new.is_demo, false) then
    new.name_auto := true;
  end if;

  if new.name_auto and new.weekday is not null and new.start_time is not null then
    -- An invalid day gives no name; keep the given one so the table's own checks report the real problem.
    new.name := coalesce(public.circle_auto_name(new.facilitator_id, new.weekday, new.start_time, coalesce(new.timezone, 'Europe/London')), new.name);
  elsif tg_op = 'UPDATE' and not new.name_auto and new.name is not distinct from old.name
        and (new.weekday is distinct from old.weekday or new.start_time is distinct from old.start_time
             or coalesce(new.timezone, 'Europe/London') is distinct from coalesce(old.timezone, 'Europe/London')) then
    new.name := public.circle_name_follow_schedule(new.name, old.weekday, old.start_time, coalesce(old.timezone, 'Europe/London'),
                                                   new.weekday, new.start_time, coalesce(new.timezone, 'Europe/London'));
  end if;
  return new;
end;
$$;

revoke execute on function public.circle_zone_labels() from public, anon, authenticated;
revoke execute on function public.circle_zone_label(text) from public, anon, authenticated;
revoke execute on function public.circle_zone_for_label(text) from public, anon, authenticated;
revoke execute on function public.circle_time_label(time, text) from public, anon, authenticated;
revoke execute on function public.circle_name_follow_schedule(text, smallint, time, text, smallint, time, text) from public, anon, authenticated;
revoke execute on function public.circles_auto_name() from public, anon, authenticated;
