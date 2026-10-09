-- 9 Oct 2026: per-circle "show on website" switch (dashboard toggle in the circle panel).
-- false = hidden (Framer CMS item kept as draft); true = shown. Everything starts hidden.
-- The Framer CMS sync (see project doc framer-cms.md) reads this column; it is not wired up yet.
alter table public.circles add column if not exists website_visible boolean not null default false;
comment on column public.circles.website_visible is 'Show this circle on the ThinkGita website (Framer CMS). false = draft/hidden.';
update public.circles set website_visible = false where website_visible;
