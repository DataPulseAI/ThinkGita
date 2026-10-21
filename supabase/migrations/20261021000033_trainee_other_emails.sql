-- 21 Oct 2026: other emails a trainee uses. When an admin links a "Needs matching" form to a trainee, the form's email
-- is added here, so every other form from that email (now and later) is matched to the same trainee.
alter table public.trainees add column if not exists other_emails text[] not null default '{}';
create index if not exists trainees_other_emails on public.trainees using gin (other_emails);
