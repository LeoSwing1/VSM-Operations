# Block 02 — Recruitment and HR lifecycle foundation

**Status:** implemented in source; database and application verification pending an environment with complete dependencies and PostgreSQL.

## Delivered

- Recruitment pipeline at `/recruitment`, visible only to users with `recruit.view` or `recruit.manage`.
- Candidate creation with contact information, applied role, department, source, recruiter and notes.
- Candidate stages: Applied, Screening, Interview, Offer, Hired, Rejected and Withdrawn. Candidate stage changes are written to the immutable audit log.
- Interview scheduling with organization-local timezone conversion, interviewer, type, score, result and feedback.
- Atomic candidate-to-employee conversion through `hire_candidate`. It creates the employee in probation, preserves the candidate-to-employee link, records joining and probation history and seeds five onboarding checklist items in the same database transaction.
- Employee 360 now includes an onboarding tab with progress, HR checklist authoring/removal and employee/authorized-HR checklist completion. Completion-only column grants prevent checklist text edits by employees.
- Employment event history for joining, probation, status changes, department transfers and designation changes.
- Organization-boundary trigger guards for candidate departments/owners, interviewers/candidates and onboarding employee references.
- RLS policies for candidates, interviews, lifecycle history and onboarding checklist items.
- `recruit.view` and `recruit.manage` permissions are seeded for Admin and HR Manager in existing and newly created organizations.

## Files

- `supabase/migrations/0008_hr_recruitment.sql`
- `src/app/(app)/recruitment/page.tsx`
- `src/app/(app)/recruitment/actions.ts`
- `src/lib/perms.ts`
- `src/components/shell.tsx`
- `tests/db/security.sql`
- `supabase/all_migrations.sql` (regenerated aggregate)

## Apply

Existing deployments: apply **only** `supabase/migrations/0008_hr_recruitment.sql` after migrations 0001–0007.

New empty deployments: use the regenerated `supabase/all_migrations.sql`.

## Validation

- Recruitment RLS, interview isolation, atomic hire, duplicate-hire rejection, onboarding seed and lifecycle-event checks have been added to `tests/db/security.sql`.
- `npm run typecheck` cannot currently complete because the checked-out `node_modules` contains incomplete/empty type-package folders (`@types/node`, React, Chai, etc.).
- `npm ci --ignore-scripts --no-audit --no-fund` timed out in this execution environment. `npm test` could not start because `vitest` is not installed, and no Postgres client/server is installed here, so the SQL suite and migration application were not run.
- Do not deploy migration 0008 or expose recruitment to production users until the migration and test suite pass against a scratch Supabase-compatible PostgreSQL database.

## Remaining in Phase 1

- Employee profile bank/identity details with field-level restrictions.
- Private employee document storage and expiry tracking.
- Offer/appointment/experience/relieving letter generation.
- Checklist templates, reusable onboarding plans and automated due-date reminders.
- Probation review and confirmation workflow.
- Resignation, exit clearance and relieving workflow.
