-- Data check (warning): there is at least one super admin.
-- Why: only super admins can add or remove admins (migration 018). guard_admin_emails stops the last super admin
-- being removed through the API, but an empty or wrongly seeded table (new branch, restore) would lock everyone
-- out of admin management.
-- Returns one row if there is no super admin. Zero rows = pass.
select
  'no super admin exists' as problem,
  (select count(*) from public.admin_emails) as admin_count
where not exists (select 1 from public.admin_emails where is_super);
