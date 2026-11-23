# CLAUDE.md — rules for AI agents working on VSM Growth Operations

Read this before touching anything. These rules exist because an earlier change replaced working modules with stubs that queried non-existent tables, deleted the app layout and server actions, and shipped a migration that could not run. Don't repeat that.

## What this is
Internal operating system for VSM Growth and VSM Scholars (Meerut & Noida, India). People, attendance, leave, tasks, daily updates, performance, payroll, finance, CRM, notifications, access control and audit.
**Stack:** Next.js 15 App Router (server components + server actions) · TypeScript 5.9 (strict) · Supabase Postgres, Auth and RLS · Brevo or Resend email · Vercel.

## Non-negotiable rules
1. **Security lives in Postgres.** Every table has RLS. Permission checks use `has_perm()`, `can_view_*()`, `is_in_my_team()` and `can_manage_role()`. UI checks (`can()`, hidden buttons) are cosmetic only. A new feature isn't done until its RLS policies exist and are tested.
2. **The app queries as the signed-in user** (`supabaseServer()`). `supabaseAdmin()` (service role) is allowed only in `api/public/enquiry`, `lib/email/worker.ts` and invites in `people/actions.ts` *after* `requirePerm`. Never add another use without an explicit reason in the PR. The browser Supabase client was intentionally removed to keep session tokens HttpOnly; chat currently refreshes through authenticated polling, not browser token exposure.
3. **Never query a table that doesn't exist.** Check `supabase/migrations/` first. Real table names include `attendance_events` (not `attendance`), `payroll_entries` (not `salary_slips`), `leave_requests` and `leave_types` (not `leave_balances`), and `employees` + `employee_directory` (not `team_members`).
4. **Don't delete working code to "simplify".** Keep `src/app/(app)/layout.tsx`, every `actions.ts`, the engines in `src/lib/engines/*` and the Block 1 pages. Extend them; don't replace them.
5. **Migrations are append-only.** Never edit an applied migration; add `NNNN_description.sql`. Each must apply cleanly on top of all previous ones (`npm run test:db` proves it). Functions in index predicates must be `IMMUTABLE` (`now()` is not).
6. **No policy recursion.** If policy A reads table B and B's policy reads A, Postgres raises "infinite recursion". Wrap the cross-table check in a `SECURITY DEFINER` helper (see `is_project_member`, `payroll_run_released`).
7. **Salary privacy.** Only the employee themself and `payroll.view_all` / `payroll.approve` holders may read salary or payroll rows. Managers never inherit salary visibility. Emails never contain amounts. Every salary view calls `log_salary_access`.
8. **Hierarchy.** Role levels live in `role_settings` (Super Admin = 100, always all permissions). You can only manage roles strictly below your level, only grant permissions you hold, and payroll/salary/finance/roles/audit/settings permissions are Super-Admin-granted sensitive permissions; existing seeded role grants remain in force. Per-person overrides (GRANT/DENY) are Super-Admin-only. The last Super Admin can't be removed. Don't weaken any of this.
9. **No arbitrary code execution.** No `RUN_SQL`, `eval` or user-defined HTTP calls in automations. Use allow-listed actions only.
10. **Money.** INR (₹, `en-IN`), integer paise in the payroll engine. Statutory deductions (PF/ESI/PT/TDS) are not auto-calculated; they're entered as approved deductions after a CA reviews them.
11. **Time.** Store UTC, display `Asia/Kolkata` via `src/lib/engines/time.ts`.
12. **Never fabricate.** No mock data, no "would appear here" placeholders, no claiming an integration works without testing it. Don't claim tests passed unless you ran them.
13. **Secrets.** Never commit `.env.local`. Never print keys. Never prefix a secret with `NEXT_PUBLIC_`. Session cookies are HttpOnly (`src/lib/supabase/cookies.ts`); never add a browser Supabase client or expose tokens to page JavaScript.
15. **Emails go through `enqueue_email()` only**, so recipient preferences apply. Never send directly with the provider, except the Integrations panel test.
16. **Integrations are never shown as connected** unless `integration_status` holds a real successful test or delivery.
17. **Work is delivered in blocks** (`docs/blocks/BLOCK-NN.md`). The next block starts only after the owner approves the previous one.
14. **Dependencies.** Add a package to `package.json` before importing it (an earlier change imported `lucide-react` without installing it, which broke the build). Keep `typescript@5.9`; TS 7 breaks Next 15.

## Layout
```
supabase/migrations/   0001 foundation · 0002 workforce · 0003 performance+payroll · 0004 CRM+notifications · 0005 payroll adjustments · 0006 access hierarchy · 0007 notification prefs + integrations · 0008 recruitment · 0009 HR documents/probation/exit · 0010 Finance ERP · 0011 Projects/Communication · 0012 Chat security · 0013 Executive reporting · 0014 Calendar/workforce · 0015 Advanced calendar/quality exports · 0016 Workflow automation · 0017 Workflow builder · 0018 Integration Control Centre
src/lib/engines/       pure, unit-tested logic: attendance.ts performance.ts payroll.ts time.ts
src/lib/data/          server loaders that feed engines (run under RLS)
src/lib/email/         templates.ts · providers.ts (Brevo/Resend) · worker.ts (outbox drain)
src/lib/auth.ts        getContext/requireContext/requirePerm/can — reads my_context() from the DB
src/lib/perms.ts       permission catalogue shown in the UI (must match DB strings)
src/app/(app)/         authenticated pages; each mutating page has an actions.ts (zod-validated server actions)
src/app/api/           public/enquiry · cron/email · cron/digest · reports/* (CSV, permission-checked)
docs/blocks/           one file per execution block: what changed, what to run, what was verified
tests/engines.test.ts  tests/email.test.ts  tests/db/security.sql (RLS suite on real Postgres)
```

## Adding a feature (checklist)
1. Migration with tables, indexes, RLS policies and `SECURITY DEFINER` RPCs for state changes.
2. Add tests to `tests/db/security.sql`: an allowed case and a blocked case for each persona.
3. Pure logic goes in `src/lib/engines/` with unit tests.
4. Page (server component) + `actions.ts` (zod → RPC/insert → `flash`). Add loading, empty and error states.
5. If it needs a permission: add it to `seed_default_permissions` (new migration), `src/lib/perms.ts`, and `isSensitive` if it's sensitive.
6. Run `npm test && npm run test:db && npm run typecheck && npm run build`. All must pass.

## Commands
```bash
npm run dev            # local app
npm test               # engine + email unit tests
npm run test:db        # applies all migrations to a scratch DB and runs the RLS suite (needs PGHOST/PGPORT/PGUSER)
npm run typecheck
npm run build
```

## Block 08 workforce collaboration

- Attendance remains RPC-driven through `record_attendance`; effective-dated schedule assignments override the employee's base shift for local work dates in `loadAttendance`.
- Task timesheets (`task_time_entries`) are separate from attendance and from existing project workspace timesheets (`project_time_entries`). Task timesheet rows require an assigned task; project-only time remains in the project workspace.
- Teams/groups, quality assessments/checklists, calendar invitations and meeting notes are tenant-scoped with RLS and relationship guards. Do not bypass their RLS with client-side writes.
- Meeting invitees receive in-app MEETINGS notifications. Calendar recurrence is stored only; no recurrence expansion or external calendar sync exists yet.

## Block 09 additions

- Calendar month/week/day views; bounded recurring series are atomically expanded by the 12-argument `create_calendar_event` RPC.
- Google/Microsoft OAuth tokens are AES-256-GCM encrypted with `CALENDAR_TOKEN_ENCRYPTION_KEY`; never log or expose token columns. The cron sync uses the service-role client only behind `CRON_SECRET`, imports provider events as private, and syncs a rolling 90-day window.
- Calendar email invitations use `claim_calendar_email_deliveries()` with `FOR UPDATE SKIP LOCKED`, retry backoff and a five-attempt cap.
- Quality evidence is private in the `quality-evidence` Storage bucket, path-scoped by org and assessment, size/MIME limited, SHA-256 recorded, and exposed only through short-lived signed URLs.
- Timer entries use `started_at`/`ended_at` in `task_time_entries`; a partial unique index permits one active timer per employee. Attendance remains a distinct presence record.
- `src/lib/reports/workbook.ts` emits OOXML XLSX and paginated PDF without spreadsheet formula execution. `reportResponse()` centralises private CSV/XLSX/PDF responses; ICS is generated separately for calendar interchange.

## Block 10 workflow automation

Workflow rules are tenant-scoped and cannot execute arbitrary code. Events are idempotently queued; trusted workers claim via `FOR UPDATE SKIP LOCKED` and finish through service-role-only RPCs. Wire only typed, allowlisted actions and retain permission checks at execution time.

## Block 12 UI boundaries

- `/settings/admin` is organisation-scoped and Super-Admin-only; do not turn it into cross-tenant platform administration without a separately designed service-role control plane and audit model.
- `/settings/access` retains database/RLS enforcement. UI switches are presentation only; never weaken `saveMatrix` or sensitive permission rules to make a toggle appear enabled.
- Chat uses the existing membership-gated APIs and four-second polling. Do not expose private channel messages or storage objects to non-members.


## Block 13 integration diagnostics
- Keep all integration probes server-side and behind `settings.manage`.
- Never display service-role credentials, OAuth secrets, access tokens, intake keys, or user records in diagnostics.
- A configured environment variable is not proof of a working connection; label credential readiness separately from live test results and linked account state.
- Realtime handshake success does not imply chat subscriptions are implemented.
- Diagnostic history must remain organisation-scoped with RLS and operator attribution.

## Block 14 implementation notes

- Browser Realtime client: `src/lib/supabase/browser.ts` (public anon key only).
- Chat subscribes to private `chat:<channel UUID>` topics; topic access is checked by `can_access_chat_realtime_topic()` in migration 0019.
- Presence and typing are ephemeral Realtime events; they must never be treated as attendance or authoritative employee state.
- Notifications subscribe to recipient-filtered Postgres Changes and rely on existing notifications RLS.
- Browser Notification API is opt-in and foreground-app dependent; do not describe this as Web Push.


## Block 15 operations
- Apply migration `0020_business_workflow_sla_execution.sql` (or the regenerated `supabase/all_migrations.sql`).
- Deploy the updated `/api/cron/workflows` route; it scans SLA events before draining workflow runs every five minutes.
- Configure `CRON_SECRET` in the deployment environment.
- Tune the 24-hour task due-soon, 48-hour pending-timesheet and 12-hour incomplete-attendance thresholds to the organisation policy before payroll-critical use.
- Workflow actions support `notify_actor` and `notify_target`; target routing requires `target_employee_id` in the event payload and same-organisation active employee validation.

## Block 17 rules
- All outbound channels go through `delivery_outbox` (SQL `enqueue_delivery`), never a direct send from business code. Direct sends are allowed only for admin test buttons (`sendDirect`).
- Any new org event must be added to `org_event_keys()` (SQL) **and** `src/lib/delivery/events.ts`, plus a text in `messages.ts`. Never include amounts.
- Links in outbound messages must pass `localPath()` (same-origin only).
- Webhook destinations must go through `assertSafeUrl`. Never select `webhook_endpoints.secret` with the user client.
- Inbound providers verify the signature first, insert `inbound_webhook_events` (idempotent), and **never** mark invoices or payroll paid.
- Permission matrix writes go through `togglePermission`; the DB rules are the authority, and the UI only mirrors them.

## Block 18 rules
- There is exactly ONE Super Admin. Never add code paths that create, promote, demote, delete, relink, restrict or reset the Super Admin; the DB (`protect_super_admin`, `one_super_admin_per_org`, `protect_sa_auth_user`, `can_reset_password`) blocks them, so don't work around it with the service role.
- Employee IDs come from the DB (`assign_employee_code`). Send a blank code; never compute IDs in the app.
- New posts go in `designations`; team membership and team chat sync are triggers. Don't duplicate them in the app.
- Pages that show changing data should mount `<LiveSync tables={[...]} />`. Don't add polling.
- Demo data is always `is_demo = true` with random passwords shown once. Never hard-code passwords (a unit test checks this).
- Local scripts must never overwrite `.env.local`.
- Never rely on Supabase's automatic table grants (new projects don't have them). The live DB is installed or updated with `supabase/repair/catch_up.sql`; after adding a migration, add its marker in `scripts/build-catch-up.py` and rebuild. CI: run `./scripts/test-db.sh` and `STRICT_GRANTS=1 ./scripts/test-db.sh`.

## Blocks 19–23 rules
- Punches go through `record_attendance_v2` only; the DB enforces geofence/selfie/offline rules. Never trust client time except as `p_offline_at` (the DB bounds it).
- Statutory maths lives in `src/lib/engines/statutory.ts` (pure + tested). Change defaults there AND in `0029` if a rule changes; never hard-code rates in pages.
- Bank files and payout confirmations never mark anything paid without `mark_entry_paid` (payroll.pay, not for yourself).
- Google: tokens only via `src/lib/google/oauth.ts` (service role). Calendar copies carry no attendees and are tagged `vsmEventId`; imports set `external_source`.
- Scholars fees: insert DUE rows only; PAID/WAIVED only through `scholar_confirm_payment` / `scholar_waive_payment`. Certificates only through `scholar_issue_certificate`.
- Post-based grants (`designations.grants`) must never include sensitive permissions (the DB ignores them anyway).
- Server errors are captured by `src/instrumentation.ts`; never log request bodies or secrets (use `scrub`).
