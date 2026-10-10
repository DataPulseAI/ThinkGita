-- Data check (warning): website publishing is not stuck and the last whole sync succeeded.
-- Why: framer_publish_pending stays on until a publish succeeds; the cron tick retries with back-off up to every
-- 30 minutes. Pending with no successful publish in the last hour, or framer_fail_count above zero (a whole sync
-- failed, for example a bad API key), means website changes are not reaching the live site.
-- Returns one row per problem found in settings. Zero rows = pass.
select
  'website publish has been pending for over an hour' as problem,
  s.framer_publish_attempts as attempts,
  s.framer_publish_tried_at as last_attempt_at,
  left(s.framer_publish_error, 200) as last_error
from public.settings s
where s.framer_publish_pending
  and s.framer_auto_publish
  and coalesce(s.framer_published_at, '-infinity'::timestamptz) < now() - interval '1 hour'
  and coalesce(s.framer_publish_tried_at, '-infinity'::timestamptz) < now() - interval '5 minutes'
union all
select 'website sync is failing (framer_fail_count > 0)', s.framer_fail_count, s.framer_failed_at, left(s.framer_last_error, 200)
from public.settings s
where s.framer_fail_count > 0
order by 1;
