-- Schema check: the scheduled jobs exist, are active and run the expected command.
-- Why: close-finished-circles ends circles past their end date and frees their licence; framer-sync-tick pushes
-- website changes and retries failed publishes; framer-daily-refresh updates date-dependent website text.
-- A missing or paused job does not error anywhere, the data just goes stale.
-- Returns one row per missing, inactive or changed job. Zero rows = pass.
with expected(jobname, command) as (
  values
    ('close-finished-circles', 'select public.close_finished()'),
    ('framer-sync-tick', 'select public.framer_sync_tick()'),
    ('framer-daily-refresh', 'select public.framer_daily_refresh()')
)
select
  case when j.jobid is null then 'required cron job is missing'
       when not j.active then 'required cron job is not active'
       else 'cron job runs an unexpected command: ' || j.command end as problem,
  e.jobname
from expected e
left join cron.job j on j.jobname = e.jobname
where j.jobid is null
   or not j.active
   or lower(trim(trailing ';' from trim(j.command))) <> e.command
order by e.jobname;
