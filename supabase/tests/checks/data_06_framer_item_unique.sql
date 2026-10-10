-- Data check (warning): no two circles point at the same Framer CMS item.
-- Why: framer-sync writes each circle into its item. Two circles sharing an item overwrite each other's website
-- listing on every sync, and deleting one would delete the other's listing.
-- Returns one row per circle that shares a framer_item_id. Zero rows = pass.
select
  'framer_item_id is used by more than one circle' as problem,
  c.framer_item_id,
  c.id as circle_id,
  c.name as circle_name,
  c.status::text as status
from public.circles c
where c.framer_item_id in (
  select framer_item_id from public.circles
   where framer_item_id is not null
   group by framer_item_id
  having count(*) > 1)
order by c.framer_item_id, c.name;
