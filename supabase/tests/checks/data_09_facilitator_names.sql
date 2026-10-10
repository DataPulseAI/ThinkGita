-- Data check (warning): facilitator names are names, not email addresses.
-- Why: the name appears in the automatic circle name, the website card and emails. Tally submissions with a blank
-- name, or quick manual entries, sometimes fall back to the email address. Only ids are returned, not the
-- addresses, so the check output carries no personal data.
-- Returns one row per facilitator whose name looks like an email or is blank. Zero rows = pass.
select
  case when nullif(trim(f.name), '') is null then 'facilitator name is blank'
       else 'facilitator name looks like an email address' end as problem,
  f.id as facilitator_id
from public.facilitators f
where nullif(trim(f.name), '') is null
   or f.name ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   or f.name ilike '%@%.%'
order by f.id;
