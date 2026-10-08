-- Attendance from Zoom: who joined each past session of each circle. Super admins only.

-- Super admins: can see attendance. Normal admins and facilitators cannot.
alter table public.admin_emails add column if not exists is_super boolean not null default false;
-- Mark super admins by hand (not committed, to keep emails out of the repo):
--   update public.admin_emails set is_super = true where email = '<super-admin-email>';

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_emails a
                 where a.email = lower(coalesce(auth.jwt() ->> 'email', '')) and a.is_super);
$$;
revoke execute on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;

-- One row per Zoom session that has taken place (one occurrence of a circle's weekly meeting).
create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid references public.circles(id) on delete set null,
  circle_name text,
  zoom_meeting_id text not null,
  zoom_uuid text not null unique,
  started_at timestamptz not null,
  ended_at timestamptz,
  participant_count int not null default 0,
  synced_at timestamptz not null default now()
);
create index if not exists attendance_sessions_circle on public.attendance_sessions (circle_id, started_at);

-- One row per person per session (rejoins merged). person_key = email if known, else lower-cased name.
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  person_key text not null,
  name text,
  email text,
  first_join timestamptz,
  last_leave timestamptz,
  minutes int not null default 0,
  unique (session_id, person_key)
);

alter table public.attendance_sessions enable row level security;
alter table public.attendance enable row level security;
create policy super_read on public.attendance_sessions for select to authenticated using ((select public.is_super_admin()));
create policy super_read on public.attendance for select to authenticated using ((select public.is_super_admin()));
grant select on public.attendance_sessions, public.attendance to authenticated;
-- Writes come only from the provision-circle function (service role).
