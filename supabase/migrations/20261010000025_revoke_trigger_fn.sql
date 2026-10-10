-- 10 Oct 2026: circles_before_write is a trigger function; API roles never need to call it directly.
-- Found by supabase/tests/checks/schema_04 (internal functions must not be executable by anon or authenticated).
revoke execute on function public.circles_before_write() from public, anon, authenticated;
