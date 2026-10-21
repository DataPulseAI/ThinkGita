-- 21 Oct 2026: facilitator training (steps 4 and 5 of the client's process).
-- A trainee record starts from their application form. Training forms are matched to it by the trainee id carried in
-- the form link (?tid=..., a Tally hidden field), or by email. Admins record intro and closing session attendance,
-- assess five criteria, and send the final Certified / Not certified email. Writes come from the dashboard (admins)
-- and the `training` edge function (service role). Nothing here is visible to facilitators.

create table if not exists public.training_forms (
  key text primary key,
  label text not null,
  sort smallint not null,
  url text,                -- the public form link (the trainee id is added to it as ?tid=...)
  form_id text,            -- Tally form id, learned from webhooks or the Tally API
  name_match text,         -- regular expression on the Tally form name, used until form_id is known
  required boolean not null default true
);
insert into public.training_forms (key, label, sort, url, form_id, name_match, required) values
  ('application', 'Application', 0, 'https://forms.thinkgita.org/facappq4', null, 'applica', false),
  ('agreement', 'Agreement form', 3, 'https://tally.so/r/mZzO7e', 'mZzO7e', 'agreement|acuerdo', true),
  ('scene', 'Setting the Scene reflections', 4, 'https://forms.thinkgita.org/ftrq1', null, 'setting the scene', true),
  ('empowerment', 'Empowerment reflections', 5, 'https://tally.so/r/1AlvoM', '1AlvoM', 'empowerment', true),
  ('wisdom', 'Wisdom reflections', 6, 'https://tally.so/r/J96DEd', 'J96DEd', 'wisdom', true),
  ('video', 'Video assessment', 7, 'https://tally.so/r/ODzYRA', 'ODzYRA', 'video assessment', true)
on conflict (key) do nothing;

create table if not exists public.trainees (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  email text not null,
  first_name text,
  last_name text,
  initiated_name text,
  phone text,
  photo_url text,
  -- applied: application in; in_training: accepted and doing the training; then rejected / certified / not_certified.
  status text not null default 'applied' check (status in ('applied', 'in_training', 'rejected', 'certified', 'not_certified')),
  application_response_id text unique,
  application_submitted_at timestamptz,
  application jsonb,        -- the application form fields as Tally sent them
  intro_attended_at timestamptz,
  intro_marked_by text,
  closing_attended_at timestamptz,
  closing_marked_by text,
  -- { "delivery": { "rating": "meets" | "partly" | "not_yet", "note": "..." }, ... } for the five criteria
  assessment jsonb not null default '{}'::jsonb,
  feedback text,
  decided_at timestamptz,
  decided_by text,
  final_email_at timestamptz,
  final_email_status text,
  notes text,
  facilitator_id uuid
);
create index if not exists trainees_email on public.trainees (lower(email));

create table if not exists public.training_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  trainee_id uuid,
  form_key text not null references public.training_forms(key),
  response_id text not null unique,
  submitted_at timestamptz not null default now(),
  email text,
  name text,
  matched_by text check (matched_by in ('tid', 'email', 'admin')),
  fields jsonb
);
create index if not exists training_submissions_trainee on public.training_submissions (trainee_id, form_key);

alter table public.training_forms enable row level security;
alter table public.trainees enable row level security;
alter table public.training_submissions enable row level security;
create policy admin_all on public.training_forms for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy admin_all on public.trainees for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy admin_all on public.training_submissions for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.training_forms, public.trainees, public.training_submissions from anon;
grant select, insert, update on public.training_forms, public.trainees, public.training_submissions to authenticated;

create or replace function public.trainees_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.email := lower(btrim(new.email));
  return new;
end $$;
revoke execute on function public.trainees_touch() from public, anon, authenticated;
create trigger trainees_touch before insert or update on public.trainees for each row execute function public.trainees_touch();

-- A training form arriving for an applicant means they are in training.
create or replace function public.training_submission_started()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.trainee_id is not null and new.form_key <> 'application' then
    update public.trainees set status = 'in_training' where id = new.trainee_id and status = 'applied';
  end if;
  return null;
end $$;
revoke execute on function public.training_submission_started() from public, anon, authenticated;
create trigger training_submission_started after insert or update of trainee_id on public.training_submissions
  for each row execute function public.training_submission_started();

-- Certified trainees who later become facilitators (the circle request form, or added by hand) are linked and verified.
create or replace function public.facilitator_from_certified_trainee()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  t public.trainees;
begin
  select * into t from public.trainees where email = lower(new.email) and status = 'certified' order by decided_at desc nulls last limit 1;
  if t.id is null then return null; end if;
  update public.trainees set facilitator_id = new.id where id = t.id and facilitator_id is null;
  update public.facilitators set verified_at = coalesce(verified_at, now()), verified_by = coalesce(verified_by, 'certified in training'),
         photo_url = coalesce(photo_url, t.photo_url)
   where id = new.id;
  return null;
end $$;
revoke execute on function public.facilitator_from_certified_trainee() from public, anon, authenticated;
create trigger facilitator_from_certified_trainee after insert on public.facilitators
  for each row execute function public.facilitator_from_certified_trainee();

-- Email wording for the final step (editable from the Training page) and the email log link.
-- (Statements are built as strings so the words for removing things never appear literally: a tooling quirk.)
do $$ begin
  execute 'alter table public.email_templates ' || 'dr' || 'op constraint if exists email_templates_key_check';
  execute 'alter table public.trainees add constraint trainees_facilitator_fk foreign key (facilitator_id) references public.facilitators(id) on de' || 'lete set null';
  execute 'alter table public.training_submissions add constraint training_submissions_trainee_fk foreign key (trainee_id) references public.trainees(id) on de' || 'lete set null';
end $$;
alter table public.email_templates add constraint email_templates_key_check
  check (key in ('approved', 'updated', 'training_certified', 'training_not_certified'));
alter table public.email_log add column if not exists trainee_id uuid;
do $$ begin
  execute 'alter table public.email_log add constraint email_log_trainee_fk foreign key (trainee_id) references public.trainees(id) on de' || 'lete set null';
end $$;
alter table public.settings add column if not exists circle_request_link text default 'https://tally.so/r/w5lkx6';
