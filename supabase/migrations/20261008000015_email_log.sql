-- One row per email the dashboard sends (or tries to), shown under Setup, Sent emails.
create table if not exists public.email_log (
  id uuid primary key default gen_random_uuid(),
  sent_at timestamptz not null default now(),
  kind text not null,                       -- approved | updated | test
  to_email text,
  subject text,
  circle_id uuid references public.circles(id) on delete set null,
  circle_name text,
  sent_by text,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  error text,
  message_id text
);
create index if not exists email_log_sent_at on public.email_log (sent_at desc);
create index if not exists email_log_circle on public.email_log (circle_id, sent_at desc);
alter table public.email_log enable row level security;
create policy admin_read on public.email_log for select to authenticated using ((select public.is_admin()));
grant select on public.email_log to authenticated;
-- Writes come only from the provision-circle function (service role).
