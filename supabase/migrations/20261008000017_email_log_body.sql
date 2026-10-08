-- Keep the full email so admins can open exactly what was sent (admin-only, like the rest of the log).
alter table public.email_log
  add column if not exists from_address text,
  add column if not exists reply_to text,
  add column if not exists body_html text,
  add column if not exists body_text text;
