-- Schema check: no row level security policy grants anything to the anon (signed out) role.
-- Why: every feature of the dashboard needs a signed-in user, and the Tally webhook and edge functions use the
-- service role. None of the migrations add a policy for anon or PUBLIC, so any such policy is a leak.
-- Covers public tables and the facilitator-photos rows in storage.objects (the bucket is public, so the website
-- reads photos by public URL without needing any storage policy).
-- Returns one row per offending policy. Zero rows = pass.
select
  'policy is granted to anon or PUBLIC' as problem,
  p.schemaname,
  p.tablename,
  p.policyname,
  p.cmd,
  p.roles::text as roles
from pg_catalog.pg_policies p
where (p.schemaname = 'public'
       or (p.schemaname = 'storage' and p.tablename = 'objects' and coalesce(p.qual, '') || coalesce(p.with_check, '') like '%facilitator-photos%'))
  and (p.roles && array['anon', 'public']::name[])
order by p.schemaname, p.tablename, p.policyname;
