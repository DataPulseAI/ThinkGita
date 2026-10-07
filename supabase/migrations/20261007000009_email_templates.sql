-- Editable facilitator emails, plus the links and contacts they use.

-- Templates: plain text with {{placeholders}}. Admin-only.
create table if not exists public.email_templates (
  key text primary key check (key in ('approved', 'updated')),
  subject text not null,
  body text not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.email_templates enable row level security;
create policy admin_all on public.email_templates for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update on public.email_templates to authenticated;

-- Defaults used in every email unless a circle overrides them.
alter table public.settings
  add column if not exists youtube_playlist_link text,
  add column if not exists drive_folder_link text,
  add column if not exists support_contact text,
  add column if not exists sender_name text,
  add column if not exists participant_signup_link text;
comment on column public.settings.participant_signup_link is 'Default participant sign-up link. {circle_code} is replaced with the circle''s short code.';

-- Per-circle links (override the defaults above).
alter table public.circles
  add column if not exists whatsapp_group_link text,
  add column if not exists participant_signup_link text,
  add column if not exists youtube_playlist_link text,
  add column if not exists drive_folder_link text;

-- Optional host login password per licence. Admin-only table; never returned to facilitators.
alter table public.licences add column if not exists zoom_password text;

insert into public.email_templates (key, subject, body) values
('approved', 'You''re approved! Your Think Gita Circle is ready, {{first_name}}', $t$Dear {{first_name}},

Congratulations! Your application to facilitate a Think Gita Circle has been approved, and we're delighted to welcome you.

Your Circle has already been set up, and everything you need to run it is below. Please save this email for reference.

YOUR CIRCLE
Circle name: {{circle_name}}
Meeting day and time: {{meeting_day}} at {{meeting_time}} ({{timezone}})
First session: {{start_date}}

ZOOM
Meeting link: {{zoom_meeting_link}}
Meeting ID: {{zoom_meeting_id}}
Passcode: {{zoom_passcode}}
Host login: {{zoom_login_email}}
Host password: {{zoom_password}}
Please sign in with this host account to start each session.

CONTENT AND RESOURCES
YouTube playlist: {{youtube_playlist_link}}
Google Drive folder: {{drive_folder_link}}
Please request access to the Drive folder and we'll approve it on our end.

COMMUNICATION
WhatsApp group: {{whatsapp_group_link}}
This is your Circle's group for reminders, updates and discussion.

PARTICIPANT SIGN-UP
Your sign-up link: {{participant_signup_link}}
Please share this exact link when inviting people. Everyone who registers through it is automatically linked to your Circle.

GETTING STARTED

1. Sign in to Zoom with the host login above and check that your meeting opens.
2. Open the Google Drive folder and read through the facilitator guide and session materials.
3. Join the WhatsApp group and post a short welcome message.
4. Share your sign-up link with your network, community and social channels.

If anything is missing or not working, reply to this email or contact {{support_contact}} and we'll sort it out.

Thank you for stepping forward to lead a Circle. We're glad to have you with us.

Warm regards,
{{sender_name}}
Think Gita Circles Team$t$),
('updated', 'Your Think Gita Circle details have changed, {{first_name}}', $t$Dear {{first_name}},

Some details of your Circle have changed. Your up-to-date details are below. Please use these from now on.

YOUR CIRCLE
Circle name: {{circle_name}}
Meeting day and time: {{meeting_day}} at {{meeting_time}} ({{timezone}})
Next session: {{start_date}}

ZOOM
Meeting link: {{zoom_meeting_link}}
Meeting ID: {{zoom_meeting_id}}
Passcode: {{zoom_passcode}}
Host login: {{zoom_login_email}}
Host password: {{zoom_password}}

If the meeting link has changed, please share the new one in your WhatsApp group: {{whatsapp_group_link}}

If anything looks wrong, reply to this email or contact {{support_contact}}.

Warm regards,
{{sender_name}}
Think Gita Circles Team$t$)
on conflict (key) do nothing;

-- Facilitators see their own circle's links too (never the licence password).
-- New function rather than replacing my_circles(), whose return type can't be changed in place.
create or replace function public.my_circles_v2()
returns table (
  id uuid, name text, weekday smallint, start_time time, duration_min int, timezone text,
  status public.circle_status, join_url text, zoom_meeting_id text, passcode text,
  host_key text, starts_on date, ends_on date,
  whatsapp_group_link text, participant_signup_link text, youtube_playlist_link text, drive_folder_link text
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.weekday, c.start_time, c.duration_min, c.timezone, c.status,
         c.join_url, c.zoom_meeting_id, c.passcode,
         case when c.status = 'live' then l.host_key end,
         c.starts_on, c.ends_on,
         c.whatsapp_group_link,
         coalesce(c.participant_signup_link, replace(s.participant_signup_link, '{circle_code}', left(c.id::text, 8))),
         coalesce(c.youtube_playlist_link, s.youtube_playlist_link),
         coalesce(c.drive_folder_link, s.drive_folder_link)
    from public.circles c
    join public.facilitators f on f.id = c.facilitator_id
    left join public.licences l on l.id = c.licence_id
    left join public.settings s on s.id = 1
   where f.email = lower(coalesce(auth.jwt() ->> 'email', ''))
   order by c.weekday, c.start_time;
$$;
revoke execute on function public.my_circles_v2() from public, anon;
grant execute on function public.my_circles_v2() to authenticated;
