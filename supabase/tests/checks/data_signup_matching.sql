-- Read-only: how circle sign-ups are being matched, to tune the matching in the signups function.
-- Paste into the SQL editor and copy the single JSON cell back.
select jsonb_pretty(jsonb_build_object(
  'by_method', (select jsonb_object_agg(coalesce(match_method, 'waiting'), n) from
      (select match_method, count(*) n from public.circle_signups group by 1) x),
  'by_form', (select jsonb_object_agg(form_id, n) from (select form_id, count(*) n from public.circle_signups group by 1) x),
  'no_utm', (select count(*) from public.circle_signups where utm = '{}'::jsonb),
  'utm_keys', (select jsonb_object_agg(k, n) from (select k, count(*) n from public.circle_signups, jsonb_object_keys(utm) k group by 1) x),
  'top_notes', (select jsonb_agg(jsonb_build_object('note', match_note, 'n', n)) from
      (select match_note, count(*) n from public.circle_signups where circle_id is null and match_method is null group by 1 order by 2 desc limit 15) x),
  'waiting_samples', (select jsonb_agg(jsonb_build_object('utm', utm, 'note', match_note, 'at', submitted_at::date)) from
      (select utm, match_note, submitted_at from public.circle_signups where circle_id is null and match_method is null order by random() limit 25) x),
  'answer_labels_without_utm', (select jsonb_agg(distinct a ->> 'label') from public.circle_signups s, jsonb_array_elements(s.answers) a
      where s.utm = '{}'::jsonb),
  'circles', (select jsonb_build_object(
      'matchable', count(*) filter (where status in ('approved','live','paused','ended') and not is_demo),
      'with_whatsapp', count(*) filter (where status in ('approved','live','paused','ended') and not is_demo and whatsapp_group_link is not null),
      'with_starts_on', count(*) filter (where status in ('approved','live','paused','ended') and not is_demo and starts_on is not null),
      'with_facilitator', count(*) filter (where status in ('approved','live','paused','ended') and not is_demo and facilitator_id is not null))
    from public.circles),
  'circle_names', (select jsonb_agg(name || ' [' || status || ']' order by name) from public.circles where status in ('approved','live','paused','ended') and not is_demo)
)) as report;
