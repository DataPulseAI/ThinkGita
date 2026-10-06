-- Demo data: 10 placeholder licences + 52 demo circles (Wednesday 19:30 deliberately overbooked).
-- Already applied to the live project on 7 Oct 2026. Clear demo data with:
--   delete from public.circles where is_demo; delete from public.facilitators where email like 'demo%@example.org';

insert into public.licences (label, sort_order)
select 'Licence ' || lpad(i::text, 2, '0'), i from generate_series(1, 10) i
on conflict (label) do nothing;

insert into public.facilitators (name, email)
select 'Demo Facilitator ' || i, 'demo' || i || '@example.org' from generate_series(1, 52) i
on conflict (email) do nothing;

with slots(n, wd, t) as (values
 (1,1,'19:00'),(2,1,'19:30'),(3,1,'20:00'),(4,1,'19:00'),(5,1,'18:30'),(6,1,'20:30'),
 (7,2,'19:00'),(8,2,'19:00'),(9,2,'19:30'),(10,2,'20:00'),(11,2,'07:00'),(12,2,'20:00'),
 (13,3,'19:30'),(14,3,'19:30'),(15,3,'19:30'),(16,3,'19:30'),(17,3,'19:30'),(18,3,'19:30'),
 (19,3,'19:30'),(20,3,'19:30'),(21,3,'19:30'),(22,3,'19:30'),(23,3,'19:45'),(24,3,'20:00'),
 (25,4,'19:00'),(26,4,'19:00'),(27,4,'20:00'),(28,4,'20:30'),(29,4,'12:30'),(30,4,'19:30'),
 (31,5,'19:00'),(32,5,'19:30'),(33,5,'18:00'),
 (34,6,'09:00'),(35,6,'09:30'),(36,6,'10:00'),(37,6,'10:00'),(38,6,'11:00'),(39,6,'16:00'),(40,6,'17:00'),
 (41,7,'08:00'),(42,7,'09:00'),(43,7,'09:00'),(44,7,'10:00'),(45,7,'10:30'),(46,7,'11:00'),(47,7,'17:00'),(48,7,'18:00'),
 (49,1,'07:00'),(50,2,'21:00'),(51,4,'07:30'),(52,5,'20:00'))
insert into public.circles (name, facilitator_id, weekday, start_time, duration_min, is_demo, source)
select 'Demo Circle ' || lpad(s.n::text, 2, '0'), f.id, s.wd, s.t::time,
       case when s.n % 4 = 0 then 90 else 60 end, true, 'demo'
from slots s join public.facilitators f on f.email = 'demo' || s.n || '@example.org';

do $$
declare r record;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  for r in select id from public.circles where is_demo order by created_at, name loop
    perform public.allocate_circle(r.id);
  end loop;
end $$;
