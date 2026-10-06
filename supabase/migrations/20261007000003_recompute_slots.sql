-- Re-apply buffer to every circle after settings change. Fails (and rolls back) if the new buffer creates a clash.
create or replace function public.recompute_slots()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'not authorised'; end if;
  update public.circles set duration_min = duration_min where id is not null;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.recompute_slots() from public, anon;
grant execute on function public.recompute_slots() to authenticated;
