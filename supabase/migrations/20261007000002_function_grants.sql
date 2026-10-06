revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;
revoke execute on function public.week_slot(smallint, time, int, int) from public, anon;
grant execute on function public.week_slot(smallint, time, int, int) to authenticated, service_role;
