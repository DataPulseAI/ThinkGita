-- Data check (warning): every live or paused circle sits on a licence, and that licence is active.
-- Why: the Zoom meeting belongs to the licence's Zoom user. licences_before_write refuses to deactivate a licence
-- with live circles, so a live circle on an inactive or missing licence means data was changed around the rules.
-- Returns one row per circle in that state. Zero rows = pass.
select
  case when c.licence_id is null then 'live or paused circle has no licence'
       when l.id is null then 'live or paused circle points at a licence that does not exist'
       else 'live or paused circle is on an inactive licence' end as problem,
  c.id as circle_id,
  c.name as circle_name,
  c.status::text as status,
  l.label as licence_label
from public.circles c
left join public.licences l on l.id = c.licence_id
where c.status in ('live', 'paused')
  and (c.licence_id is null or l.id is null or not l.active)
order by c.name;
