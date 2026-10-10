-- Schema check: the API roles cannot execute internal functions.
-- Why: anything in public that anon or authenticated may execute is callable over the REST API as an RPC.
-- Internal helpers skip the admin check (_allocate, free_licence_for ...), cron jobs act for the whole system
-- (close_finished, framer_sync_tick, framer_daily_refresh), framer_cron_ok reveals whether a guess matches the
-- cron secret, and trigger functions should only ever run as triggers.
-- Rules:
--   1. anon may execute no project function in public at all (nothing in the app runs signed out).
--   2. authenticated may not execute any trigger function or any function in the internal list below.
-- Functions that belong to an extension are ignored.
-- Returns one row per role and function that breaks a rule. Zero rows = pass.
with fns as (
  select p.oid, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
         p.prorettype = 'pg_catalog.trigger'::regtype as is_trigger
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and not exists (select 1 from pg_catalog.pg_depend d
                     where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
),
internal(name) as (
  values ('_allocate'), ('_reallocate_conflicts'), ('free_licence'), ('free_licence_for'),
         ('close_finished'), ('framer_sync_tick'), ('framer_daily_refresh'), ('framer_cron_ok'),
         ('circle_auto_name'), ('my_circles')
)
select 'anon can execute a public function' as problem, 'anon' as role_name, f.proname as function_name, f.arguments
from fns f
where pg_catalog.has_function_privilege('anon', f.oid, 'execute')
union all
select case when f.is_trigger then 'authenticated can execute a trigger function'
            else 'authenticated can execute an internal function' end,
       'authenticated', f.proname, f.arguments
from fns f
where (f.is_trigger or f.proname in (select name from internal))
  and pg_catalog.has_function_privilege('authenticated', f.oid, 'execute')
order by 2, 3;
