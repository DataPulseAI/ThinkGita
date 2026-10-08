# ThinkGita Circles

Automates weekly online circles: facilitators submit a Tally form, the system assigns one of the Zoom licences without clashes, creates a weekly recurring Zoom meeting after an admin approves it, and gives the facilitator their link and host key.

```
Tally form ──webhook──▶ tally-intake (edge function) ──▶ circles table ──▶ allocate_circle()
                                                                              │
Admin dashboard (GitHub Pages) ── Approve ──▶ provision-circle ──▶ Zoom API (recurring meeting)
                                                     └─▶ facilitator invite + details email
```

## What's in the repo

| Path | What it is |
| --- | --- |
| `app/` | Dashboard (Vite + React). Admin view and facilitator portal, same login. |
| `supabase/migrations/` | Schema, clash constraint, allocator, row-level security. Already applied to the live project. |
| `supabase/functions/tally-intake` | Tally webhook receiver. Checks the Tally signature. |
| `supabase/functions/provision-circle` | Admin-only: create or delete Zoom meetings, resend emails, check licences with Zoom. |
| `supabase/seed_demo.sql` | 52 demo circles for testing (already loaded; clear them from Settings). |
| `.github/workflows/deploy.yml` | Builds `app/` and deploys to GitHub Pages on every push to `main`. |

Supabase project: `rxvehsmunykipwevtpmb`.

## How allocation works

- Each circle takes a weekly slot: day, start time, length, plus a buffer (default 15 minutes) so overruns don't collide.
- The allocator gives it the first active licence that is free for that slot. If none is free the circle is marked **No licence free** and the dashboard suggests the nearest free start times.
- A database constraint makes double-booking a licence impossible, even if two forms arrive at once.
- Live circles are never moved automatically. Changing a live circle's day or time moves its Zoom meeting (same link). "Move to another licence" creates a new meeting on the new licence (new link, facilitator emailed).
- A circle occupies every UK time it will have across its run, so clock-change weeks (US, Australia) and Sunday-night/Monday-morning overlaps are checked too.
- When capacity frees up (a circle ends, is rejected, deleted or moved, or a licence is added), clashes are re-checked automatically.
- Finished circles (past their end date) are closed every night at 02:15 UTC and release their licence.

## Roles

- **Admins**: anyone whose email is in Settings → Admins. Full dashboard.
- **Facilitators**: invited automatically when their circle is approved. They only see their own circles (link, meeting ID, passcode, host key) and can send a change request.
- Login is a magic link by email. Public sign-up is off; people must be invited.

## Setup checklist

1. **Push and publish**
   - `git push` this repo.
   - GitHub → Settings → Pages → Source: **GitHub Actions**. Pages on a private repo needs a paid GitHub plan; otherwise make the repo public (no secrets live in the code).
   - The site will be at `https://datapulseai.github.io/ThinkGita/`.
2. **Supabase Auth** (Dashboard → Authentication)
   - URL Configuration: set Site URL and add a Redirect URL for the Pages address above.
   - Sign In / Providers: turn **off** "Allow new users to sign up".
   - Emails → SMTP: add a custom SMTP sender using the team Gmail account: host `smtp.gmail.com`, port `465`, username = the Gmail address, password = the same Gmail app password as `GMAIL_APP_PASSWORD`, sender email = the Gmail address, sender name `Think Gita Circles`. The built-in sender only emails project team members and is heavily rate-limited, so facilitator and admin invites won't arrive without this.
   - How facilitators sign in: approving a circle emails them an invite. The invite link signs them in and asks them to choose a password. Later they sign in with email and password, or use "Forgot or never set a password?" on the sign-in page.
   - Users → Invite user: invite yourself (the admin email already in the `admin_emails` table) so you can sign in.
   - New project only: add the first admin in the SQL editor with `insert into public.admin_emails (email) values ('<your-admin-email>');`
3. **Zoom** (signed in to ThinkGita's Zoom account as the owner or an admin)
   - [marketplace.zoom.us](https://marketplace.zoom.us) → Develop → Build App → **Server-to-Server OAuth App**. Name it "ThinkGita Circles".
   - Scopes (Add Scopes):
     - Meeting: `meeting:write:meeting:admin` (create), `meeting:update:meeting:admin` (change time, title or end date), `meeting:delete:meeting:admin` (cancel), `meeting:read:meeting:admin`, `meeting:read:list_meetings:admin` (the Zoom meetings list on Licences).
     - Report (Attendance tab, paid plan): `report:read:user:admin` (past meetings per account) and `report:read:list_meeting_participants:admin` (who joined). The first sync back-fills the last six months, which is as far back as Zoom keeps reports.
     - User: `user:read:list_users:admin` (Sync from Zoom lists the account's users), `user:read:user:admin` and `user:update:user:admin` (Set key gives a licence a new host key; Zoom no longer reveals existing ones).
     - Older Zoom accounts show classic scopes instead: `meeting:write:admin`, `meeting:read:admin`, `user:read:admin`.
   - Fill in the required Information page (name, contact email), then **Activate**. The app only works once activated.
   - Copy Account ID, Client ID and Client Secret straight into Supabase secrets (step 4). Don't paste them in chat or email.
   - Each licence must be a **Licensed** user in this same Zoom account. Their email goes in the dashboard's Licences page.
   - Account settings → Meeting: allow "Join before host" (meetings are set up so participants can join first).
4. **Edge function secrets** (Dashboard → Edge Functions → Secrets)

   | Secret | Value |
   | --- | --- |
   | `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` | From the Zoom app |
   | `TALLY_SIGNING_SECRET` | A long random string, e.g. from `openssl rand -base64 32`. The same value goes into Tally |
   | `TALLY_FORM_ID` | `w5lkx6` (the id at the end of the form link). Submissions from any other form are ignored |
   | `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Facilitator details emails are sent from this Gmail account (Google Account → Security → 2-Step Verification → App passwords). Optional `EMAIL_FROM_NAME` (default `Think Gita Circles`). Replies go to the support contact set under Setup, Emails |
   | `APP_URL` | `https://datapulseai.github.io/ThinkGita/` |

5. **Tally** (in the Tally account that owns the form, form `w5lkx6` only)
   - Open the form → **Integrations** → **Webhooks** → Connect.
   - Endpoint URL: `https://rxvehsmunykipwevtpmb.supabase.co/functions/v1/tally-intake`
   - Signing secret: the `TALLY_SIGNING_SECRET` value. Leave HTTP headers empty.
   - Tally webhooks belong to a single form, so other forms in that account send nothing. `TALLY_FORM_ID` is a second safety check.
   - Fields are found by label: First Name, Last Name, Initiated Name, Email Address, Phone Number, "Do you wish to facilitate a", Day + Time (twice: first then second preference), Time Zone, Language, Preferred Start Date. Renaming those labels can break intake; adding new questions is fine.
   - Submissions that can't be read (no email, unreadable day or time) show up in Settings → Activity as `intake_failed`. Tally's webhook page also shows each delivery and its response.
   - Rotate the Tally API key that was shared in chat. The webhook doesn't need it.
6. **Dashboard**
   - Licences: click **Sync from Zoom**. Every licensed user in the Zoom account becomes a licence (labels are kept). Then click **Set key** on each licence that will host circles: it sets a new random host key in Zoom and saves it. Untick Active on any user who shouldn't host circles, such as shared staff accounts.
   - Settings: set term start and end dates (meetings repeat weekly between them, max 50 weeks), confirm buffer and default length, add Niraj and team as admins (then invite them in Supabase Auth).
7. **Test end to end, then clear demo data**
   - Submit the Tally form with your own details, approve it in Queue, check the Zoom meeting and email arrive, sign in as that email to see the facilitator view.
   - Settings → Clear demo data.

## Form, timezones and testing

- **Tally form fields** used: first/last/initiated name, email, phone, "Do you wish to facilitate a" (circle type), first and second preference day and time, time zone, language, preferred start date. The two "Day"/"Time" pairs are told apart by "first"/"second" in the label if present, otherwise by their order in the form.
- **Second preference**: if the first choice has no free licence, the second is tried automatically. The circle shows a "2nd preference" tag.
- **Timezones**: Tally's "(GMT +x) City" options are mapped to real timezones (e.g. London to Europe/London) so clock changes are handled. Circles store the facilitator's own time (used for Zoom) and a UK reference time (used for clash checks and admin views).
- **Mock licences** (testing only): tick Mock on a licence and approving a circle on it creates fake Zoom details instead of calling Zoom. The Overview "Before going live" checklist reminds you to turn this off.
- **Theme**: light by default, with a dark mode toggle in the header (remembered per browser).

## Facilitator emails

- Edited in the dashboard's **Emails** tab: the approval email, and a "details changed" email sent when a live circle's time or licence changes. Plain text with `{{placeholders}}`; click a placeholder to insert it. Lines in CAPITALS become headings and links become clickable. The preview uses a real circle, and **Send test to me** emails the current draft to you.
- Shared links (Google Drive folder, support contact, optional default YouTube playlist) are set at the top of the Emails tab.
- **Approving asks for the circle's WhatsApp group link and YouTube playlist**, since those are created per circle at that point. Anything still blank is sent as "to follow".
- Emails are signed by the admin who sends them: set your name under Settings → Admins (the approve dialog also asks the first time).
- Facilitators get the licence **host key**, never the licence password: they join with the meeting link and use Claim host.
- The renderer lives in `app/src/emailTemplate.js` and is copied to `supabase/functions/provision-circle/template.ts`, so the preview and the sent email match. Edit the app file, then copy it over.

## Local development

```
cd app
npm install
npm run dev
```

The app uses the project's publishable key (`app/src/config.js`), which is safe in a browser. All access control is in row-level security and the edge functions.

## Not built yet (deliberately)

"Not attended recently" alerts, email nudges, 6 and 9 week feedback forms, CRM sync. The schema leaves room for these after January.
