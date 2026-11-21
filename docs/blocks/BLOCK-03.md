# Block 03 — HRMS completion: documents, letters, probation and exit clearance

**Status:** implemented in source; migration, RLS suite, typecheck and production build still require execution in a complete development environment. Do not mark production-ready until every validation gate passes.

## Delivered

- **Private employee documents** in the private `employee-private` Supabase Storage bucket. Supports PDF, JPG, PNG, WEBP and Word documents up to 10 MB, document categories, expiry metadata, employee/org-bound storage paths and five-minute signed download URLs.
- **Employee document controls** in Employee 360 → Documents. HR can upload/delete; employees can view only their own documents; permitted team visibility is enforced by RLS.
- **Employment letters** in Employee 360 → Letters: Offer, Appointment, Experience and Relieving records. Each issue stores a dated employee-data snapshot and unique reference number. Issued letters can be opened in a print layout and saved as PDF through the browser print dialog. Experience and relieving letters require the employee status to be EXITED.
- **Database-controlled probation state transitions** through `submit_probation_review` and `decide_probation_review` RPCs; confirmation/notice employee status and review approval are committed in one transaction. Direct client updates to review decisions are revoked.
- **Probation review workflow** in Employee 360 → Probation: HR creates a due-dated review, submits it, and records Confirm, Extend or Exit decision. Confirm moves the employee to ACTIVE; Exit moves the employee to NOTICE; Extend keeps PROBATION and requires a next review date.
- **Exit clearance** in Employee 360 → Exit clearance: HR creates Manager, IT, Finance, HR, Admin or Other clearance items and records completion. Employees can view their own clearance list but cannot change it.
- **Organization-boundary guards** verify every employee, uploader, reviewer, approver, clearance owner/completer and letter issuer/revoker belongs to the same organization.
- **Audit events** for document issue/removal, probation changes, exit-clearance changes and employment letter issue/revocation.
- **RLS coverage** for employee-owned records, HR management and private Storage object access. Added scratch-test Storage schema shim and RLS assertions.

## Files

- `supabase/migrations/0009_hr_documents_probation_exit.sql`
- `supabase/all_migrations.sql`
- `src/app/(app)/people/actions.ts`
- `src/app/(app)/people/[id]/page.tsx`
- `src/app/(app)/people/[id]/letters/[letterId]/page.tsx`
- `src/app/(app)/people/[id]/letters/[letterId]/print-button.tsx`
- `tests/db/00_supabase_shim.sql`
- `tests/db/security.sql`

## Apply

- Existing deployments that have migrations 0001–0008: apply **only** `supabase/migrations/0009_hr_documents_probation_exit.sql` after validating it on scratch/staging.
- New empty deployments: use `scripts/migrate.sh` or the regenerated `supabase/all_migrations.sql`.
- Migration creates/configures the private Storage bucket and policies. Confirm Supabase Storage is enabled in the project.

## Validation status

- Added database assertions for employee-vs-employee document, probation, exit and letter isolation; private Storage object isolation; and HR visibility.
- TypeScript typecheck and Next.js build have not been run in this workspace because project dependencies are not installed.
- PostgreSQL migration/RLS suite has not been run in this workspace because a local PostgreSQL client/server is unavailable.
- Browser PDF output, signed URL expiry and live Supabase Storage policies need staging smoke tests.
- Do not deploy migration 0009 until `npm ci`, unit tests, typecheck, production build and `npm run test:db` pass.

## Known limitations / next work

- Letter output is print-ready HTML; PDF creation is performed by the browser's **Print → Save as PDF**, not a server-side PDF renderer. Confirm approved legal templates, company address, authorized signatory and letter clauses before issuing real documents.
- Salary, bank and PAN fields are not added to employee profile in this block. They remain restricted to the existing payroll/salary permissions and must not be copied into letters.
- Document expiry reminders, reusable onboarding templates, manager-assigned clearance ownership, automated exit gating and a transactional probation decision RPC remain future hardening work.
- Next roadmap block: Finance and expenses (claims, reimbursement workflow, vendor/client payments, budgets and reconciliation).
