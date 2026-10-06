-- ThinkGita circles: core schema, licence allocator, RLS
create extension if not exists btree_gist with schema extensions;

create type public.circle_status as enum
  ('pending', 'conflict', 'approved', 'live', 'paused', 'ended', 'rejected');

-- Singleton settings row
create table public.settings (
  id int primary key default 1 check (id = 1),
  buffer_minutes int not null default 15 check (buffer_minutes between 0 and 120),
  default_duration_min int not null default 60,
  default_timezone text not null default 'Europe/London',
  term_start date,
  term_end date,
  updated_at timestamptz not null default now()
);
insert into public.settings default values;

-- Who can administer the system (matched against the login email)
create table public.admin_emails (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);

create table public.licences (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  zoom_user_email text unique check (zoom_user_email = lower(zoom_user_email)),
  zoom_user_id text,
  host_key text,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.facilitators (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique check (email = lower(email)),
  phone text,
  created_at timestamptz not null default now()
);

create table public.circles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  facilitator_id uuid references public.facilitators(id) on delete set null,
  weekday smallint not null check (weekday between 1 and 7), -- ISO: 1 = Monday, 7 = Sunday
  start_time time not null,
  duration_min int not null check (duration_min between 15 and 240),
  timezone text not null default 'Europe/London',
  licence_id uuid references public.licences(id) on delete set null,
  slot int4range, -- minutes of week incl. buffer, maintained by trigger
  status public.circle_status not null default 'pending',
  conflict_reason text,
  starts_on date,
  ends_on date,
  zoom_meeting_id text,
  join_url text,
  passcode text,
  notes text,
  source text not null default 'manual',
  tally_submission_id text unique,
  raw_submission jsonb,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint no_licence_clash exclude using gist (licence_id with =, slot with &&)
    where (licence_id is not null and status in ('pending', 'approved', 'live'))
);
create index circles_facilitator_idx on public.circles (facilitator_id);
create index circles_licence_idx on public.circles (licence_id);

create table public.change_requests (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete cascade,
  requested_by text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  message text not null check (length(message) between 1 and 2000),
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  created_at timestamptz not null default now()
);
create index change_requests_circle_idx on public.change_requests (circle_id);

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text,
  action text not null,
  circle_id uuid references public.circles(id) on delete set null,
  detail jsonb
);
create index audit_log_circle_idx on public.audit_log (circle_id);

-- Helpers -----------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_emails
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.week_slot(p_weekday smallint, p_start time, p_duration int, p_buffer int)
returns int4range language sql immutable set search_path = '' as $$
  select int4range(
    (p_weekday - 1) * 1440 + extract(hour from p_start)::int * 60 + extract(minute from p_start)::int,
    (p_weekday - 1) * 1440 + extract(hour from p_start)::int * 60 + extract(minute from p_start)::int
      + p_duration + p_buffer
  );
$$;

create or replace function public.circles_before_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.slot := public.week_slot(new.weekday, new.start_time, new.duration_min,
    (select buffer_minutes from public.settings where id = 1));
  new.updated_at := now();
  return new;
end;
$$;

create trigger circles_before_write
before insert or update of weekday, start_time, duration_min, status, licence_id on public.circles
for each row execute function public.circles_before_write();

-- Allocator: first active licence with no overlapping booking -------------
create or replace function public.allocate_circle(p_circle uuid)
returns public.circles language plpgsql security definer set search_path = '' as $$
declare
  c public.circles;
  l record;
begin
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'not authorised';
  end if;

  perform pg_advisory_xact_lock(7001);
  select * into c from public.circles where id = p_circle for update;
  if not found then raise exception 'circle not found'; end if;
  if c.status in ('live', 'ended', 'rejected', 'paused') then
    return c; -- never move a circle that already has a Zoom meeting
  end if;

  for l in select id from public.licences where active order by sort_order, label loop
    if not exists (
      select 1 from public.circles o
      where o.licence_id = l.id and o.id <> c.id
        and o.status in ('pending', 'approved', 'live')
        and o.slot && c.slot
    ) then
      update public.circles
         set licence_id = l.id,
             status = case when c.status = 'conflict' then 'pending'::public.circle_status else c.status end,
             conflict_reason = null
       where id = c.id
      returning * into c;
      return c;
    end if;
  end loop;

  update public.circles
     set licence_id = null, status = 'conflict',
         conflict_reason = 'Every active licence is already booked at this time'
   where id = c.id
  returning * into c;
  return c;
end;
$$;

-- Suggest nearby free start times on the same day -------------------------
create or replace function public.suggest_slots(p_circle uuid, p_window_min int default 180, p_step int default 15)
returns table (weekday smallint, start_time time, licence_label text)
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.circles;
  buf int;
  off int;
  m int;
  r int4range;
  lab text;
  n int := 0;
begin
  if not public.is_admin() then raise exception 'not authorised'; end if;
  select * into c from public.circles where id = p_circle;
  select buffer_minutes into buf from public.settings where id = 1;

  for off in
    select g from generate_series(-p_window_min, p_window_min, p_step) g order by abs(g), g
  loop
    m := extract(hour from c.start_time)::int * 60 + extract(minute from c.start_time)::int + off;
    continue when m < 0 or m + c.duration_min > 1440;
    r := int4range((c.weekday - 1) * 1440 + m, (c.weekday - 1) * 1440 + m + c.duration_min + buf);
    select li.label into lab from public.licences li
     where li.active and not exists (
       select 1 from public.circles o
        where o.licence_id = li.id and o.id <> c.id
          and o.status in ('pending', 'approved', 'live') and o.slot && r)
     order by li.sort_order, li.label limit 1;
    if lab is not null then
      weekday := c.weekday;
      start_time := make_time(m / 60, m % 60, 0);
      licence_label := lab;
      return next;
      n := n + 1;
      exit when n >= 5;
    end if;
  end loop;
end;
$$;

-- Facilitator view: own circles incl. host key ----------------------------
create or replace function public.my_circles()
returns table (
  id uuid, name text, weekday smallint, start_time time, duration_min int, timezone text,
  status public.circle_status, join_url text, zoom_meeting_id text, passcode text,
  host_key text, starts_on date, ends_on date
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.weekday, c.start_time, c.duration_min, c.timezone, c.status,
         c.join_url, c.zoom_meeting_id, c.passcode,
         case when c.status = 'live' then l.host_key end,
         c.starts_on, c.ends_on
    from public.circles c
    join public.facilitators f on f.id = c.facilitator_id
    left join public.licences l on l.id = c.licence_id
   where f.email = lower(coalesce(auth.jwt() ->> 'email', ''))
   order by c.weekday, c.start_time;
$$;

-- Lock down function execution --------------------------------------------
revoke execute on function public.allocate_circle(uuid) from public, anon;
revoke execute on function public.suggest_slots(uuid, int, int) from public, anon;
revoke execute on function public.my_circles() from public, anon;
grant execute on function public.allocate_circle(uuid) to authenticated, service_role;
grant execute on function public.suggest_slots(uuid, int, int) to authenticated;
grant execute on function public.my_circles() to authenticated;

-- RLS ---------------------------------------------------------------------
alter table public.settings enable row level security;
alter table public.admin_emails enable row level security;
alter table public.licences enable row level security;
alter table public.facilitators enable row level security;
alter table public.circles enable row level security;
alter table public.change_requests enable row level security;
alter table public.audit_log enable row level security;

create policy admin_all on public.settings for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy admin_all on public.admin_emails for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy admin_all on public.licences for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy admin_all on public.facilitators for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy admin_all on public.circles for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy admin_all on public.audit_log for select to authenticated
  using ((select public.is_admin()));

create policy self_read on public.facilitators for select to authenticated
  using (email = lower(coalesce((select auth.jwt()) ->> 'email', '')));

create policy admin_all on public.change_requests for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy own_read on public.change_requests for select to authenticated
  using (requested_by = lower(coalesce((select auth.jwt()) ->> 'email', '')));
create policy own_insert on public.change_requests for insert to authenticated
  with check (
    requested_by = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    and exists (
      select 1 from public.circles c join public.facilitators f on f.id = c.facilitator_id
       where c.id = circle_id and f.email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    )
  );

-- Bootstrap admin: not stored in the repo. Run once in the SQL editor for a new project:
--   insert into public.admin_emails (email) values ('<your-admin-email>');
