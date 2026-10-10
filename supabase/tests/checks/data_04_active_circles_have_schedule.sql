-- Data check (warning): circles in an active status have a weekday, start time, timezone and computed slots.
-- Why: clash checking, automatic names, Zoom scheduling and the website all depend on these. weekday, start_time
-- and timezone are NOT NULL columns, so this mostly catches empty timezones and rows whose slots were never
-- computed (circles_before_write fills slots and ref times on every write).
-- Active statuses: pending, conflict, approved, live, paused.
-- Returns one row per incomplete circle. Zero rows = pass.
select
  concat_ws(', ',
    case when c.weekday is null then 'no weekday' end,
    case when c.start_time is null then 'no start time' end,
    case when nullif(trim(c.timezone), '') is null then 'no timezone' end,
    case when c.slots is null or isempty(c.slots) then 'no computed slots' end,
    case when c.ref_weekday is null or c.ref_start_time is null then 'no UK reference time' end
  ) as problem,
  c.id as circle_id,
  c.name as circle_name,
  c.status::text as status
from public.circles c
where c.status in ('pending', 'conflict', 'approved', 'live', 'paused')
  and (c.weekday is null or c.start_time is null or nullif(trim(c.timezone), '') is null
       or c.slots is null or isempty(c.slots) or c.ref_weekday is null or c.ref_start_time is null)
order by c.name;
