-- my_circles() was replaced by my_circles_v2() and is no longer called by the dashboard.
revoke execute on function public.my_circles() from authenticated, anon, public;
