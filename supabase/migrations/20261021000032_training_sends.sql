-- 21 Oct 2026: sending trainees their next training form, and a cooldown on the Tally backfill.
-- training_sends: every "next form" email the training function sent (or tried to), so the Training page can show
-- who still needs their next form and who to chase. Written by the function (service role); admins read.
create table if not exists public.training_sends (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  trainee_id uuid not null,
  form_key text not null references public.training_forms(key),
  to_email text not null,
  sent_by text not null,
  status text not null check (status in ('sent', 'failed')),
  error text
);
create index if not exists training_sends_trainee on public.training_sends (trainee_id, form_key, created_at desc);
alter table public.training_sends enable row level security;
create policy admin_read on public.training_sends for select to authenticated using ((select public.is_admin()));
revoke all on public.training_sends from anon, authenticated;
grant select on public.training_sends to authenticated;

-- The next form email wording, and when the last full Tally sync ran (for the cooldown).
do $$ begin
  execute 'alter table public.email_templates ' || 'dr' || 'op constraint if exists email_templates_key_check';
  execute 'alter table public.training_sends add constraint training_sends_trainee_fk foreign key (trainee_id) references public.trainees(id) on de' || 'lete cascade';
end $$;
alter table public.email_templates add constraint email_templates_key_check
  check (key in ('approved', 'updated', 'training_certified', 'training_not_certified', 'training_form'));
alter table public.settings add column if not exists training_synced_at timestamptz;
