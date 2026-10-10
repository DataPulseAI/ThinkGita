-- Data check (warning): no Zoom licence has more than 2 meetings overlapping at the same moment.
-- Why: Zoom lets one host account run at most 2 meetings at once. circles_capacity_check (migration 019) blocks
-- a third on insert or update, but rows written before that trigger existed, or by a session that disabled
-- triggers, are not re-checked. Booked statuses: pending, approved, live, paused.
-- Returns one row per set of three circles that overlap on one licence. Zero rows = pass.
with booked as (
  select id, name, licence_id, slots
  from public.circles
  where licence_id is not null and slots is not null
    and status in ('pending', 'approved', 'live', 'paused')
)
select
  'licence has 3 or more meetings at the same time' as problem,
  l.label as licence_label,
  a.id as circle_a, b.id as circle_b, c.id as circle_c,
  (a.slots * b.slots * c.slots)::text as overlapping_minutes_of_week
from booked a
join booked b on b.licence_id = a.licence_id and b.id > a.id and b.slots && a.slots
join booked c on c.licence_id = a.licence_id and c.id > b.id and c.slots && a.slots and c.slots && b.slots
join public.licences l on l.id = a.licence_id
where not isempty(a.slots * b.slots * c.slots)
order by l.label, a.id, b.id, c.id;
