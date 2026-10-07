-- Facilitators can't read the circles table directly, so the ownership check runs as a narrow helper.
create or replace function public.is_my_circle(p_circle uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.circles c
    join public.facilitators f on f.id = c.facilitator_id
    where c.id = p_circle
      and f.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke execute on function public.is_my_circle(uuid) from public, anon;
grant execute on function public.is_my_circle(uuid) to authenticated;

alter policy own_insert on public.change_requests
  with check (
    requested_by = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    and public.is_my_circle(circle_id)
  );
