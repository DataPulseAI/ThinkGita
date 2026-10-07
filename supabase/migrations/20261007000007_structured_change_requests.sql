-- Facilitator change requests now carry a type and structured details so admins can apply them in one click.
alter table public.change_requests
  add column if not exists request_type text not null default 'other'
    check (request_type in ('change_time', 'change_start', 'pause', 'handover', 'stop', 'other')),
  add column if not exists details jsonb not null default '{}'::jsonb;
comment on column public.change_requests.details is 'Structured request fields, e.g. {"weekday":4,"start_time":"18:00","from":"2027-02-01"}';
