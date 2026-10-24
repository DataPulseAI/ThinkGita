-- 24 Oct 2026: circle attendees from the Tally sign-up form, and the Zoom registration trial.
--
-- Attendees: every "Think Gita Circles Sign Up" submission (form zxRkR8) is stored here by the `signups` function, from
-- the Tally webhook or the API backfill. Each one is linked to a circle:
--   link     the sign-up link carried the circle's id (hidden field circle_id, added by the dashboard's link buttons)
--   auto     older sign-ups without an id, matched on the other link fields (WhatsApp group, facilitator, language, date)
--   manual   an admin picked the circle under "Needs matching"
--   none     an admin said it belongs to no circle
-- Admins see every attendee. Facilitators see the attendees of their own circles through my_circle_signups(), which
-- leaves out the date of birth and the raw answers.
--
-- Zoom registration: circles.zoom_registration says the circle's meeting asks joiners for their name and email
-- (automatic approval, register once for the whole series). settings.zoom_registration_new turns it on for new meetings.

alter table public.circles add column if not exists zoom_registration boolean not null default false;
alter table public.settings add column if not exists zoom_registration_new boolean not null default false;
alter table public.settings add column if not exists signups_synced_at timestamptz;

create table if not exists public.circle_signups (
  id uuid primary key default gen_random_uuid(),
  response_id text not null unique,
  form_id text not null,
  submitted_at timestamptz not null,
  circle_id uuid references public.circles(id) on delete set null,
  match_method text check (match_method in ('link', 'auto', 'manual', 'none')),
  match_note text,
  match_candidates uuid[] not null default '{}',
  matched_by text,
  matched_at timestamptz,
  first_name text,
  last_name text,
  email text,
  phone text,
  city text,
  country text,
  date_of_birth date,
  read_before text,
  heard_from text,
  goals text,
  whatsapp_active boolean,
  consent boolean,
  utm jsonb not null default '{}'::jsonb,
  answers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists circle_signups_circle on public.circle_signups (circle_id, submitted_at desc);
create index if not exists circle_signups_email on public.circle_signups (lower(email));

alter table public.circle_signups enable row level security;
create policy admin_read on public.circle_signups for select to authenticated using ((select public.is_admin()));
create policy admin_match on public.circle_signups for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
-- Admins only change which circle a sign-up belongs to. Everything else is written by the signups function.
revoke all on public.circle_signups from anon, authenticated;
grant select on public.circle_signups to authenticated;
grant update (circle_id, match_method) on public.circle_signups to authenticated;

-- A person changing the circle (an admin, from the dashboard) is a manual match, kept by later re-matching.
create or replace function public.circle_signups_touch()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  who text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  new.updated_at := now();
  if who is not null and (new.circle_id is distinct from old.circle_id or new.match_method is distinct from old.match_method) then
    new.match_method := case when new.circle_id is null then 'none' else 'manual' end;
    new.matched_by := who;
    new.matched_at := now();
    new.match_note := null;
    insert into public.audit_log (actor, action, circle_id, detail)
    values (who, 'signup_matched', new.circle_id, jsonb_build_object('signup_id', new.id, 'method', new.match_method));
  end if;
  return new;
end $$;
revoke execute on function public.circle_signups_touch() from public, anon, authenticated;
create trigger circle_signups_touch before update on public.circle_signups
  for each row execute function public.circle_signups_touch();

-- Facilitators: the attendees of their own circles (lead or co-facilitator). No date of birth, no raw answers.
create or replace function public.my_circle_signups()
returns table(id uuid, circle_id uuid, submitted_at timestamptz, first_name text, last_name text, email text, phone text,
  city text, country text, read_before text, heard_from text, goals text, whatsapp_active boolean)
language sql stable security definer set search_path = '' as $$
  select s.id, s.circle_id, s.submitted_at, s.first_name, s.last_name, s.email, s.phone,
         s.city, s.country, s.read_before, s.heard_from, s.goals, s.whatsapp_active
    from public.circle_signups s
   where s.circle_id is not null and public.is_my_circle(s.circle_id)
   order by s.submitted_at desc;
$$;
revoke execute on function public.my_circle_signups() from public, anon;
grant execute on function public.my_circle_signups() to authenticated;

-- Facilitators: what the sign-up link is made from (the dashboard builds it, as the website sync does), and whether
-- their Zoom meeting asks joiners to register.
create or replace function public.my_circle_link_parts()
returns table(id uuid, name text, name_auto boolean, status public.circle_status, language text, circle_type text,
  starts_on date, preferred_start date, whatsapp_group_link text, zoom_registration boolean, hosts text[])
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.name_auto, c.status, c.language, c.circle_type, c.starts_on, c.preferred_start, c.whatsapp_group_link,
         c.zoom_registration,
         array_remove(array[coalesce(nullif(btrim(f.initiated_name), ''), f.name)] || coalesce((
           select array_agg(coalesce(nullif(btrim(cf2.initiated_name), ''), cf2.name) order by cf.created_at)
             from public.circle_cofacilitators cf join public.facilitators cf2 on cf2.id = cf.facilitator_id
            where cf.circle_id = c.id), '{}'), null)
    from public.circles c
    left join public.facilitators f on f.id = c.facilitator_id
   where public.is_my_circle(c.id);
$$;
revoke execute on function public.my_circle_link_parts() from public, anon;
grant execute on function public.my_circle_link_parts() to authenticated;
