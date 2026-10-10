-- Schema check: columns and constraints added by later migrations are present.
-- Why: the dashboard and edge functions select these columns by name. If a migration was skipped on an
-- environment (a fresh branch, a restored backup) the app breaks at run time. This is a spot check of the
-- columns each later migration added, not a full schema diff.
-- Returns one row per missing column or constraint. Zero rows = pass.
with expected(schema_name, table_name, column_name) as (
  values
    -- 005 form fields and timezones, 008 slots, 011 auto names
    ('public', 'circles', 'ref_weekday'), ('public', 'circles', 'ref_start_time'),
    ('public', 'circles', 'alt_weekday'), ('public', 'circles', 'alt_start_time'),
    ('public', 'circles', 'preference_used'), ('public', 'circles', 'slots'),
    ('public', 'circles', 'uk_time_shifts'), ('public', 'circles', 'name_auto'),
    ('public', 'facilitators', 'first_name'), ('public', 'facilitators', 'initiated_name'),
    -- 006, 007, 009, 010, 012, 013, 014
    ('public', 'licences', 'is_mock'), ('public', 'licences', 'attendance_scanned_to'),
    ('public', 'change_requests', 'request_type'), ('public', 'change_requests', 'details'),
    ('public', 'circles', 'whatsapp_group_link'), ('public', 'settings', 'participant_signup_link'),
    ('public', 'admin_emails', 'name'), ('public', 'admin_emails', 'is_super'),
    ('public', 'attendance_sessions', 'licence_label'), ('public', 'settings', 'attendance_sync_lock'),
    -- 015, 017 email log
    ('public', 'email_log', 'status'), ('public', 'email_log', 'body_html'),
    -- 019 co-facilitators
    ('public', 'circle_cofacilitators', 'facilitator_id'),
    -- 020, 021, 022 website and Framer sync
    ('public', 'circles', 'website_visible'), ('public', 'circles', 'framer_item_id'),
    ('public', 'circles', 'framer_dirty'), ('public', 'circles', 'framer_error'),
    ('public', 'circles', 'framer_created'), ('public', 'settings', 'framer_auto_publish'),
    ('public', 'settings', 'framer_sync_lock'), ('public', 'settings', 'framer_publish_pending'),
    ('public', 'settings', 'framer_publish_attempts'), ('private', 'cron_secret', 'secret'),
    -- 023 website fields
    ('public', 'facilitators', 'photo_url'), ('public', 'circles', 'website_name'),
    ('public', 'circles', 'website_photo_url'), ('public', 'circles', 'website_order'),
    ('public', 'circles', 'framer_photo_src'), ('public', 'circles', 'framer_has'),
    ('public', 'circles', 'framer_rev'), ('public', 'settings', 'framer_fail_count'),
    ('public', 'settings', 'framer_failed_at'), ('public', 'settings', 'framer_last_error')
),
expected_constraints(table_name, constraint_name) as (
  values ('settings', 'term_order'), ('circles', 'circles_website_order_positive')
)
select 'required column is missing' as problem, e.schema_name, e.table_name, e.column_name as object_name
from expected e
where not exists (
  select 1 from information_schema.columns c
   where c.table_schema = e.schema_name and c.table_name = e.table_name and c.column_name = e.column_name)
union all
select 'required constraint is missing', 'public', ec.table_name, ec.constraint_name
from expected_constraints ec
where not exists (
  select 1 from pg_catalog.pg_constraint k
   where k.conname = ec.constraint_name and k.conrelid = ('public.' || ec.table_name)::regclass)
order by 2, 3, 4;
