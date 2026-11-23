# OPDesk ERP Master Specification — Integration Audit

**Project:** VSM Growth Operations (OPDesk)  
**Baseline reviewed:** `vsm-ops` ZIP supplied with the master development prompt  
**Review date:** 21 November 2026  
**Purpose:** Map the requested enterprise ERP scope onto the existing application without replacing its working architecture.

> This document is an implementation map, not a claim that every requested module is already built. Items marked “partial” or “missing” must be implemented and tested before the ERP can be considered complete.

## 1. Existing architecture — retain it

The repository is an existing Next.js 15 App Router application using React 19, TypeScript, Supabase Auth, PostgreSQL, row-level security (RLS), SQL migrations, server actions, and Vercel deployment configuration. Email delivery is routed through an outbox/worker with Brevo or Resend configuration.

**Recommendation:** continue with this stack. Do not introduce Prisma or a second database layer unless a specific migration need is demonstrated. Keep Supabase as the source of truth and preserve the current server-side authorization and RLS design.

Important existing implementation areas:

- `src/lib/auth.ts`, `src/lib/perms.ts`, `src/lib/actions.ts` — authentication, permission checks and action helpers.
- `src/lib/supabase/` — server/admin Supabase clients and cookie handling.
- `src/lib/engines/attendance.ts`, `payroll.ts`, `performance.ts`, `time.ts` — deterministic business rules.
- `supabase/migrations/0001`–`0009` — organization, employee, access, workforce, payroll, performance, CRM, notifications and integration schema.
- `src/app/(app)/` — existing protected application routes.
- `src/app/api/` — public enquiry, cron and attendance/payroll reporting endpoints.

## 2. Scope coverage

| Master requirement | Existing baseline found | Assessment / work still required |
|---|---|---|
| Executive dashboard | `/dashboard`; queries employees, attendance, tasks, projects, leads, payroll and audit where permitted | **Partial.** Expand with database-backed trend series, revenue/expense and profitability metrics; add robust empty/error states and date filters. |
| Employee management | `/people`, Employee 360, departments/managers, role and employment fields, lifecycle history, private document storage and printable employment letters | **Partial.** Add secure bank/identity field-level controls, skills/qualifications and document retention/expiry automation. |
| HR management | Employee records, recruitment pipeline, candidate conversion, onboarding checklist, employment events, private employee documents, probation reviews, employment letters and exit clearance | **Partial.** Add reusable onboarding templates/reminders, HR case tracking, document expiry automation and transactional probation/exit gates. |
| Attendance & workforce | `/attendance`, punch card, SQL `record_attendance`, shift and holiday administration, correction workflow, attendance engine | **Partial / strong foundation.** Validate GPS/mobile options, work-location policy, overtime, correction audit and payroll reconciliation end-to-end. |
| Payroll engine | Salary structures, payroll runs, adjustments, attendance/LOP synchronization and explainable calculation engine | **Partial / strong foundation.** Add configurable effective-dated statutory rules only after India payroll/legal review; strengthen arrears, loan/advance recovery, revision and reconciliation flows. |
| Salary & payslips | Employee salary route, protected payslip route, print layout, release checks and salary-access audit | **Partial.** Print-to-PDF is not the same as server-generated archived PDF. Add PDF artifact generation, reference numbers, masked identity/bank data, reissue history and email publication workflow. |
| Finance & expenses | Block 04: expense/reimbursement submission, private receipts, manager + finance approvals, payment records, vendors, client invoices/receipts, department/project budgets, bank statement matching/closing, reports and CSV ledger export | **Partial.** Add bank-feed/CSV import, AP purchase orders/bills, multi-line invoice PDF/GST workflows, automated payment integrations, XLSX/PDF reports and CA-approved accounting policy. |
| Projects & operations | Block 05: project workspaces, team roster, milestones, delivery updates, task roll-up, project time entries/approvals and Finance-linked paid costs/cash receipts | **Partial.** Add dependencies, subtasks, deliverable versioning, project documents, advanced capacity planning and profitability forecasts. |
| Task management | `/tasks`, assignment/status/review, task events and project-linked task roll-up; project time logs are implemented in Block 05 | **Partial.** Add subtasks, dependencies, recurrence, task attachments/comments and a complete task activity timeline. |
| Performance & productivity | Performance policy, weighted criteria, snapshots, manager reviews, quality review and performance pages | **Partial / strong foundation.** Add self-assessment, review history and transparent manager calibration; keep attendance/task count from becoming sole score drivers. |
| Client & CRM | `/leads`, lead activity, public enquiry intake and client schema | **Partial.** Add full client account/contact pages, pipeline stages, proposal/contract history and project linkage. |
| Communication & announcements | Blocks 05–06: direct/group messaging, public/department/project channels, replies, emoji reactions, private attachments, read timestamps, targeted/pinned announcements, message reporting, moderator queue, message hide/restore, controlled membership changes, channel archive/leave and moderation audit events. Chat polls every four seconds. | **Partial.** WebSocket push, typing/presence, mobile push, retention/legal hold and full abuse analytics remain. Notifications and chat are now separate but integrated. |
| Leave & holidays | `/leave`, leave requests/types, approval functions, holiday and shift configuration | **Partial / strong foundation.** Verify balances/accruals, optional holidays, multi-step approvals and payroll synchronization for paid/unpaid and half-day leave. |
| Recruitment & onboarding | Candidate pipeline, interview scheduling/feedback, atomic candidate-to-employee conversion and onboarding checklist | **Partial.** Add candidate CV upload/communication, candidate-side offer sign-off, reusable onboarding templates and automated notifications. Employee letter records are available in Employee 360. |
| Documents & compliance | Private employee Storage bucket, metadata, organization/employee-bound paths, RLS, short-lived signed URLs and printable employment letters | **Partial.** Add expiry reminders, retention/legal hold, document versioning and server-side PDF archiving. |
| Reports & analytics | Attendance/payroll API reports and personal performance analytics | **Partial.** Build role-scoped report centre, filters, CSV/XLSX/PDF exports and the missing finance/project/HR reports. |
| Settings & integrations | Access control, roles, attendance settings, audit logs and Block 13 Integration Control Centre with database, Storage, Auth Admin and Realtime diagnostics, calendar OAuth readiness, cron heartbeat, email outbox and check history | **Partial / strong foundation.** Add organization profile, payroll policies, document settings, notification templates, webhook management and incident/SLA views. |

## 3. Security and payroll decisions to preserve

1. Database RLS and server-side permission checks remain authoritative. Hiding a link or button is never an authorization control.
2. Salary access remains separate from manager/reporting-line access. Employees can access only their own released payslips; privileged salary access must be permission-gated and audited.
3. Payroll approval and payment are separate events. Approval must never automatically mark a salary as paid.
4. Preserve the payroll engine's integer-paise arithmetic and explainable line items.
5. The current payroll engine deliberately does **not** auto-calculate PF, ESI, Professional Tax or TDS. Keep this safeguard. Statutory calculations require effective-dated, jurisdiction-aware rules, employee eligibility and professional validation before activation.
6. Payroll runs need immutable calculation snapshots, independent preparation/approval, controlled reopening, payment references, failure/reversal states and audit events.
7. Never place service-role keys or provider secrets in client-side code. Keep secrets server-only and retain the current email outbox/retry pattern.

## 4. Recommended implementation sequence

The sequence below is designed to deliver integrated vertical slices rather than disconnected screens.

### Phase 0 — Stabilize the current Block 1 baseline
- Install dependencies from the committed lockfile in a network-enabled environment.
- Run `npm run typecheck`, `npm test`, `npm run build` and the database/RLS test suite against a scratch Supabase-compatible PostgreSQL database.
- Apply and verify migrations 0001–0012 in order.
- Review Block 1 security, notification preferences, integrations health, shift administration and audit evidence.
- Resolve all failing checks before adding modules.

### Phase 1 — Employee 360, HR lifecycle and documents
- Employee 360, recruitment pipeline, interview scheduling/feedback, atomic hire conversion and onboarding checklist seed are implemented in Block 02.
- Block 03 adds private employee document storage, printable employment-letter records, probation review decisions and exit-clearance checklist workflows.
- Remaining: candidate-side offer acceptance, reusable onboarding templates/reminders, document expiry/retention automation, legal letter templates and atomic exit/probation transition RPCs.
- Continue granular permissions, RLS policies, audit events and tests with each migration.

### Phase 2 — Attendance, leave and workforce completeness
- Complete leave balances/accruals, optional holidays and approval hierarchy.
- Add overtime and location verification only where company policy requires it.
- Add correction and shift-change audit history.
- Prove attendance + approved leave -> payable days/LOP with database integration tests.

### Phase 3 — Payroll and finance
- Block 04 adds the Finance ERP vertical slice: private receipts, two-person expense approvals, payment recording, vendors, invoices, budgets, bank statement matching and CSV reports.
- Complete salary revisions, arrears, advances/loans, reimbursements and adjustments.
- Add statutory rule configuration with effective dates and eligibility; do not ship unverified statutory defaults.
- Add generated PDF payslip archive, masked details, reference IDs, reissue history and publication notifications.
- Remaining finance work: bank-feed import, purchase orders/AP bills, multi-line branded invoice/PDF and tax configuration, automated payment rails, vendor balances and XLSX/PDF exports.
- Keep all payment and approval transitions transactional, audited and separated by permission; finance migration 0010 is source-implemented but still requires scratch database/RLS verification.

### Phase 4 — Main VSM Operations Portal (Block 05 source implemented)
- Project workspaces, roster management, milestones, owners, due dates, project updates/risks/decisions and linked task roll-up.
- Project time logging and independent manager approval; Finance-linked paid costs and invoice cash receipts are visible only to Finance-authorized users.
- Direct/group chat, public/department/project channels, private attachments, replies, reactions, read timestamps and company/department/project announcements.
- Message and announcement notifications integrate with the existing in-app notification centre. Chat currently polls every four seconds; WebSocket push, presence and typing are not implemented.

### Phase 5 — Communication security and access controls (Block 06 source implemented)
- Harden membership mutation through permission-checked SQL RPCs; direct-message membership is immutable and self-join is limited to public/department channels.
- Add report submission, moderator-only queue, message hide/restore, report resolution, channel member management, channel archive/leave and moderation audit events.
- Extend the existing role matrix with sensitive chat administration permissions; preserve hierarchy/no-escalation rules and the existing role/override audit trail.
- Remaining: database RLS execution tests, full end-to-end testing, WebSocket/presence/typing, retention/legal hold and mobile push.

### Phase 6 — Executive insights and report centre (Block 07 source implemented)
- Add a permission-gated executive overview with date filters, workforce by department, delivery portfolio, task throughput and CRM pipeline.
- Gate finance metrics independently behind `finance.view`; the initial cash-basis indicators exclude payroll and explicitly disclose accounting limitations.
- Add a date-filtered CSV export with the same permission boundaries and spreadsheet formula-injection protection.
- Add `executive.view` to the role catalogue and seed it for ADMIN and OPERATIONS_MANAGER in existing and new organisations.
- Remaining: verified monthly trend aggregates, project profitability, attendance insights, PDF/XLSX exports, export audit records and full RLS/integration tests.

## 5. Definition of done for every module

A module is complete only when all applicable items exist:

- Database migration with foreign keys, constraints, indexes and organization scoping.
- RLS policies and server-side permission checks for every read/write path.
- Working UI, server action/API, validation and useful success/error/empty states.
- Audit events for sensitive changes and approval decisions.
- Notifications where a workflow requires them.
- Integration tests for allowed and denied roles, including cross-employee and cross-organization access.
- Unit tests for calculation/state-transition logic.
- Mobile-responsive employee workflows.
- Documentation for environment variables, migration order, setup and operational recovery.

## 6. Validation status of this handoff

- Repository ZIP was inspected and its existing routes, libraries, SQL migrations, package manifest and Block 1 notes were inventoried.
- `npm run typecheck` was attempted, but dependencies were not installed in the execution environment; TypeScript emitted missing-module/type errors beginning with missing `next`, React, Supabase and Vitest packages. This is an environment/dependency-install blocker, not evidence that the source itself passes or fails type checking.
- `npm ci --ignore-scripts` was attempted but did not complete before the execution timeout.
- Tests, production build and live database/RLS tests therefore remain **unverified**.
- No live Supabase project, production environment variables, provider credentials or deployed instance were supplied; no production database or deployment was changed.

## 7. Immediate next action

Complete Phase 0 validation against migrations 0001–0018 first. Once verified, proceed with expanded Executive ERP trends, profitability and the central report centre. Do not expose navigation links to unfinished modules or present placeholder data as live business metrics.

## Block 08 — Workforce collaboration layer

Added formal team and working-group structures, effective-dated shifts used by attendance reporting, task/project work-time allocation and approvals, quality assessments, calendar invitations and attendee responses, and meeting records. Attendance remains punch-based; time allocation remains a separate approved timesheet. Implementation and explicit non-goals are documented in `docs/blocks/BLOCK-08.md`.

## Block 09 — Advanced calendar, attendance, evidence and exports

- Month/week/day calendar navigation and bounded recurring meeting automation.
- Google Calendar and Microsoft Outlook OAuth with encrypted token storage, bidirectional rolling-window sync, private inbound event imports, duplicate mapping and scheduled sync.
- Asynchronous email invitations with an atomic queue claim, retry backoff and delivery status tracking.
- Mobile-responsive attendance clocking and task timer-based timesheets.
- Private quality assessment evidence with SHA-256 metadata and short-lived signed download URLs.
- Standardised CSV, XLSX and PDF reporting for attendance, time, finance, payroll and quality; RFC 5545 ICS calendar export.

## Block 10 — Workflow automation and SLA queue

Adds a tenant-scoped rule registry and durable run queue with idempotency, bounded retries, lock recovery, RLS and service-role worker contracts. UI builder, typed action execution and automatic event wiring remain follow-on work; see `docs/blocks/BLOCK-10.md`.


## Block 11 — Workflow builder and typed execution

- Added administrator workflow configuration at `/settings/workflows` with event selection, typed notification action, pause/enable and deletion.
- Task creation emits the first live `task.created` event. Event actor and organisation are verified by PostgreSQL; queue entries are idempotent.
- Service-role cron worker validates active tenant actor and writes deduplicated in-app notifications.
- Only `notify_actor` is executable in this block; remaining event keys are reserved until business modules emit them. No visual drag-and-drop editor, condition builder, email/webhook actions or manager escalation is claimed.

## Block 16 workflow approval capability
Workflow rules now support typed actor, target and manager notifications plus manager approval creation. Approval cases are durable, organisation-scoped and exposed in the Approvals inbox with assigned-approver decisions. The protected workflow cron escalates overdue cases through the employee manager hierarchy for at most three levels. See `docs/blocks/BLOCK-16.md` for constraints and deployment steps.
