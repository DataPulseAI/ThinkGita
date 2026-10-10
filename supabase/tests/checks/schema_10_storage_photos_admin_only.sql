-- Schema check: the facilitator-photos storage bucket only lets admins write.
-- Why: the bucket is public so the website can show photos, which means anyone can read a file by URL.
-- Uploading, replacing and deleting must stay admin-only (migration 023), otherwise anyone signed in
-- (or the anon key) could replace a facilitator's photo on the public website.
-- Rules:
--   1. the bucket exists, with its size limit and image-only types;
--   2. the four admin policies from migration 023 exist;
--   3. every storage.objects policy that allows a write (INSERT, UPDATE, DELETE or ALL) and could apply to this
--      bucket either names a different bucket, or names this bucket, targets only authenticated and checks is_admin().
-- Returns one row per problem. Zero rows = pass.
with bucket as (
  select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'facilitator-photos'
),
expected(policyname) as (
  values ('facilitator photos admin insert'), ('facilitator photos admin update'),
         ('facilitator photos admin delete'), ('facilitator photos admin read')
),
write_policies as (
  select p.policyname, p.cmd, p.roles, coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') as expr
  from pg_catalog.pg_policies p
  where p.schemaname = 'storage' and p.tablename = 'objects'
    and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
)
select 'facilitator-photos bucket is missing' as problem, null::text as policyname
where not exists (select 1 from bucket)
union all
select 'facilitator-photos bucket has no size limit or allows non-image types', null
from bucket b
where b.file_size_limit is null
   or b.allowed_mime_types is null
   or exists (select 1 from unnest(b.allowed_mime_types) m where m not like 'image/%')
union all
select 'expected storage policy is missing', e.policyname
from expected e
where not exists (select 1 from pg_catalog.pg_policies p
                   where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname = e.policyname)
union all
select 'storage write policy could let non-admins write to facilitator-photos (' || w.cmd || ')', w.policyname
from write_policies w
where (w.expr like '%facilitator-photos%' or w.expr not like '%bucket_id%')
  and (w.roles && array['anon', 'public']::name[]
       or w.expr not like '%is_admin()%'
       or w.expr not like '%facilitator-photos%')
order by 1, 2;
