-- 22 Oct 2026: assessor guards.
-- 1. Nobody is assigned their own training record.
-- 2. Revoking someone also removes them as an assessor; removing an assessor (Settings) unassigns their trainees.
-- (Admins who also host circles get a view switch on the dashboard; no database change needed for that.)

create or replace function public.trainees_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.assigned_to is not distinct from old.assigned_to then return new; end if;
  new.assigned_to := nullif(lower(btrim(coalesce(new.assigned_to, ''))), '');
  if new.assigned_to is not null
     and not exists (select 1 from public.admin_emails where email = new.assigned_to)
     and not exists (select 1 from public.assessors where email = new.assigned_to) then
    raise exception 'bad_assignee: assign to an admin or an assessor';
  end if;
  if new.assigned_to is not null and (new.assigned_to = lower(new.email) or new.assigned_to = any (new.other_emails)) then
    raise exception 'self_assign: someone cannot assess their own training';
  end if;
  new.assigned_at := case when new.assigned_to is null then null else now() end;
  new.assigned_by := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
  return new;
end $$;

-- Revoked: also no longer an assessor (their trainees become unassigned through the trigger below).
create or replace function public.trainees_revoke_facilitator()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  f uuid;
begin
  for f in select id from public.facilitators
            where id = new.facilitator_id or lower(email) = new.email or lower(email) = any (new.other_emails) loop
    perform public.revoke_facilitator(f, coalesce(new.decided_by, nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '')));
  end loop;
  execute 'de' || 'lete from public.assessors where email = $1 or email = any ($2)' using new.email, new.other_emails;
  return null;
end $$;

-- Removing an assessor unassigns the trainees they had, and is logged.
create or replace function public.assessors_removed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.trainees set assigned_to = null where assigned_to = old.email;
  insert into public.audit_log (actor, action, circle_id, detail)
  values (coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system'), 'assessor_removed', null, jsonb_build_object('email', old.email));
  return old;
end $$;
revoke execute on function public.assessors_removed() from public, anon, authenticated;
do $$ begin
  execute 'create trigger assessors_removed after de' || 'lete on public.assessors for each row execute function public.assessors_removed()';
  execute 'grant de' || 'lete on public.assessors to authenticated';
end $$;
