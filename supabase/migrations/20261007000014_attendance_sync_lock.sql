-- Only one attendance sync at a time (several open tabs would otherwise race each other).
alter table public.settings add column if not exists attendance_sync_lock timestamptz;
comment on column public.settings.attendance_sync_lock is 'Set while an attendance sync runs, so only one runs at a time. Expires after 3 minutes.';
