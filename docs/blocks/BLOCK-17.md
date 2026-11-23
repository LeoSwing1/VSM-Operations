# Block 17 — Audit repair, integrations, instant permissions, Operations Center, animated login

## 1. What this block delivers

### Audit repair (blockers found in the Block 16 audit)
- **Build:** 36 TypeScript errors are fixed; `next build` passes.
- **Migrations:**
  - The `0010` view typo (`::date month` → `as month`) is fixed.
  - The `0014` function that ended in `end $$` is fixed.
  - The `0009` HR guard is rewritten with `to_jsonb(new)`.
  - `0022_block17_repair.sql` safely replays every affected object on a database where those migrations were only partly applied.
- **Realtime:** this was running anonymously because the auth cookies are HttpOnly. The browser now gets a short-lived access token from `/api/realtime/token` (no refresh token, `no-store`, same-origin only) and calls `realtime.setAuth`.
- **CSV export:** formula injection is now blocked after leading whitespace, a BOM, tab or carriage return.
- **Tests and tooling:** brittle tests are fixed and the DB test helper now treats "0 rows" as blocked. Prettier is added and the remaining "OPDesk" strings are rebranded.

### Integrations (`0023_integrations_channels.sql`)
| Channel | Direction | What it does |
|---|---|---|
| WhatsApp Business (Cloud API) | out | Personal alerts to employees who opted in, using an approved template with 2 variables. Delivery status comes back through the Meta webhook. |
| Web push (VAPID) | out | Desktop, Android and installed iOS PWA. Expired devices are removed automatically. |
| Slack / Microsoft Teams | out | Company events only, with per-event routing. |
| Outbound webhooks (Zapier / Make / n8n) | out | HMAC-signed (`X-VSM-Signature: t=,v1=`). SSRF-guarded. 5 retries; auto-disabled after 20 failures in a row. The secret is shown once. |
| Meta Lead Ads | in | Signature verified, idempotent. Leads go into the CRM with source CAMPAIGN. |
| Razorpay | in | Signature verified, idempotent. Payments are matched to invoices and payouts to payroll entries. **Nothing is marked paid automatically.** |
| PostHog analytics | out | Anonymous: ids are stripped from paths, no cookies, no PII, Do-Not-Track honoured. |

How delivery works:
- Every outbound message goes through the durable `delivery_outbox`. It is written in the same transaction as the business event and drained by the existing 5-minute `/api/cron/email` job with backoff of 1/5/15/60/240 minutes.
- Before any event leaves the database, all amount fields are removed from its payload (`amount`, `net_amount`, `gross_amount`, `salary`, `base_monthly`).
- Employees choose Email / WhatsApp / Push per category under **Notifications → Preferences**.
- Admin pages (under **Admin → Integrations**):
  - **Health & core**
  - **Channels:** queue per channel, retry, test sends to your own phone or devices, Slack/Teams routing
  - **Webhooks:** create, ping, disable, rotate secret, delivery log
  - **Inbound events:** Meta and Razorpay URLs, received events, matches to review

### Roles & Permissions panel (OPDesk style)
- Every switch saves **instantly**. The UI updates optimistically and **rolls back** if the database refuses the change.
- Search, collapsible groups, and per-role counts.
- Toasts confirm or explain each change.
- Greyed switches are outside your authority. The database still enforces level, delegation and sensitivity rules, and every change is audited.

### Operations Center (`/operations`)
- **Live today:**
  - KPIs: present, working, late, missing past shift start, on leave, pending approvals (with SLA breaches), overdue/blocked/review tasks, failed jobs.
  - Live attendance board for everyone in your RLS scope.
  - Approval queues with the oldest age; overdue tasks.
- **Executions (admins only):**
  - Workflow, email and channel queues for the last 24 h.
  - Failed workflow runs with a retry button (single or all).
  - **Run all workers now.**
  - System health and cron heartbeat.
  - Recent audit log (for users with `audit.view`).
- Auto-refreshes every 30 s while the tab is visible; it can be paused.

### Animated login
1. The VSM wordmark appears centred and a volt line draws underneath.
2. The logo glides to the top-right corner while the curtain lifts.
3. The headline words and the form rise in.

The intro plays once per tab. It is skipped after a form message and fully disabled when the user has *reduced motion* turned on. To use an uploaded logo file instead of the wordmark, set `NEXT_PUBLIC_BRAND_LOGO=/your-logo.svg` and put the file in `/public`.

## 2. Run on the live Supabase (SQL Editor, in this order)
1. Any of `0019`–`0021` that has not been run yet.
2. `supabase/migrations/0022_block17_repair.sql`
3. `supabase/migrations/0023_integrations_channels.sql`

Both are idempotent, so running them again is safe. If you use `scripts/migrate.sh`, it skips migrations that are already recorded.

Live check query:
```sql
select
  to_regclass('public.delivery_outbox') is not null      as outbox,
  to_regclass('public.webhook_endpoints') is not null    as webhooks,
  to_regclass('public.inbound_webhook_events') is not null as inbound,
  to_regclass('public.push_subscriptions') is not null   as push,
  (select count(*) from pg_trigger where tgname like 'org_events%') as event_triggers,
  has_column_privilege('authenticated','public.webhook_endpoints','secret','select') as secret_readable_should_be_false;
```
Expected result: `true | true | true | true | 7 | false`.

## 3. Vercel environment (only for the channels you want — all optional)
Add these in Vercel Project → Settings → Environment Variables. Never put secrets in `NEXT_PUBLIC_*`.

| Channel | Variables |
|---|---|
| WhatsApp | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TEMPLATE` (approved, 2 body vars), `WHATSAPP_TEMPLATE_LANG` |
| Push | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (generate with `npx web-push generate-vapid-keys`) |
| Slack / Teams | `SLACK_WEBHOOK_URL`, `TEAMS_WEBHOOK_URL` |
| Meta | `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_PAGE_TOKEN`; callback `https://<APP_URL>/api/webhooks/meta` |
| Razorpay | `RAZORPAY_WEBHOOK_SECRET`; URL `https://<APP_URL>/api/webhooks/razorpay`; events `payment.captured`, `payment_link.paid`, `payout.processed` |
| Analytics | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` |

## 4. Verification actually run in this workspace
- `tsc --noEmit`: 0 errors.
- `next build`: success.
- Prettier check: clean.
- Vitest: **107/107**, including the new `block17.test.ts`:
  - SSRF private-IP and URL rules
  - webhook, Meta and Razorpay signatures, including replay
  - payroll texts never carry amounts
  - links stay same-origin; a protocol-relative open redirect was found and fixed
  - WhatsApp template shape
  - analytics path sanitising
- PostgreSQL 16 (local, with a Supabase shim): every migration 0001–0023 applied from scratch, plus the repeat and partial-state runs for 0022, and **264/264** RLS/security checks.
- Smoke test of the production server:
  - `/login` returns 200 and the animation was screen-captured on desktop and mobile.
  - Protected routes redirect to login.
  - `/sw.js` and `/vsm-logo.svg` are public.
  - The Meta webhook verify returns 403 without the token.

**Not verified here:** live Supabase, real WhatsApp, push, Slack, Teams, Meta or Razorpay deliveries. The sandbox cannot reach those services. Use the test buttons on **Channels** and **Webhooks** after deploying; each result is saved to the diagnostic history.
