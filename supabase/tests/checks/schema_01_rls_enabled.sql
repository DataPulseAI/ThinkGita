-- Schema check: row level security is switched on for every table in the public schema.
-- Why: the dashboard talks to the database with the anon key plus a user JWT. A public table without RLS
-- is readable and writable by any signed-in user (or anyone with the anon key) through the REST API.
-- Returns one row per table that is missing RLS. Zero rows = pass.
select
  'RLS is not enabled on public table' as problem,
  c.relname as table_name
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and not c.relrowsecurity
order by c.relname;
