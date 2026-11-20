# Block 1 — Security & notification foundation

**Status:** delivered, awaiting review. Next: Block 2 (Chat core), only after you approve this one.

## What's new
| # | Feature | Where |
|---|---|---|
| 1 | **Server-only session cookies.** Auth cookies are always `HttpOnly`, `SameSite=Lax`, `Secure` in production. The unused browser Supabase client was removed, so page JavaScript can never read a token. | `src/lib/supabase/cookies.ts`, `server.ts`, `middleware.ts` |
| 2 | **Email preferences per category:** Immediately / Daily summary / Off. Enforced in the database (`enqueue_email`), not just the UI. In-app notifications are always kept. Security/account emails can't be muted. Chat defaults to the daily summary. | Notifications → **Email preferences** (`/notifications/preferences`) |
| 3 | **Daily summary email** at 7 pm IST: one email per person listing everything they chose to batch. Never sent twice for the same day. | `/api/cron/digest`, template `digest.daily` |
| 4 | **Integrations panel v1**: real test results only, never "connected" until a test or delivery succeeds. Database check (with round-trip ms), **Send test email** through Brevo, cron heartbeat (RUNNING / STALE / NO RUN YET), website-enquiry status, email outbox counts (sent/queued/failed/skipped), recent failures with the error, **Retry failed**, and the honest list of integrations coming in Blocks 2–10. Every test is audited. | Admin → **Integrations** (`/settings/integrations`, needs `settings.manage`) |
| 5 | **Shifts & holidays admin**: create/edit shifts (start, end, grace, full/half-day hours, weekly offs), see how many people are on each, warning for employees with no shift; holidays per year with add/remove. All audited. | Admin → **Shifts & holidays** (`/settings/attendance`, needs `attendance.manage`) |

## Database: migration `0007_notification_prefs_integrations.sql`
New tables: `notification_preferences`, `notification_digest_items`, `integration_status` (all RLS). New/changed functions: `enqueue_email` (now honours preferences), `build_daily_digests` (service role only), `record_integration_test` (settings.manage), `record_integration_event` (service role only), `retry_failed_emails` (settings.manage, re-queues only never-delivered emails).

## What you run (your project already has 0001–0006)
1. **Supabase → SQL Editor** → paste `supabase/migrations/0007_notification_prefs_integrations.sql` → **Run**. ✔ "Success. No rows returned".
2. Copy the updated code over your folder (keep your `.env.local`), then `npm install`.
3. `npm test` → ✔ 31 passed. `npm run build` → ✔ Compiled successfully.
4. `npm run dev`, then check:
   - [ ] Sign out and sign in again. DevTools → Application → Cookies → the `sb-…-auth-token` cookie shows **HttpOnly ✓**.
   - [ ] Notifications → **Email preferences** → set Tasks to *Off* → Save → reload: it stays *Off*.
   - [ ] Admin → **Integrations** → **Run check** on Database → green HEALTHY with a ms figure.
   - [ ] **Send test email** → arrives in your inbox (needs `BREVO_API_KEY` + verified `EMAIL_FROM`). If it fails, the card shows Brevo's exact error.
   - [ ] Admin → **Shifts & holidays** → add a holiday (e.g. 25 Dec) → it appears; Attendance shows that day as HOLIDAY.
5. Vercel: `vercel.json` now has a second cron (`/api/cron/digest`, daily 13:30 UTC = 7 pm IST). On Hobby, add it in cron-job.org with the same `Authorization: Bearer <CRON_SECRET>` header.

## Verified here
- 135/135 database security checks on real Postgres 16 (22 new: own-preferences only, SYSTEM can't be muted, muted → skipped but in-app kept, digest collects then sends exactly once, others can't see your digest, only service role builds digests, integration status admin-only, failures counted and reset, tests audited, retry admin-only).
- 31/31 unit tests (4 new: cookie hardening, digest rendering + no amounts, UI/DB category lists identical, no browser client).
- Typecheck clean, production build clean.

## Not verified here
- Live Brevo delivery and real Supabase cookies (no network to your project from this workspace). Checklist step 4 covers both.
