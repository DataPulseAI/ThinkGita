# Testing

Four layers, from fastest to slowest. Run the first two on every change; run the database layers before and after every migration.

| Suite | Where | Command (in `app/`) | Touches | In CI |
| --- | --- | --- | --- | --- |
| Unit | `app/tests/unit` | `npm test` | Nothing (pure functions, stubs for Framer and email) | Always |
| End-to-end | `app/tests/e2e` | `npm run test:e2e` | A local build of the dashboard; every Supabase call is mocked | Always |
| Database behaviour | `supabase/tests/sql` | `npm run test:db` | The database in `TEST_DATABASE_URL`; every change rolls back | When the secret is set |
| Schema and data checks | `supabase/tests/checks` | `npm run test:db` (same runner) | Read-only `SELECT`s | When the secret is set |

`npm run test:all` runs unit and end-to-end together.

## What each suite covers

- **Unit (Vitest).** Helpers and actions inside the edge functions (`framer-sync`, `provision-circle`) and dashboard helpers: website readiness rules, Framer field mapping, sync behaviour and admin actions run against a fake Supabase client and stubbed Framer and email clients. `vitest.config.js` exposes private helpers for tests without changing the source files.
- **End-to-end (Playwright).** Signs in, navigates the dashboard, and checks the overview and schedule screens on desktop (and `@mobile` tagged tests on a phone viewport). The Supabase API is answered by mocks in `tests/e2e/support`, so no real data, Zoom, email or website is involved.
- **Database behaviour (SQL).** Triggers and functions doing real work in Postgres: licence capacity (2 meetings at once, never 3), slot maths across timezones, week wrap and clock changes, the allocator and licence protection, Framer dirty marking.
- **Schema checks** (`checks/schema_*.sql`, must pass, safe to gate a deploy): RLS on every public table, no policies for anon, fixed `search_path` on functions, internal and trigger functions not callable by the API roles, required triggers and cron jobs present and enabled, `private` schema closed, TRUNCATE revoked, columns from later migrations present, facilitator-photos bucket admin-only for writes.
- **Data checks** (`checks/data_*.sql`, warnings): no licence with 3 overlapping meetings, live circles have a Zoom id, join link and active licence, active circles have a schedule, timezones are valid, no shared Framer items, website sync and publish are not stuck, facilitator names are not emails, live licences have a host key, at least one super admin. These can fail because of real data and are reported separately; they never block CI.

Every check file is one `SELECT` that returns zero rows when all is well, and one row per problem otherwise, with a `problem` column plus ids. You can paste any of them into the Supabase SQL editor.

## Running locally

```bash
cd app
npm ci
npm test                       # unit
npx playwright install chromium   # first time only
npm run test:e2e               # end-to-end (builds and serves the app on port 4799)
```

### Database tests against a local stack

Needs Docker and the [Supabase CLI](https://supabase.com/docs/guides/local-development).

```bash
supabase start                 # from the repo root; prints the local DB URL
supabase db reset              # applies every file in supabase/migrations to a fresh database
cd app
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:db
```

A fresh local database has no admins, so `data_11` (super admin exists) will warn until you insert a test super admin. The cron jobs, cron secret and storage bucket are created by the migrations themselves.

### Database tests against a Supabase branch

1. Create a branch of project `rxvehsmunykipwevtpmb` (Dashboard, Branches, or `supabase branches create`). It runs every migration on an empty database.
2. Copy the branch's connection string (session pooler or direct, port 5432) from Connect.
3. `TEST_DATABASE_URL='<branch url>' npm run test:db`
4. Delete the branch when done. Branches are billed while they exist.

For CI, store the branch URL as the `TEST_DATABASE_URL` repository secret. Without it the database job is skipped with a notice.

## How the database tests stay safe

- Each file in `supabase/tests/sql` is a single `DO` block. It creates its own uniquely named rows (`zz-test-<random>` licences, `tg-test-...@example.org` facilitators), asserts as it goes, and **always ends with `raise exception 'TESTS PASSED: ...'`**. Raising rolls the whole block back, so nothing it wrote survives, pass or fail. The runner (`app/scripts/test-db.mjs`) treats that message as success and any other error as failure.
- Checks in `supabase/tests/checks` are plain `SELECT`s and change nothing.
- Still, prefer a branch or local stack: tests take advisory locks and row locks while running, and only a branch lets you try a migration before production.
- Never add a test that commits, calls `pg_net`, or calls an edge function.

## Before and after a migration

1. Create a Supabase branch (or `supabase start` + `supabase db reset` locally).
2. Run `npm run test:db` against it. Schema checks and behaviour tests should pass before you start.
3. Apply the new migration to the branch (or add it to `supabase/migrations` and `supabase db reset`).
4. Rerun `npm run test:db`. Fix anything red. If the migration adds a table, column, trigger, cron job or function, add it to the matching schema check.
5. Check the advisors (Dashboard, Advisors, or the Supabase MCP `get_advisors`) for security and performance. New warnings should be fixed or explained.
6. Apply the migration to production.
7. Deploy any edge functions that changed (`supabase functions deploy <name>`).
8. Run the schema checks against production (read-only, safe) and rerun `npm run test:e2e`.
9. Look at the data checks on production and decide whether any new warnings need a data fix.

## Adding a test for a new feature

- **Pure logic** (formatting, mapping, a rule in an edge function): add a Vitest file in `app/tests/unit`. Use the stubs in `app/tests/stubs` instead of real Framer or email clients.
- **A screen or flow in the dashboard**: add a Playwright spec in `app/tests/e2e` and extend the mocks in `tests/e2e/support` with the API responses the screen needs. Tag phone-relevant tests `@mobile`.
- **A trigger, function or constraint**: add assertions to the relevant file in `supabase/tests/sql`, or a new numbered file using the same pattern (unique test data, assert, end with `raise exception 'TESTS PASSED: ...'`).
- **Something that must always be true about the schema** (a grant, a trigger, a cron job): add rows to the relevant `checks/schema_*.sql` or a new `schema_NN_name.sql`.
- **Something that should be true about the data**: a new `checks/data_NN_name.sql`. Return ids rather than emails or names.
- Every check file starts with a comment saying what it checks and why. No em dashes in prose.

## Known gaps

- Edge functions are tested only at the helper level. Nothing runs them end to end against Zoom, Framer or Gmail; the real integrations are verified by hand after a deploy.
- `tally-intake` signature checking and the cron tick calling `framer-sync` are not covered by automated tests.
- RLS is checked structurally (policies exist, none for anon) but not by signing in as each role and trying reads and writes.
- End-to-end tests use mocks, so a mismatch between the mocks and the real API shape will not be caught there; the database tests partly cover this.
- pg_net on hosted Supabase is installed by `supabase_admin` with USAGE and EXECUTE granted to PUBLIC, anon and authenticated. Only `supabase_admin` can revoke those, so the revoke in migration 023 has no effect on them. `schema_07` therefore only fails on grants a project migration adds. `net` is not an exposed API schema, so it is not reachable over REST.
- Edge functions deployed to the project but not in the repo (for example one-off import or probe functions) are not tested or checked.
