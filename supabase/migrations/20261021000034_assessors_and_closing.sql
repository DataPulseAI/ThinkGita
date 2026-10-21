-- 21 Oct 2026: candidate assessors, trainee assignment, and two more outcomes (cancelled, revoked).
--
-- Assessors are invited by admins (Settings). They only see the trainees assigned to them (their answers, videos and
-- assessment), and can save the assessment and feedback. Admins (and super admins) assign each trainee to an admin or an
-- assessor, and still make the final decision.
-- Cancelled: training stopped, nothing against them. Revoked: permanent. A revoked person's future applications are
-- marked revoked on arrival, and if they are a facilitator they are unverified, can't be verified again, and their
-- circles come off the website (circles keep running until an admin ends them).

create table if not exists public.assessors (
  email text primary key check (email = lower(btrim(email)) and email like '%@%'),
  name text,
  created_at timestamptz not null default now(),
  created_by text
);
alter table public.assessors enable row level security;
create policy admin_all on public.assessors for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy own_row on public.assessors for select to authenticated using (email = lower(coalesce(auth.jwt() ->> 'email', '')));
revoke all on public.assessors from anon;
grant select, insert, update on public.assessors to authenticated;

create or replace function public.is_assessor()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.assessors where email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
revoke execute on function public.is_assessor() from public, anon;
grant execute on function public.is_assessor() to authenticated;

-- Assignment and the new outcomes.
alter table public.trainees add column if not exists assigned_to text;
alter table public.trainees add column if not exists assigned_at timestamptz;
alter table public.trainees add column if not exists assigned_by text;
create index if not exists trainees_assigned_to on public.trainees (assigned_to);
alter table public.facilitators add column if not exists revoked_at timestamptz;
do $$ begin
  execute 'alter table public.trainees ' || 'dr' || 'op constraint if exists trainees_status_check';
  execute 'alter table public.email_templates ' || 'dr' || 'op constraint if exists email_templates_key_check';
end $$;
alter table public.trainees add constraint trainees_status_check
  check (status in ('applied', 'in_training', 'rejected', 'certified', 'not_certified', 'cancelled', 'revoked'));
alter table public.email_templates add constraint email_templates_key_check
  check (key in ('approved', 'updated', 'training_certified', 'training_not_certified', 'training_form', 'training_cancelled', 'training_revoked'));

-- Assessors read their assigned trainees and those trainees' forms.
create policy assessor_read on public.trainees for select to authenticated
  using (assigned_to = lower(coalesce(auth.jwt() ->> 'email', '')) and (select public.is_assessor()));
create policy assessor_read on public.training_submissions for select to authenticated
  using ((select public.is_assessor()) and exists (
    select 1 from public.trainees t where t.id = trainee_id and t.assigned_to = lower(coalesce(auth.jwt() ->> 'email', ''))));
create policy assessor_read on public.training_forms for select to authenticated using ((select public.is_assessor()));

-- Who can look at a trainee: an admin, or the assessor they are assigned to. Used by the training function too.
create or replace function public.can_assess(p_trainee uuid, p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_emails where email = lower(p_email))
      or exists (select 1 from public.trainees t join public.assessors a on a.email = t.assigned_to
                  where t.id = p_trainee and t.assigned_to = lower(p_email));
$$;
revoke execute on function public.can_assess(uuid, text) from public, anon, authenticated;

-- The assessor (or an admin) saves the assessment and feedback. Nothing else changes.
create or replace function public.save_assessment(p_trainee uuid, p_assessment jsonb, p_feedback text)
returns public.trainees language plpgsql security definer set search_path = '' as $$
declare
  who text := lower(coalesce(auth.jwt() ->> 'email', ''));
  r public.trainees;
begin
  if not public.can_assess(p_trainee, who) then raise exception 'not_allowed: this trainee is not assigned to you'; end if;
  if jsonb_typeof(coalesce(p_assessment, '{}'::jsonb)) <> 'object' then raise exception 'bad_assessment'; end if;
  update public.trainees set assessment = coalesce(p_assessment, '{}'::jsonb), feedback = p_feedback where id = p_trainee returning * into r;
  insert into public.audit_log (actor, action, circle_id, detail)
  values (who, 'training_assessed', null, jsonb_build_object('trainee_id', r.id, 'email', r.email));
  return r;
end $$;
revoke execute on function public.save_assessment(uuid, jsonb, text) from public, anon;
grant execute on function public.save_assessment(uuid, jsonb, text) to authenticated;

-- Admins assign: only to an admin or an assessor (or nobody). Lowercased, stamped.
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
  new.assigned_at := case when new.assigned_to is null then null else now() end;
  new.assigned_by := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
  return new;
end $$;
revoke execute on function public.trainees_assignment() from public, anon, authenticated;
create trigger trainees_assignment before update of assigned_to on public.trainees
  for each row execute function public.trainees_assignment();

-- Revoked people stay revoked: a new trainee row with a revoked person's email (main or other email, or a revoked
-- facilitator) starts as revoked.
create or replace function public.trainees_revoked_on_arrival()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.trainees t where t.status = 'revoked' and t.id <> new.id
               and (t.email = lower(new.email) or lower(new.email) = any (t.other_emails)))
     or exists (select 1 from public.facilitators f where f.revoked_at is not null and lower(f.email) = lower(new.email)) then
    new.status := 'revoked';
    new.notes := concat_ws(E'\n', nullif(new.notes, ''), 'Marked revoked on arrival: this person was revoked before.');
  end if;
  return new;
end $$;
revoke execute on function public.trainees_revoked_on_arrival() from public, anon, authenticated;
create trigger trainees_revoked_on_arrival before insert on public.trainees
  for each row execute function public.trainees_revoked_on_arrival();

-- Revoking a trainee who is (or becomes) a facilitator: unverify them for good and take their circles off the website.
create or replace function public.revoke_facilitator(p_facilitator uuid, p_by text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.facilitators set revoked_at = coalesce(revoked_at, now()), verified_at = null, verified_by = null where id = p_facilitator;
  update public.circles set website_visible = false
   where website_visible and (facilitator_id = p_facilitator
      or id in (select circle_id from public.circle_cofacilitators where facilitator_id = p_facilitator));
  insert into public.audit_log (actor, action, circle_id, detail)
  values (coalesce(p_by, 'system'), 'facilitator_revoked', null, jsonb_build_object('facilitator_id', p_facilitator));
end $$;
revoke execute on function public.revoke_facilitator(uuid, text) from public, anon, authenticated;

create or replace function public.trainees_revoke_facilitator()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  f uuid;
begin
  for f in select id from public.facilitators
            where id = new.facilitator_id or lower(email) = new.email or lower(email) = any (new.other_emails) loop
    perform public.revoke_facilitator(f, coalesce(new.decided_by, nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '')));
  end loop;
  return null;
end $$;
revoke execute on function public.trainees_revoke_facilitator() from public, anon, authenticated;
create trigger trainees_revoke_facilitator after insert or update of status on public.trainees
  for each row when (new.status = 'revoked') execute function public.trainees_revoke_facilitator();

-- A facilitator added later with a revoked person's email is revoked straight away.
create or replace function public.facilitators_revoked_on_arrival()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.trainees t where t.status = 'revoked'
               and (t.email = lower(new.email) or lower(new.email) = any (t.other_emails))) then
    new.revoked_at := now();
    new.verified_at := null;
    new.verified_by := null;
  end if;
  return new;
end $$;
revoke execute on function public.facilitators_revoked_on_arrival() from public, anon, authenticated;
create trigger facilitators_revoked_on_arrival before insert on public.facilitators
  for each row execute function public.facilitators_revoked_on_arrival();

-- Revoked facilitators are never verified again (approval, joining a running circle, a certified training, or by hand).
create or replace function public.facilitators_keep_revoked()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.revoked_at is not null and new.revoked_at is not null and new.verified_at is not null then
    new.verified_at := null;
    new.verified_by := null;
  end if;
  return new;
end $$;
revoke execute on function public.facilitators_keep_revoked() from public, anon, authenticated;
create trigger facilitators_keep_revoked before update of verified_at on public.facilitators
  for each row execute function public.facilitators_keep_revoked();

-- And their circles can't go back on the website.
create or replace function public.circles_website_not_revoked()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.website_visible and not coalesce(old.website_visible, false)
     and exists (select 1 from public.facilitators f where f.revoked_at is not null
                  and (f.id = new.facilitator_id
                       or f.id in (select facilitator_id from public.circle_cofacilitators where circle_id = new.id))) then
    raise exception 'facilitator_revoked: a facilitator on this circle has been revoked';
  end if;
  return new;
end $$;
revoke execute on function public.circles_website_not_revoked() from public, anon, authenticated;
create trigger circles_website_not_revoked before insert or update of website_visible on public.circles
  for each row execute function public.circles_website_not_revoked();
