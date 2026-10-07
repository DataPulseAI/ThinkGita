-- Circle names are set automatically: "Gita Circles | Initiated Name (Host Name) | Wednesday 19:30 (UK time)".
-- Without an initiated name: "Gita Circles | Host Name | Wednesday 19:30 (UK time)". The time is the host's own.
-- The name follows changes to the day, time, timezone or host. Typing a custom name in the dashboard
-- turns this off for that circle (name_auto = false); "Use automatic name" turns it back on.

alter table public.circles add column if not exists name_auto boolean not null default true;

create or replace function public.circle_auto_name(p_facilitator uuid, p_weekday smallint, p_start time, p_tz text)
returns text language sql stable security definer set search_path = '' as $$
  select 'Gita Circles | '
    || coalesce(
         case when nullif(trim(f.initiated_name), '') is not null
              then trim(f.initiated_name) || coalesce(' (' || nullif(trim(concat_ws(' ', f.first_name, f.last_name)), '') || ')', '')
         end,
         nullif(trim(concat_ws(' ', f.first_name, f.last_name)), ''),
         nullif(trim(f.name), ''),
         'New host')
    || ' | '
    || (array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'])[p_weekday]
    || ' ' || to_char(p_start, 'HH24:MI')
    || ' (' || case
         when p_tz = 'Europe/London' then 'UK time'
         when p_tz ~ '^Etc/GMT[+-]\d+$' then 'GMT' || translate(substring(p_tz from '[+-]\d+$'), '+-', '-+')
         else replace(regexp_replace(p_tz, '^.*/', ''), '_', ' ') || ' time'
       end || ')'
  from (select 1) one
  left join public.facilitators f on f.id = p_facilitator;
$$;
revoke execute on function public.circle_auto_name(uuid, smallint, time, text) from public, anon, authenticated;

create or replace function public.circles_auto_name()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.name_auto and new.weekday is not null and new.start_time is not null then
    new.name := public.circle_auto_name(new.facilitator_id, new.weekday, new.start_time, coalesce(new.timezone, 'Europe/London'));
  end if;
  return new;
end;
$$;
revoke execute on function public.circles_auto_name() from public, anon, authenticated;

-- Runs before circles_before_write (triggers fire in name order).
create or replace trigger circles_auto_name
before insert or update on public.circles
for each row execute function public.circles_auto_name();

-- Apply to existing circles.
update public.circles set name_auto = true where id is not null;
