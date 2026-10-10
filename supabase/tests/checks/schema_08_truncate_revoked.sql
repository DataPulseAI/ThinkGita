-- Schema check: anon and authenticated do not hold TRUNCATE on any public table.
-- Why: TRUNCATE bypasses row level security, so one signed-in user could empty a whole table.
-- Migration 018 revoked it on every table; new tables must revoke it too.
-- Returns one row per role and table that still has TRUNCATE. Zero rows = pass.
select
  'API role has TRUNCATE on a public table' as problem,
  r.role_name,
  c.relname as table_name
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
cross join (values ('anon'), ('authenticated')) r(role_name)
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and pg_catalog.has_table_privilege(r.role_name, c.oid, 'TRUNCATE')
order by c.relname, r.role_name;
