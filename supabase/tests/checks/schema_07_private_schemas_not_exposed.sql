-- Schema check: the API roles (anon, authenticated) cannot reach the private, net or cron schemas.
-- Why: private.cron_secret holds the shared secret that lets the cron tick call framer-sync. pg_net (schema net)
-- can send HTTP requests from inside the database, and its request queue briefly holds that secret header.
-- cron can schedule arbitrary SQL. Migration 021 revoked private and migration 023 revoked net.
-- Rules:
--   1. anon and authenticated have no USAGE on private or cron, and cannot touch private.cron_secret
--      (effective privileges, including anything inherited through PUBLIC).
--   2. no grant on the private or net schema, or on any table, sequence or function in them, gives anything to
--      anon, authenticated or PUBLIC, unless the grant was made by supabase_admin.
-- Known platform default (see TESTING.md, known gaps): on hosted Supabase, pg_net is installed by supabase_admin with
-- USAGE and EXECUTE granted to PUBLIC, anon and authenticated. Only supabase_admin can revoke those, so the revoke in
-- migration 023 has no effect on them. Rule 2 therefore ignores grants whose grantor is supabase_admin and catches
-- any grant a project migration adds. net is not in the API's exposed schemas, so it is not reachable over REST.
-- Returns one row per problem. Zero rows = pass.
with roles(role_name) as (values ('anon'), ('authenticated')),
acl_targets as (
  select 'schema' as kind, n.nspname as schema_name, null::text as object_name, n.nspacl as acl
  from pg_catalog.pg_namespace n
  where n.nspname in ('private', 'net')
  union all
  select 'table', n.nspname, c.relname, c.relacl
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('private', 'net') and c.relkind in ('r', 'p', 'v', 'm', 'S')
  union all
  select 'function', n.nspname, p.proname, p.proacl
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('private', 'net')
)
select 'API role has USAGE on a private schema' as problem, r.role_name, n.nspname as schema_name, null::text as object_name
from roles r
cross join pg_catalog.pg_namespace n
where n.nspname in ('private', 'cron')
  and pg_catalog.has_schema_privilege(r.role_name, n.oid, 'USAGE')
union all
select 'API role can access private.cron_secret', r.role_name, 'private', 'cron_secret'
from roles r
where to_regclass('private.cron_secret') is not null
  and pg_catalog.has_table_privilege(r.role_name, 'private.cron_secret', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
union all
select 'project grant exposes a private ' || t.kind || ' (' || a.privilege_type || ')',
       case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
       t.schema_name, t.object_name
from acl_targets t
cross join lateral pg_catalog.aclexplode(t.acl) a
where (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
  and pg_catalog.pg_get_userbyid(a.grantor) <> 'supabase_admin'
order by 3, 2, 4;
