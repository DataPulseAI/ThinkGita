-- Roles, 8 Oct 2026:
--   every admin can see attendance and attendance insights;
--   only super admins can add or remove admins, or change who is a super admin.

-- Attendance: readable by every admin (was super admins only).
-- (ALTER rather than DROP/CREATE: same result, and avoids a tooling hang on DROP.)
alter policy super_read on public.attendance_sessions using ((select public.is_admin()));
alter policy super_read on public.attendance_sessions rename to admin_read;
alter policy super_read on public.attendance using ((select public.is_admin()));
alter policy super_read on public.attendance rename to admin_read;

-- Admin list: everyone reads it and can edit display names; only super admins add or remove.
alter policy admin_all on public.admin_emails using ((select public.is_super_admin())) with check ((select public.is_super_admin()));
alter policy admin_all on public.admin_emails rename to super_all;
create policy admin_read on public.admin_emails for select to authenticated using ((select public.is_admin()));
create policy admin_update on public.admin_emails for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Only a super admin may change an email or super status (row policies can't see which columns changed),
-- and there must always be at least one super admin left.
create or replace function public.guard_admin_emails()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and auth.role() = 'authenticated' and not public.is_super_admin()
     and (new.email is distinct from old.email or new.is_super is distinct from old.is_super) then
    raise exception 'Only super admins can change an admin''s email or super admin status';
  end if;
  if old.is_super and (tg_op = 'DELETE' or not new.is_super)
     and not exists (select 1 from public.admin_emails where is_super and email <> old.email) then
    raise exception 'There must be at least one super admin';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke execute on function public.guard_admin_emails() from public, anon, authenticated;
create trigger guard_admin_emails before update or delete on public.admin_emails
  for each row execute function public.guard_admin_emails();

-- TRUNCATE skips row security, so the dashboard roles must never have it.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke truncate on public.%I from anon, authenticated', t.tablename);
  end loop;
end $$;
