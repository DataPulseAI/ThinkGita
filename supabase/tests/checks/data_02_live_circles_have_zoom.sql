-- Data check (warning): every live circle has a Zoom meeting id and a join link.
-- Why: going live means provision-circle created the Zoom meeting. A live circle without these means the
-- facilitator portal and emails show no link, usually after a half-finished approve or a manual status edit.
-- Returns one row per live circle missing either field. Zero rows = pass.
select
  case when nullif(trim(c.zoom_meeting_id), '') is null and nullif(trim(c.join_url), '') is null
         then 'live circle has no Zoom meeting id and no join link'
       when nullif(trim(c.zoom_meeting_id), '') is null then 'live circle has no Zoom meeting id'
       else 'live circle has no join link' end as problem,
  c.id as circle_id,
  c.name as circle_name,
  c.is_demo
from public.circles c
where c.status = 'live'
  and (nullif(trim(c.zoom_meeting_id), '') is null or nullif(trim(c.join_url), '') is null)
order by c.name;
