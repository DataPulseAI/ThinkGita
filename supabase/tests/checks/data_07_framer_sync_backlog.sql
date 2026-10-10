-- Data check (warning): the website sync is keeping up.
-- Why: the cron tick calls framer-sync every 2 minutes while anything is dirty, so a circle that stays dirty for
-- over an hour, or whose last push failed, means the sync is stuck (bad Framer key, Framer down, a bug).
-- updated_at changes on every write to a circle, so dirty plus an updated_at older than an hour means nothing
-- has touched it since it became dirty. "Not shown on the website until set" is a readiness note, not a failure.
-- Returns one row per stuck circle. Zero rows = pass.
select
  case when c.framer_error is not null and c.framer_error not like 'Not shown on the website until set:%'
         then 'last website push failed: ' || left(c.framer_error, 200)
       else 'circle has waited over an hour for the website sync' end as problem,
  c.id as circle_id,
  c.name as circle_name,
  c.updated_at,
  c.framer_synced_at
from public.circles c
where c.framer_dirty
  and (c.updated_at < now() - interval '1 hour'
       or (c.framer_error is not null and c.framer_error not like 'Not shown on the website until set:%'))
order by c.updated_at;
