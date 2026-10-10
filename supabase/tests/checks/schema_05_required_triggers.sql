-- Schema check: every trigger the system relies on exists, calls the right function and is enabled.
-- Why: most business rules live in triggers. Losing one fails silently, for example:
--   circles_auto_name / circles_before_write: automatic names, UK reference time, slots, live licence lock
--   circles_capacity_check: never 3 meetings at once on one Zoom licence
--   circles_after_write / licences_*: re-check clashes when capacity frees, protect licences in use
--   circles_mark_framer_dirty, cofac_ and facilitator_mark_framer_dirty: keep the website in step
--   circles_audit: activity log; guard_admin_emails: only super admins change roles, always one super admin
-- Returns one row per missing, misconfigured or disabled trigger. Zero rows = pass.
with expected(table_name, trigger_name, function_name) as (
  values
    ('circles', 'circles_auto_name', 'circles_auto_name'),
    ('circles', 'circles_before_write', 'circles_before_write'),
    ('circles', 'circles_mark_framer_dirty', 'circles_mark_framer_dirty'),
    ('circles', 'circles_capacity_check', 'circles_capacity_check'),
    ('circles', 'circles_after_write', 'circles_after_write'),
    ('circles', 'circles_audit', 'circles_audit'),
    ('circle_cofacilitators', 'cofac_mark_framer_dirty', 'cofac_mark_framer_dirty'),
    ('facilitators', 'facilitator_mark_framer_dirty', 'facilitator_mark_framer_dirty'),
    ('licences', 'licences_before_write', 'licences_before_write'),
    ('licences', 'licences_after_write', 'licences_after_write'),
    ('admin_emails', 'guard_admin_emails', 'guard_admin_emails')
),
actual as (
  select c.relname as table_name, t.tgname as trigger_name, p.proname as function_name, t.tgenabled
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_proc p on p.oid = t.tgfoid
  where n.nspname = 'public' and not t.tgisinternal
)
select
  case when a.trigger_name is null then 'required trigger is missing'
       when a.function_name <> e.function_name then 'trigger calls the wrong function: ' || a.function_name
       else 'required trigger is disabled' end as problem,
  e.table_name,
  e.trigger_name
from expected e
left join actual a on a.table_name = e.table_name and a.trigger_name = e.trigger_name
where a.trigger_name is null
   or a.function_name <> e.function_name
   or a.tgenabled = 'D'
order by e.table_name, e.trigger_name;
