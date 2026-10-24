-- 23 Oct 2026: assessors submit their assessment, with a recommendation, for admins to decide.
-- Saving stays a draft the assessor can change. Submitting records a recommendation (certify / not yet) and locks the
-- assessment for the assessor; admins see it waiting for their decision in the dashboard (no email). An admin can reopen it.
-- Admins still record the outcome (Certified, Not certified, Cancelled, Revoked).

alter table public.trainees add column if not exists recommendation text check (recommendation in ('certify', 'not_yet'));
alter table public.trainees add column if not exists assessment_submitted_at timestamptz;
alter table public.trainees add column if not exists assessment_submitted_by text;

-- Draft save: unchanged for admins; an assessor can't change a submitted assessment.
create or replace function public.save_assessment(p_trainee uuid, p_assessment jsonb, p_feedback text)
returns public.trainees language plpgsql security definer set search_path = '' as $$
declare
  who text := lower(coalesce(auth.jwt() ->> 'email', ''));
  r public.trainees;
begin
  if not public.can_assess(p_trainee, who) then raise exception 'not_allowed: this trainee is not assigned to you'; end if;
  if jsonb_typeof(coalesce(p_assessment, '{}'::jsonb)) <> 'object' then raise exception 'bad_assessment'; end if;
  if not public.is_admin() and exists (select 1 from public.trainees where id = p_trainee and assessment_submitted_at is not null) then
    raise exception 'submitted: this assessment has been sent to the admins; ask an admin to reopen it';
  end if;
  update public.trainees set assessment = coalesce(p_assessment, '{}'::jsonb), feedback = p_feedback where id = p_trainee returning * into r;
  insert into public.audit_log (actor, action, circle_id, detail)
  values (who, 'training_assessed', null, jsonb_build_object('trainee_id', r.id, 'email', r.email));
  return r;
end $$;

-- Submit: saves the assessment and the recommendation, and marks it as sent to the admins.
create or replace function public.submit_assessment(p_trainee uuid, p_assessment jsonb, p_feedback text, p_recommendation text)
returns public.trainees language plpgsql security definer set search_path = '' as $$
declare
  who text := lower(coalesce(auth.jwt() ->> 'email', ''));
  r public.trainees;
begin
  if not public.can_assess(p_trainee, who) then raise exception 'not_allowed: this trainee is not assigned to you'; end if;
  if p_recommendation is null or p_recommendation not in ('certify', 'not_yet') then
    raise exception 'no_recommendation: choose Recommend certifying or Not yet';
  end if;
  if jsonb_typeof(coalesce(p_assessment, '{}'::jsonb)) <> 'object' then raise exception 'bad_assessment'; end if;
  if exists (select 1 from public.trainees where id = p_trainee and assessment_submitted_at is not null) then
    raise exception 'submitted: this assessment has already been sent to the admins';
  end if;
  update public.trainees
     set assessment = coalesce(p_assessment, '{}'::jsonb), feedback = p_feedback, recommendation = p_recommendation,
         assessment_submitted_at = now(), assessment_submitted_by = who
   where id = p_trainee returning * into r;
  insert into public.audit_log (actor, action, circle_id, detail)
  values (who, 'training_assessment_submitted', null, jsonb_build_object('trainee_id', r.id, 'email', r.email, 'recommendation', p_recommendation));
  return r;
end $$;
revoke execute on function public.submit_assessment(uuid, jsonb, text, text) from public, anon;
grant execute on function public.submit_assessment(uuid, jsonb, text, text) to authenticated;

-- Reopen (admins): the assessor can edit and submit again. The previous recommendation stays visible until then.
create or replace function public.reopen_assessment(p_trainee uuid)
returns public.trainees language plpgsql security definer set search_path = '' as $$
declare
  who text := lower(coalesce(auth.jwt() ->> 'email', ''));
  r public.trainees;
begin
  if not public.is_admin() then raise exception 'not_admin: only admins can reopen an assessment'; end if;
  update public.trainees set assessment_submitted_at = null, assessment_submitted_by = null
   where id = p_trainee returning * into r;
  if r.id is null then raise exception 'not_found: no such trainee'; end if;
  insert into public.audit_log (actor, action, circle_id, detail)
  values (who, 'training_assessment_reopened', null, jsonb_build_object('trainee_id', r.id, 'email', r.email));
  return r;
end $$;
revoke execute on function public.reopen_assessment(uuid) from public, anon;
grant execute on function public.reopen_assessment(uuid) to authenticated;
