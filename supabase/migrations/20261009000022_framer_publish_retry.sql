-- 9 Oct 2026: website publishing that survives failures.
-- CMS edits and publishing are tracked separately. A failed publish (e.g. Framer "Publishing is currently unavailable"
-- while a previous deploy is still running) leaves framer_publish_pending on, and a cron tick retries it.
-- The same tick also picks up circles changed outside the dashboard (nightly close_finished, edge functions).
create extension if not exists pg_net with schema extensions;

alter table public.settings
  add column if not exists framer_publish_pending boolean not null default false,
  add column if not exists framer_publish_error text,
  add column if not exists framer_published_at timestamptz,
  add column if not exists framer_publish_tried_at timestamptz,
  add column if not exists framer_publish_attempts int not null default 0;
comment on column public.settings.framer_publish_pending is 'CMS has changes to published items that are not live yet; framer-sync retries the publish.';

-- Shared secret between the cron tick and framer-sync. Lives in a schema the API does not expose.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.cron_secret (
  id int primary key default 1 check (id = 1),
  secret text not null default encode(extensions.gen_random_bytes(24), 'hex')
);
insert into private.cron_secret (id) values (1) on conflict do nothing;

create or replace function public.framer_cron_ok(s text)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (select 1 from private.cron_secret where secret = s);
$$;
revoke execute on function public.framer_cron_ok(text) from public, anon, authenticated;
grant execute on function public.framer_cron_ok(text) to service_role;

-- Every 2 minutes: call framer-sync only when there is something to do.
-- Publish retries back off: attempt n waits about 2^n minutes (capped at 30).
create or replace function public.framer_sync_tick()
returns void language plpgsql security definer set search_path = '' as $$
declare
  st public.settings;
  due boolean;
begin
  select * into st from public.settings where id = 1;
  if st.framer_sync_lock is not null and st.framer_sync_lock > now() - interval '3 minutes' then return; end if;
  -- Dirty circles: always; ones whose last push failed: once an hour.
  due := exists (select 1 from public.circles where framer_dirty and (framer_error is null or extract(minute from now()) < 2))
      or (st.framer_publish_pending and st.framer_auto_publish
          and coalesce(st.framer_publish_tried_at, '-infinity') < now() - make_interval(mins => least(30, power(2, least(st.framer_publish_attempts, 5))::int)));
  if not due then return; end if;
  perform net.http_post(
    url := 'https://rxvehsmunykipwevtpmb.supabase.co/functions/v1/framer-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select secret from private.cron_secret where id = 1)),
    body := '{"action":"sync"}'::jsonb,
    timeout_milliseconds := 140000
  );
end $$;
revoke execute on function public.framer_sync_tick() from public, anon, authenticated;

select cron.schedule('framer-sync-tick', '*/2 * * * *', 'select public.framer_sync_tick()');
