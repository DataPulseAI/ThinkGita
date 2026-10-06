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
- Live circles are never moved automatically. To change a live circle's time, end it and add it again.

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
   - Emails → SMTP: add a custom SMTP sender (Resend works). The built-in sender only emails project team members and is heavily rate-limited, so facilitator invites won't arrive without this.
   - Users → Invite user: invite yourself (the admin email already in the `admin_emails` table) so you can sign in.
   - New project only: add the first admin in the SQL editor with `insert into public.admin_emails (email) values ('<your-admin-email>');`
3. **Zoom** (in ThinkGita's Zoom account, as an admin)
   - Zoom App Marketplace → Develop → Build app → **Server-to-Server OAuth**.
   - Scopes: create, read and delete meetings for users in the account, and read users.
   - Copy Account ID, Client ID, Client Secret.
   - Account settings: allow "Join before host" and make sure every licensed user has a host key.
4. **Edge function secrets** (Dashboard → Edge Functions → Secrets)

   | Secret | Value |
   | --- | --- |
   | `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` | From the Zoom app |
   | `TALLY_SIGNING_SECRET` | Any long random string; the same value goes into Tally |
   | `RESEND_API_KEY`, `EMAIL_FROM` | For the facilitator details email, e.g. `ThinkGita <circles@yourdomain>` |
   | `APP_URL` | The GitHub Pages address |

5. **Tally**
   - Form → Integrations → Webhooks → URL `https://rxvehsmunykipwevtpmb.supabase.co/functions/v1/tally-intake`, signing secret = `TALLY_SIGNING_SECRET`.
   - The webhook finds fields by their labels. Keep labels containing: **circle name**, **your name**, **email**, **phone** or **WhatsApp**, **day**, **time**, and optionally **duration** and **timezone**. Days can be "Wednesday", "Wed" etc. Times like "19:30" or "7:30pm" both work.
   - Submissions that can't be read (no email, unreadable day or time) show up in Settings → Activity as `intake_failed`.
   - Rotate the Tally API key that was shared in chat. The webhook doesn't need it.
6. **Dashboard**
   - Licences: enter each licensed Zoom user's email and host key, Save, then **Check with Zoom**.
   - Settings: set term start and end dates (meetings repeat weekly between them, max 50 weeks), confirm buffer and default length, add Niraj and team as admins (then invite them in Supabase Auth).
7. **Test end to end, then clear demo data**
   - Submit the Tally form with your own details, approve it in Queue, check the Zoom meeting and email arrive, sign in as that email to see the facilitator view.
   - Settings → Clear demo data.

## Local development

```
cd app
npm install
npm run dev
```

The app uses the project's publishable key (`app/src/config.js`), which is safe in a browser. All access control is in row-level security and the edge functions.

## Not built yet (deliberately)

Attendance from Zoom reports, "not attended recently" alerts, email nudges, 6 and 9 week feedback forms, CRM sync. The schema leaves room for these after January.
