-- The admin who approves (or resends) a circle signs the facilitator email with their name.
alter table public.admin_emails add column if not exists name text;
grant update on public.admin_emails to authenticated;

-- Shared email links for ThinkGita.
update public.settings
   set drive_folder_link = 'https://drive.google.com/drive/folders/1fGerpSZncjR0mxzE_zY9at4vPlsp9CUC?usp=sharing',
       support_contact = 'circles@thinkgita.org'
 where id = 1;
-- Email templates were switched to the host key (no licence password) and the sign-up link removed;
-- see DEFAULT_TEMPLATES in app/src/emailTemplate.js for the current wording.
