# OPDesk — VSM Growth Operations ERP

OPDesk is the internal operating system for **VSM Growth** and **VSM Scholars**. It brings people operations, attendance, leave, payroll, CRM, projects, tasks, performance, finance, communication and management reporting into one organization-scoped application.

**Current stack:** Next.js 15 App Router · React 19 · TypeScript · Supabase PostgreSQL/Auth/Storage/RLS · Brevo (Resend optional) · Vercel.

> **Development status:** Block 01 established the core operating platform; Block 02 added recruitment and the employee lifecycle foundation; Block 03 adds confidential employee document storage, probation review decisions and exit-clearance workflows; Block 04 adds the Finance ERP vertical slice (expenses, approvals, payments, vendors, invoices, budgets, reconciliation and CSV reports); Block 05 makes this the central VSM operations portal with project workspaces, delivery milestones, time approvals, team chat, direct messages, attachments and announcements; Block 06 hardens chat membership, reporting/moderation and role permission governance. Database migrations and the production build must pass the validation gates below before deploying a block. Blocks 07–14 add executive reporting, workforce collaboration, advanced calendar/time-quality exports, workflow automation, the Super Admin console, Integration Control Centre and real-time chat/notification infrastructure. Block 14 adds migration 0019. A source implementation is not considered production-ready until its database and security tests pass.

## Start here

| Document | Purpose |
|---|---|
| **[RUNBOOK.md](RUNBOOK.md)** | Exact local setup, Supabase setup, secrets, deployment and first-day configuration |
| **[CLAUDE.md](CLAUDE.md)** | Mandatory architecture and security rules for every developer/AI agent |
| **[docs/blocks/](docs/blocks/)** | Block-by-block delivery notes, files changed, migrations and known limitations |
| **[docs/ERP-MASTER-SPEC-INTEGRATION.md](docs/ERP-MASTER-SPEC-INTEGRATION.md)** | Traceability against the original VSM Growth ERP master specification |
| **This README** | Product overview, development lifecycle, architecture, access and acceptance gates |

---

# 1. Product scope and module map

| Module | Current coverage | Next work / acceptance target |
|---|---|---|
| Executive dashboard | Role-adaptive, database-backed core metrics | Date/department filters; finance and project profitability metrics |
| Employee 360 / HRMS | Employee profiles, onboarding checklist, lifecycle events, private document metadata/storage, probation reviews, exit clearance | Letter templates/PDF issue, identity/bank field-level controls, reusable onboarding plans, expiry reminders |
| Recruitment | Candidate pipeline, interviews, feedback, hire conversion | Offer-letter issuance and recruitment analytics |
| Attendance & workforce | Clock in/out, breaks, corrections, approvals, summaries, CSV | Shift/holiday administration and additional workforce rules |
| Leave | Types, balances, apply/cancel, approval and overlap checks | Delegation, escalation and policy automation |
| Payroll & payslips | Versioned salary structures, payroll calculations, approvals, payment records, printable payslips | Statutory rules only after CA/legal confirmation; automated PDF/email archive |
| Finance & expenses | Expense/reimbursement claims, private receipts, two-stage approvals, manual payment records, vendors, client invoices/receipts, budgets, statement matching, finance reports and CSV export | Bank-feed import, AP bill/PO workflow, multi-line invoice editor/PDF, GST/CA policy configuration, XLSX/PDF exports and automated payment rails |
| Projects & operations | Block 05: project workspaces, team roster, milestones, delivery updates, task roll-up, time logging/approval, finance-linked paid costs and cash received | Dependencies, subtasks, deliverable versioning, project documents, advanced capacity planning and profitability forecasts |
| Tasks & productivity | Assignment, workflow, deadlines, quality review, daily updates; project time logs in Block 05 | Subtasks, task attachments, recurring work, dependencies and full activity timeline |
| Performance | Configurable weighted scoring, review snapshots and manager feedback | Review cycles, self-assessment and richer analytics |
| CRM & clients | Public enquiry intake, dedupe, lead pipeline and assignment | Client 360, contracts, account activity and sales analytics |
| Communication | Blocks 05–06: direct/group chat, public/department/project channels, replies, reactions, private attachments, read receipts, reports, moderation queue, controlled membership, channel archive/leave and moderation audit; private Supabase Realtime subscriptions for messages/reactions, presence, typing, channel-level read receipts, live unread counts and opt-in browser desktop alerts | Web Push/mobile push, offline queue, retention/legal hold and abuse analytics |
| Reports & analytics | Attendance/payroll report foundations | Central report builder, exports and department/project analytics |
| Settings & integrations | Role/permission matrix, hierarchy, audit log, Integration Control Centre with live database/Storage/Auth/Realtime checks, OAuth readiness, cron heartbeat, email outbox and diagnostic history | External webhook management, incident/SLA views and additional provider integrations |

The original master specification remains the source of truth for scope. See the integration audit for item-by-item mapping; update it whenever a module's status changes.

# 2. Architecture and non-negotiable design

## Application layers

1. **UI:** Next.js App Router pages and server components. Forms call server actions; UI visibility is convenience only, never authorization.
2. **Application layer:** server actions and route handlers validate input with Zod, resolve the signed-in employee/organization, check permission, and perform a narrow operation.
3. **Data/security layer:** Supabase PostgreSQL is authoritative. Organization-scoped tables use foreign keys, constraints, indexes and Row Level Security (RLS). Sensitive transitions should be transactional database functions.
4. **Identity:** Supabase Auth. Every active auth user maps to one employee record and one organization context.
5. **Files:** private Supabase Storage buckets. Download access uses RLS-checked, short-lived signed URLs; no private employee file is stored in a public bucket.
6. **Notifications:** events are written to `email_outbox` before delivery. Brevo/Resend worker retries transient failures and records delivery state.
7. **Hosting:** Vercel for Next.js; Supabase for database, auth and storage. Website marketing forms remain hosted separately and post to the public enquiry endpoint.

## Security rules

- Never trust a client-supplied `org_id`, role, employee identity, approval state or amount. Resolve identity from the authenticated session and database.
- RLS must protect every organization-owned table. Add explicit policies for SELECT/INSERT/UPDATE/DELETE as needed.
- Verify permissions in both server actions and PostgreSQL policies/RPCs. Hiding a sidebar item is not security.
- Keep service-role credentials server-only and use them only for documented, permission-checked operations that cannot be done under the caller's RLS context.
- Never return raw bank, PAN, identity, salary or another employee's private records to an unauthorized role.
- Sensitive access, payroll changes, approvals, document changes, role changes and lifecycle decisions must be auditable.
- Enforce separation of duties for payroll preparation, approval and payment. Approval is not payment.
- Use private storage, file type/size validation, organization/employee-bound paths and expiring signed URLs.
- Do not hardcode production credentials, API keys, tax rates, statutory rates or bootstrap passwords.
- Do not use localStorage as a system of record or fabricate dashboard numbers.

# 3. Access model

The role hierarchy is configurable in `role_settings` (Super Admin remains fixed at level 100):

| Level | Role | Typical scope |
|---:|---|---|
| 100 | Super Admin | Full platform access; sensitive permission grants and personal overrides |
| 90 | Admin | Platform operations; manages roles/people below level 90 |
| 80 | HR Manager | Employee lifecycle, recruitment, attendance, leave and payroll preparation |
| 75 | Operations Manager | Teams, projects, tasks and operational attendance |
| 70 | Department Manager | Department operations |
| 60 | Project Manager | Assigned projects and delivery quality |
| 55 | Team Lead | Direct reports and team workflow |
| 40 | Sales Executive | CRM and assigned leads |
| 20 / 10 | Employee / Intern | Personal self-service and assigned work |

Database-enforced hierarchy rules:

- Users can assign/edit roles only below their own level; nobody can change their own role.
- Users can grant only permissions they already hold. Sensitive permissions (`payroll.*`, `salary.*`, `finance.*`, `roles.manage`, `audit.view`, `settings.manage`) may only be granted by Super Admin; existing seeded role grants remain in force. Block 04 seeds the full finance permission set to the `ADMIN` role; separate Finance/Accounts users receive only the granular permissions approved by Super Admin.
- Personal grant/deny overrides are Super-Admin-only; Deny wins over role grants.
- The last active Super Admin cannot be demoted or exited.
- Reporting lines determine team scope. Reporting managers do not automatically receive salary or bank access.
- All grants, revokes, overrides and role changes are audited.

Use **Settings → Access control** to review the permission matrix, hierarchy/reporting tree, individual effective permissions and permission holders.

# 4. Full development process

Every development block follows the same end-to-end workflow. Do not mark a feature complete just because its page renders.

## Step 1 — Establish the baseline

- Start from the latest integrated `main` branch / latest numbered block ZIP, not an older archive.
- Read `CLAUDE.md`, this README, `RUNBOOK.md`, the ERP integration audit and the latest `docs/blocks/BLOCK-NN.md`.
- Inspect the existing route, server action, permission catalogue, database tables, RLS policies, audit patterns and tests before changing anything.
- Record current `git status`, branch and commit. Never overwrite user changes or production configuration.
- Identify the actual stack and reuse existing helpers/components; do not introduce a parallel backend or rewrite compatible modules.

## Step 2 — Define the feature contract

For each feature, document:

- User roles/personas and exact permissions required.
- Organization/employee ownership and visibility scope.
- Data fields, validation, unique constraints, indexes and relationships.
- State machine and allowed transitions (including who can make each transition).
- Side effects: audit events, notifications, storage operations, payroll/leave/attendance sync.
- Failure and retry behavior; idempotency for actions that may be submitted twice.
- Acceptance criteria for UI, server action/API, database and tests.

Do not invent statutory payroll rules or legal document wording. Put uncertain policy behind configuration and require VSM/CA/legal confirmation.

## Step 3 — Database-first implementation

- Add a new ordered migration under `supabase/migrations/NNNN_description.sql`; never edit an already-applied migration.
- Add foreign keys, check constraints, uniqueness, indexes, organization-boundary protection and `updated_at` triggers where needed.
- Enable RLS on every new organization-owned table and create least-privilege policies.
- Use transactions/RPCs for multi-record workflows (e.g. hire conversion, payroll approval, employee exit) so partial states cannot persist.
- Add immutable audit events for sensitive mutations and explicit storage policies for private files.
- Regenerate `supabase/all_migrations.sql` after every migration.
- Update the local Supabase test shim only when a new Supabase-managed schema/service must be represented in scratch tests.

## Step 4 — Application implementation

- Add server actions/route handlers with Zod validation and explicit permission checks.
- Resolve `employee_id`, `org_id`, actor and role from the trusted server context, not form fields.
- Use the caller's Supabase session client for normal data access so RLS remains active.
- Use `supabaseAdmin()` only for explicitly approved service operations, never as a shortcut around RLS.
- Build responsive loading, empty, success and error states; provide confirmation for destructive/financial actions.
- Every visible control must submit a real action or be clearly disabled with an explanation. No fake buttons or hardcoded metrics.
- Revalidate affected routes after mutations and keep the audit trail understandable.

## Step 5 — Tests at four levels

1. **Unit tests:** calculations, validation, date/time, state transitions, formatting and retry behavior.
2. **Server/action tests:** permission denials, malformed input, duplicate submission, failure cleanup and correct audit/notification behavior.
3. **Database/RLS tests:** run all migrations on a disposable Supabase-compatible PostgreSQL database and test as anon, employee, team lead, manager, HR, finance, admin, Super Admin and a different organization.
4. **Build and manual QA:** `npm test`, `npm run typecheck`, `npm run build`; test mobile/desktop, keyboard forms, empty/error/loading states and actual signed-in workflows.

A feature is **not verified** if dependencies are missing, the test runner did not execute, PostgreSQL was unavailable or a migration was not applied to a scratch database. Record these limits in the block report.

## Step 6 — Security and data-integrity review

Before a block is accepted, verify:

- Cross-organization reads/writes are denied.
- Employees cannot enumerate other employee IDs to retrieve private data.
- Team managers see only permitted team scope.
- Salary, bank and identity details are isolated from ordinary people-management access.
- Approval and payment roles are separated; approved/locked records cannot be silently edited.
- File URLs are private, signed URLs expire and storage object paths cannot cross employee/org boundaries.
- State transitions cannot be forged by direct API/database writes.
- Audit history captures actor, action, target and relevant before/after metadata without leaking secrets.

## Step 7 — Documentation and handoff

Every block must update:

- `README.md`: module status, process, commands and next priorities.
- `RUNBOOK.md`: new environment variables, migration number and deployment/rollback notes.
- `docs/blocks/BLOCK-NN.md`: delivered behavior, files, schema, permissions, tests, validation results, limitations and next work.
- `docs/ERP-MASTER-SPEC-INTEGRATION.md`: traceability/status against the original requirements.
- `supabase/all_migrations.sql`: complete ordered migration aggregate.

Include exact commands to run and identify anything that still needs an external account, secret, CA/legal decision or production approval.

## Step 8 — Release safely

- Merge only after unit tests, typecheck, build and scratch database/RLS suite pass.
- Apply the new migration to staging first; smoke-test workflows with non-production accounts.
- Back up production before schema changes. Apply only the new migration using `scripts/migrate.sh` or the documented SQL procedure.
- Deploy the matching app commit after its schema is available.
- Verify health, auth, core reads/writes, email outbox and audit events.
- If a release fails, roll back the application to the previous deployment. Do not blindly drop production tables; use a forward-fix migration or a reviewed restore plan.

## Standard local commands

```bash
npm ci
npm test
npm run typecheck
npm run build

# Optional disposable PostgreSQL integration/RLS suite (requires local PostgreSQL + psql)
PGHOST=localhost PGPORT=5432 PGUSER=postgres npm run test:db

# Local app
npm run dev
```

Do not deploy if any required command fails. If the environment prevents a test from running, say so and leave the deployment gate open.

# 5. Current development roadmap

The roadmap is intentionally sequential so shared employee, finance and project records are designed once and reused by every module.

| Block | Scope | Status |
|---|---|---|
| 01 | Foundation: auth, organization model, role hierarchy, dashboard, employees, attendance, leave, tasks, performance, payroll, CRM, notifications and audit | Delivered; verify in target environment |
| 02 | Recruitment pipeline, interviews, candidate-to-employee conversion, onboarding checklist and lifecycle events | Source implemented; database/security verification pending |
| 03 | HRMS completion: private employee documents, expiry metadata, probation review workflow, confirmation/extension/notice decisions and exit clearance | Source implemented; database/security verification pending |
| 04 | Finance: expense claims, reimbursements, vendor/client payments, budgets, reconciliation and reports | Source implemented; database/security verification pending |
| 05 | Main VSM Operations Portal: project workspaces, milestones, team roster, project updates, time approvals, chat, direct messages, groups, project rooms, attachments and announcements | Source implemented; database/security verification pending |
| 06 | Communication security and access-control hardening: moderated reports, channel membership RPCs, controlled archive/leave, moderation events and sensitive permission grants | Source implemented; database/security verification pending |
| 07 | Executive ERP: unified dashboard, filters, central reports, exports, department/project analytics and profitability trends | Planned |
| 08 | Advanced operations: dependencies, subtasks, recurring work, deliverable versions, capacity planning and project document controls | Planned |
| 09 | Integrations, automation, VSM Scholars, WebSocket/push presence and mobile enhancements | Planned |

A block's status changes to **Verified** only after the relevant migration, tests, typecheck and production build have actually passed.

# 6. Email and notification delivery

`EMAIL_PROVIDER=brevo` with `BREVO_API_KEY` and verified `EMAIL_FROM`. Email events are persisted to `email_outbox` before sending. `src/lib/email/worker.ts` handles retries and records delivery errors. `EMAIL_PROVIDER=resend` is an optional provider switch. Never expose provider keys in browser code. Payslip emails must not include salary amounts or attachments unless the policy is explicitly reviewed.

# 7. Connect vsmgrowth.com website forms to CRM

The marketing site stays on cPanel. Add this pattern to contact/project forms and adjust field labels as required:

```html
<form id="vsm-enquiry">
  <input name="name" required>
  <input name="email" type="email">
  <input name="phone">
  <input name="service">
  <textarea name="message"></textarea>
  <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
  <button>Send</button>
</form>
<script>
document.getElementById('vsm-enquiry').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  data.page = location.pathname;
  data.kind = 'contact'; // use 'project' for project enquiries
  const response = await fetch('https://ops.vsmgrowth.com/api/public/enquiry', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });
  e.target.innerHTML = response.ok
    ? '<p>Thank you! We will reply within one working day.</p>'
    : '<p>Please call +91 82795 74755.</p>';
});
</script>
```

The endpoint validates origin, honeypot and rate limit; saves the lead first; deduplicates by email/phone; alerts authorized CRM users; and queues internal/enquirer emails. Server-to-server posts require `X-Intake-Key`.

# 8. Reports and exports

Reports must be calculated from database records and enforce the same RLS/permission rules as the underlying module. Add filters only when the server query enforces them. Never put sensitive salary/bank fields into general employee exports. Export endpoints must validate format, filters and permission server-side and log sensitive export access.

## 9. Finance ERP workflow (Block 04)


The finance area is permission-scoped and database-backed:

- Employees can submit their own expense/reimbursement claims and upload private receipts from **My expenses**.
- Claims move through `SUBMITTED → MANAGER_APPROVED → APPROVED → PAID` (or `REJECTED`). The claimant cannot approve their own claim; the manager-stage and final finance approver must be different employees.
- Finance operators maintain vendors, create/issue client invoices, record partial/full receipts, create department/project budgets and reconcile statement lines.
- Payment and approval transitions run through SQL RPCs; direct update privileges on sensitive ledger rows are revoked. CSV exports are audited.
- `finance.*` permissions are sensitive and must be assigned by Super Admin. Block 04 seeds the full finance permission set to the `ADMIN` role; grant granular permissions to any separate Finance/Accounts employee.

Routes: `/finance`, `/finance/expenses`, `/finance/invoices`, `/finance/vendors`, `/finance/budgets`, `/finance/reconciliation`, `/finance/reports`.

Before production, Finance/CA must approve the chart/categories, GST treatment, invoice terms, currency, approval limits and accounting policy. Bank-feed import, automated payments, purchase orders/AP bills, payroll reimbursement sync, multi-line invoice PDF, and XLSX/PDF exports are not included in this block. See `docs/blocks/BLOCK-04.md` for security details, validation status and limitations.

## 10. Main VSM Operations Portal — Projects, Chat and Announcements (Block 05)

Block 05 makes OPDesk the central day-to-day operating portal. HRMS, attendance, leave, payroll, Finance and CRM stay in the same authenticated shell and share the same organization, employee, project and permission model.

**Projects & delivery**
- `/projects` lists projects visible under the caller's project membership/RLS. Authorized managers create project workspaces and maintain rosters.
- `/projects/[id]` combines milestones, owners/due dates, linked tasks, project updates/risks/decisions, time logging, approved hours and team roster.
- `/projects/time` is the independent time-approval queue. Employees submit dated time entries; a different authorized manager approves/rejects them through a transaction-safe, audited RPC.
- Finance-authorized viewers see paid project expenses and actual invoice cash receipts. Cost/revenue values are read from Finance records, not duplicated into a second ledger.

**Team communication**
- `/chat` provides direct messages, private groups, discoverable public/department channels and project rooms. `/chat/[id]` supports messages, threaded replies, emoji reactions, read timestamps and private file attachments.
- `/announcements` provides company-wide, department-targeted and project-targeted notices with pinning. Message and announcement events create in-app notifications using the existing notification centre.
- Chat refreshes through authenticated polling every four seconds. This is near-live refresh, **not** a WebSocket/push connection. The database table is registered in Supabase Realtime for a future authenticated realtime client; presence, typing indicators and mobile push remain future work. The existing HttpOnly session design is preserved; no browser auth token is exposed.
- `chat-files` is a private Storage bucket (15 MB cap; PDF, JPEG, PNG, WebP, TXT and ZIP). Attachments are served with short-lived signed URLs after channel membership/RLS checks.

**Permissions:** `projects.workspace_view`, `projects.time_log`, `projects.time_approve`, `projects.updates`, `communication.view`, `communication.send` and `communication.manage`. Migration 0011 updates existing organizations and replaces the default permission seeder so future organizations receive the same defaults. Migration 0012 adds sensitive channel-administration and moderation permissions.

**Remaining:** WebSocket presence/typing, mobile push, subtasks/dependencies/recurring tasks, project documents, deliverable versioning, project roster removal UI, client 360, advanced capacity planning and forecast profitability. See `docs/blocks/BLOCK-05.md` for exact scope and verification status.

# 11. Chat security and role governance (Block 06)

Block 06 hardens the Block 05 communication system and extends the existing role/permission controls.

- `/settings/access` remains the central role matrix, hierarchy, people/override and permission-holder interface. `/settings/roles` remains a compatibility redirect to Access control. New `communication.channel_manage` and `communication.moderate` permissions are included in the catalogue; these are sensitive grants and cannot be delegated by lower-level role managers.
- `/settings/chat-moderation` is restricted to `communication.moderate`. Moderators can review reports, dismiss them, hide reported messages and inspect recent moderation events. Reports are visible to the reporter and authorized moderators only. Moderators can inspect reported conversations in read-only mode without joining; access to private channel context is limited to channels with an open/reviewing/actioned report.
- Channel membership mutations use `manage_chat_member` (SECURITY DEFINER with organisation, actor, channel and target validation). Direct membership table writes are revoked; authenticated self-join remains limited to public channels and the caller's own department channel. Direct-message membership is immutable.
- Channel owners and authorized channel administrators can add/remove members and assign moderator roles; channel owners cannot be removed or self-demoted. Members can leave non-DM channels. Channel archive uses `archive_chat_channel`.
- Message moderation uses `moderate_chat_message`; report review uses `review_chat_report`. Sensitive actions are written to `chat_moderation_events`. Role matrix, hierarchy and personal override changes continue to use the existing audit triggers in migrations 0001/0006.
- Chat message access remains membership-gated and private files remain in the `chat-files` bucket with short-lived signed URLs. At the Block 06 stage, message refresh used four-second polling; Block 14 later supersedes this with private Realtime subscriptions, presence and typing. Mobile push and retention/legal-hold automation remain outstanding.

Migration: `0012_chat_security_access_controls.sql`. New organizations also receive the communication administration permissions through the organization bootstrap trigger. Apply migrations 0001–0018 in order.

**Important validation boundary:** this block is source-implemented. The SQL migration, TypeScript build, RLS suite and production deployment must still be verified in a dependency-enabled environment against a scratch Supabase-compatible database. No production Supabase data or Vercel deployment was changed.

# 12. Definition of done

A module is done only when all of the following are true:

- [ ] It maps to a master-spec requirement and a documented role/permission.
- [ ] Database schema, constraints, indexes and migration are committed.
- [ ] RLS and organization boundaries are tested.
- [ ] Server actions validate input and enforce permission independently of UI.
- [ ] Real records are created/updated; no mock statistics or fake controls remain.
- [ ] Related modules synchronize correctly (e.g. approved unpaid leave to payroll).
- [ ] Audit events and notifications are correct and do not leak sensitive data.
- [ ] Responsive UI includes loading, empty, success and error states.
- [ ] Unit, integration, RLS, typecheck and production build checks pass.
- [ ] README, runbook, block report and integration audit are updated.
- [ ] Staging smoke test passes and rollback path is documented.

# 12. Operational setup

Follow [RUNBOOK.md](RUNBOOK.md) for Supabase, email provider, environment variables, Vercel, DNS and first-day role configuration. Never commit `.env.local`, service-role credentials, database passwords, private keys, production dumps or employee documents.


## Block 07 — Executive ERP

Adds a permission-gated executive overview with date filters, workforce, delivery, task and CRM indicators, independently gated finance metrics, and a safe CSV export. See `docs/blocks/BLOCK-07.md` for scope, security boundaries and accounting limitations.

## Block 08 — Workforce operations and collaboration

Block 08 adds effective-dated shift scheduling integrated into attendance calculations, formal teams and private working groups, task/project timesheets with approval and CSV export, independent quality assessments, calendar events and meeting invitations, attendee responses, meeting agendas/minutes/decisions/action items, and in-app meeting invitation notifications. See [`docs/blocks/BLOCK-08.md`](docs/blocks/BLOCK-08.md) for permissions, migration, implementation boundaries and verification requirements.

## Block 09 — Advanced calendar, attendance, evidence & exports

Block 09 adds full month/week/day calendar views, bounded recurring meeting series, queued email invitations, Google Calendar and Microsoft Outlook OAuth sync, mobile-friendly attendance punch controls, task timer sessions, private quality evidence uploads, and CSV/XLSX/PDF/ICS exports. See `docs/blocks/BLOCK-09.md` for configuration, limits and operational boundaries. Apply migration `0015_advanced_calendar_time_quality_exports.sql` after Block 08.

## Block 10 — Workflow Automation & SLA Foundation

Adds tenant-scoped workflow rules, idempotent event enqueueing, durable execution logs, concurrency-safe worker claiming, bounded retries and service-role-only worker completion. See `docs/blocks/BLOCK-10.md` for implementation boundaries and rollout notes.

## 20. Super Admin console, access matrix and chat workspace (Block 12)

Block 12 adds a dedicated `/settings/admin` Super Admin console with live organisation-scoped role, permission-grant and employee counts plus shortcuts to governance tools. `/settings/access` is presented as **Roles & Permissions**, with authority/persistence summary cards and a compact role-by-permission switch matrix. The existing hierarchy, sensitive-grant restrictions, save action, RLS and audit behavior remain authoritative.

The chat landing page is now an inbox-style workspace for joined conversations, discoverable channels, direct messages and channel creation. Message bubbles distinguish the current user from other participants and retain replies, reactions, reporting and attachment links. At the Block 12 delivery stage, chat still used authenticated four-second polling; Block 14 supersedes that transport with private Realtime subscriptions, presence, typing and live unread notification updates. Web Push and native mobile push remain outstanding. See `docs/blocks/BLOCK-12.md` for validation and boundaries.


## 21. Integration Control Centre (Block 13)

Block 13 upgrades `/settings/integrations` into the organisation-scoped Integration Control Centre. Administrators with `settings.manage` can run real database, Storage bucket, Supabase Auth Admin and Realtime channel checks. Results include latency and diagnostic history in `integration_check_runs` (migration 0018). The page distinguishes calendar OAuth credentials from linked provider accounts and sync errors, surfaces cron heartbeat and email outbox health, and labels future providers as not integrated until implemented. A passing Realtime handshake verifies the transport only; chat still uses polling until a later realtime-chat block. See `docs/blocks/BLOCK-13.md` and the Block 13 section in `RUNBOOK.md`.

## Block 14 — Real-time chat and notification infrastructure

Block 14 adds private Supabase Realtime chat topics with membership-based topic authorization, message/reaction subscriptions, online presence, typing indicators, channel read receipts, live unread notification counts, in-app notification toasts and opt-in browser desktop alerts. Apply `supabase/migrations/0019_realtime_chat_notifications.sql` before deploying. Desktop alerts use the browser Notification API while OPDesk is open; they are not Web Push or native mobile push.

See [`docs/blocks/BLOCK-14.md`](docs/blocks/BLOCK-14.md) for deployment checks, security boundaries and remaining work.


## Block 15 — Business workflow automation & SLA execution

Block 15 wires leave, timesheet and quality business events; adds scheduled task deadline, pending-timesheet and incomplete-attendance scans; and adds validated event-target notification routing. See `docs/blocks/BLOCK-15.md`. Apply migration `0020_business_workflow_sla_execution.sql` before deployment.

## Block 16 — Advanced workflow approvals
- Adds typed manager notifications and manager-routed approval actions, durable approval cases, an Approvals inbox decision flow, and bounded manager-chain escalation.
- Apply `supabase/migrations/0021_advanced_workflow_approvals.sql` before deploying.
- Approval routing requires employee `manager_id` relationships; escalation is capped at three hops with a 24-hour follow-up window.
- See `docs/blocks/BLOCK-16.md` for security boundaries and remaining limitations.

## Block 17 — Integrations, instant permissions, Operations Center, animated login
- Repairs the Block 16 audit blockers: build, migrations 0009/0010/0014 via `0022`, authenticated realtime, CSV hardening, tests.
- Adds WhatsApp, web push, Slack/Teams, signed outbound webhooks, Meta Lead Ads and Razorpay inbound, and anonymous analytics (`0023`). Everything goes through a durable outbox; no amounts ever leave the app.
- Adds the OPDesk-style instant-save Roles & Permissions matrix, the `/operations` Operations Center, and the animated VSM login.
- See `docs/blocks/BLOCK-17.md` for what to run on live and what was verified.

## Block 18 — Chat & Windows notifications, live sync & clock, posts/teams, demo team, passwords, protected Super Admin, Docker
- Live chat inbox badge and Windows desktop/push notifications, an installable app, and live sync on key pages.
- A clock that ticks from the second you clock in.
- Automatic employee IDs; company posts → departments → SEO/Editing/Developers teams → chat groups.
- A one-click demo team of 5, per-employee password reset, a `/status` connection test, and exactly one Super Admin that nobody can remove.
- Local Docker stack: `./scripts/local-up.ps1 -Email you@vsmgrowth.com`. See `docs/blocks/BLOCK-18.md`.

## Blocks 19–23
Hardening (error log, rate limits, CI, Playwright), field attendance (geofence, selfie, offline), Indian payroll (PF/ESI/PT/TDS, payslip PDF, bank file, Form 16 data, RazorpayX confirmation), Google Workspace (two-way Calendar, Drive, Gmail) and VSM Scholars (pipeline, batches, fees, receipts, QR-verified certificates). See `docs/blocks/BLOCKS-19-23.md`.

## Blocks 25–27
OKRs, KPIs per post (auto from tasks/attendance/CRM/Scholars), 360° reviews and training (`/growth`); a permission-aware Claude assistant (`/assistant`); and on-demand + scheduled reports with an accountant pack (`/reports`). See `docs/blocks/BLOCKS-25-27.md`.
