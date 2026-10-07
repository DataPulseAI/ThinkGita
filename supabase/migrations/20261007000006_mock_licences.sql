-- Testing only: a mock licence fakes Zoom meetings so the full flow can be tested without Zoom details.
alter table public.licences add column if not exists is_mock boolean not null default false;
comment on column public.licences.is_mock is 'Testing only: approving a circle on this licence fakes the Zoom meeting instead of calling Zoom.';
