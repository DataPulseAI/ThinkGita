-- Data check (warning): every active licence that hosts live circles has a host key.
-- Why: facilitators get the licence's host key in their portal (my_circles_v2) to claim host in the meeting.
-- Without it they cannot start the meeting unless they sign in as the licence owner. Mock licences are skipped.
-- Returns one row per licence missing a host key. Zero rows = pass.
select
  'active licence hosts live circles but has no host key' as problem,
  l.id as licence_id,
  l.label as licence_label,
  count(c.id) as live_circles
from public.licences l
join public.circles c on c.licence_id = l.id and c.status = 'live'
where l.active
  and not l.is_mock
  and nullif(trim(l.host_key), '') is null
group by l.id, l.label
order by l.label;
