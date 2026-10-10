-- Data check (warning): every timezone in use is a real IANA timezone name.
-- Why: circle_slots silently treats the time as UK time if the name is unknown to Postgres, Zoom rejects it,
-- and framer_daily_refresh skips the clock-change refresh. Checks circles that are not ended or rejected,
-- and the default timezone in settings.
-- Returns one row per invalid timezone. Zero rows = pass.
select
  'circle timezone is not a valid timezone name' as problem,
  c.id::text as row_id,
  c.name as row_name,
  c.timezone
from public.circles c
where c.status not in ('ended', 'rejected')
  and not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = c.timezone)
union all
select 'settings default timezone is not a valid timezone name', s.id::text, 'settings', s.default_timezone
from public.settings s
where not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = s.default_timezone)
order by 1, 3;
