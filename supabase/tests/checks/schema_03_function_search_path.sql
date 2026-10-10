-- Schema check: every function defined by the project in the public schema has a fixed search_path,
-- and SECURITY DEFINER functions in particular.
-- Why: a SECURITY DEFINER function runs with its owner's rights. Without a pinned search_path a caller could
-- put their own objects first on the path and hijack it. The migrations set search_path = '' (or public)
-- on every function, so a missing setting means a migration forgot it.
-- Functions that belong to an extension are ignored.
-- Returns one row per function without a search_path setting. Zero rows = pass.
select
  case when p.prosecdef then 'SECURITY DEFINER function has no fixed search_path'
       else 'function has no fixed search_path' end as problem,
  p.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and not exists (select 1 from pg_catalog.pg_depend d
                   where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg like 'search_path=%')
order by p.prosecdef desc, p.proname;
