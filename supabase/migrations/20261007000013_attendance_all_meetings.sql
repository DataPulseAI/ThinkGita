-- Attendance for every past Zoom meeting on every licence account, not just circles made by this system.
alter table public.attendance_sessions
  add column if not exists topic text,
  add column if not exists licence_label text,
  add column if not exists host_email text;

-- How far each account's past meetings have been scanned, so later syncs only look at recent weeks.
alter table public.licences add column if not exists attendance_scanned_to date;
