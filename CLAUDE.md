# ThinkGita Circles: notes for Claude

Weekly online Gita circles: facilitators apply on a Tally form, the system assigns one of ~10 Zoom licences without clashes, an admin approves, a recurring Zoom meeting is created and the facilitator is emailed. Circles are also listed on the ThinkGita website (Framer CMS). Owner: Viren (with Niraj Mulji, KCSoc). See README.md for setup and TESTING.md for tests.

## Map

- `app/`: dashboard (Vite + React, hash routing), deployed to GitHub Pages on push to `main` (`.github/workflows/deploy.yml`). One login for admins and facilitators.
  - `src/Admin.jsx` (most admin screens, circle panel), `src/FacilitatorsPage.jsx`, `src/People.jsx` (facilitator picker, new person), `src/Facilitator.jsx` + `src/Profile.jsx` (facilitator portal), `src/WebsiteFields.jsx` / `src/WebsitePage.jsx` (website listing), `src/lib.js`, `src/emailTemplate.js` (must match `supabase/functions/provision-circle/template.ts`), `src/TrainingPage.jsx` (facilitator training: trainees, next steps, needs matching, email wording; Tally resync card in Settings), `src/HelpPage.jsx` + `src/help.css` (the in-app Help: header Help button, `#/Help` and `#/Help/<guide-id>`), `src/help/*.js` (the guides: plain data, one file per section, each guide has an `audience` of all, admin, super, facilitator or assessor), `public/help/*.webp` (guide screenshots).
- Help guides: when you change what a screen does, update the matching guide in `src/help/` in the same change. Screenshots are made from the e2e mock backend with made-up people: `npm run help:shots` (specs in `app/tests/help`, output in `app/tests/help/out`, then convert to WebP into `public/help`). `tests/unit/help-guides.test.js` checks ids, links, screenshots and that no dashes are used.
- `supabase/migrations/`: numbered SQL, all applied to the live project. Next number continues the sequence (`2026MMDD0000NN_name.sql`).
- `supabase/functions/`: `tally-intake` (Tally webhook, signature checked, verify_jwt OFF), `provision-circle` (admin actions: approve, reschedule, handover, emails; verify_jwt ON), `framer-sync` (website sync, cron secret or admin, verify_jwt OFF), `training` (training forms webhook, Tally backfill, fresh file links, next-form and Certified / Not certified emails; Tally signature, admin or cron secret; verify_jwt OFF; deploy with `--no-verify-jwt`).
- `supabase/tests/sql/`: behaviour tests, one DO block each that always ends in `raise exception 'TESTS PASSED ...'` so everything rolls back. `supabase/tests/checks/`: read-only checks (schema_* must return no rows, data_* are warnings).

Supabase project id: `rxvehsmunykipwevtpmb`.

## Rules

- Writing (UI copy, emails, docs, commit messages, replies): no em dashes or double hyphens. Plain, friendly UK English.
- Never ask for or paste secrets in chat or in the repo (it may go public). Secrets live in Supabase function secrets; the cron secret is in `private.cron_secret`.
- Test SQL only in rolled-back DO blocks. Never write test rows to the live database outside one.
- Names: facilitators are people on file (`facilitators`), edited only on their profile. Circles pick them (primary `circles.facilitator_id`, co-facilitators `circle_cofacilitators`). New circles always get automatic names (DB trigger); never send `name` from the dashboard.
- Website: `framer-sync` only sends fields that changed and never clears Framer values; hand-made Framer items keep their own title, photo and link. Readiness rules live in both `framer-sync` `websiteMissing()` and `app/src/WebsiteFields.jsx` `websiteChecks()`: change both together.
- Verification: approving a circle (status to live) verifies its people; admins can verify on the profile (`set_facilitator_verified`). Unverified hosts can't go on the website before approval (DB trigger).
- Training: don't run a full Tally resync unless absolutely necessary (webhooks bring new forms in; the server allows one per 15 minutes). Training emails: 0.75 s apart, 20 per batch, stop on Gmail limits, 300 per 24 hours.
- Keep unit and e2e tests green; add or update tests with every behaviour change. Known expected failures are marked `test.fail` / `it.fails`.

## Working notes

- Supabase MCP `deploy_edge_function` needs the whole file content. For big files (provision-circle, framer-sync) prefer the CLI, run from the repo root:
  `supabase functions deploy provision-circle --project-ref rxvehsmunykipwevtpmb`
  `supabase functions deploy tally-intake --project-ref rxvehsmunykipwevtpmb --no-verify-jwt`
  `supabase functions deploy framer-sync --project-ref rxvehsmunykipwevtpmb --no-verify-jwt`
  After any deploy, confirm the version and verify_jwt with list_edge_functions.
- MCP SQL calls can hang on statements that contain the words DROP or DELETE; build them with concatenated EXECUTE strings if needed.
- Call an edge function from SQL with `net.http_post(... headers := jsonb_build_object('x-cron-secret', (select secret from private.cron_secret where id = 1)))`, then read `net._http_response` by id.
- E2E in a sandbox: `PW_CHROMIUM=$(ls -d /opt/pw-browsers/chromium_headless_shell-*/*/headless_shell | head -1) npx playwright test`. The e2e clock is fixed at `NOW` in `tests/fixtures/data.js` (Wed 7 Oct 2026); every Supabase call is mocked in `tests/e2e/support/mock-backend.js`.
- Edge function unit tests import the Deno files through `vitest.config.js` (an expose-internals plugin and `npm:` stubs); `tests/unit/helpers/fakeSupabase.js` is the fake client.

## Commands

`/health` live status, `/test` run the suites, `/db-test` run the SQL tests, `/migration` add a database change safely, `/deploy-functions` deploy edge functions, `/ship` test, commit and push.
