# Block 04 — Finance ERP

**Status:** Source implementation added. Not production-verified until migration, RLS tests, TypeScript typecheck, unit tests and production build pass in a dependency-complete environment.

## Scope delivered

- Employee expense and reimbursement submission with receipt upload (PDF/JPG/PNG/WEBP, max 10 MB).
- Private `finance-receipts` Supabase Storage bucket and short-lived signed receipt route. Receipt metadata/path is tied to the submitting employee and organization.
- Two-person approval chain: submitter → manager/team approval → finance approval → payment. The submitter cannot approve their own claim, and the manager-stage approver cannot also complete the finance stage.
- Expense payment evidence: date, method, unique reference and payer; payment is an RPC-only state transition.
- Vendor directory and vendor payment ledger.
- Client invoice draft creation with a line item, controlled issue action, partial/full receipt recording and outstanding-balance calculation.
- Department/project budget allocations with approved-spend comparisons.
- Bank reconciliation batches and statement lines. Matching validates ledger record, amount and debit/credit direction; closing requires all lines matched and the opening + net movement to equal the closing balance.
- Finance overview, date-filtered management reports and combined income/expenditure CSV export.
- Audit records for expense, invoice, vendor, payment, budget and reconciliation events.

## Database and security

- Migration: `supabase/migrations/0010_finance_erp.sql`.
- Tables: `vendors`, `finance_expenses`, `client_invoices`, `invoice_lines`, `invoice_payments`, `vendor_payments`, `department_budgets`, `bank_reconciliations`, `bank_statement_lines`.
- Views: `finance_monthly_summary`, `finance_invoice_balances` (security-invoker views).
- RPCs: `finance_expense_decide`, `finance_mark_expense_paid`, `finance_issue_invoice`, `finance_record_invoice_payment`, `finance_match_statement_line`, `finance_close_reconciliation`.
- Sensitive permissions: `finance.view`, `finance.manage`, `finance.approve_manager`, `finance.approve_all`, `finance.approve`, `finance.pay`, `finance.export`. Finance permissions are Super-Admin-granted sensitive permissions. The default `ADMIN` role receives the complete finance set in migration 0010; custom finance users should receive only their required permissions.
- New organization-owned tables have RLS. Trigger guards validate organization ownership for employees, departments, projects, clients, vendors, invoices, expenses, payments and reconciliation records.
- Sensitive state changes are RPC-only; direct table update privileges are revoked for expense state, invoice state, payment rows and bank statement matching/closing.
- Employee expense reads are self-only; managers see direct/reporting team claims only with manager permission; finance roles see the finance register. Receipt storage access follows the expense row's RLS scope.

## Routes and files

- `/finance` — finance overview and key totals.
- `/finance/expenses` — submit and review expenses/reimbursements; employee self-service is also linked as “My expenses”.
- `/finance/invoices` — create/issue invoices and record client receipts.
- `/finance/vendors` — vendors and vendor payments.
- `/finance/budgets` — department/project budgets vs approved spend.
- `/finance/reconciliation` — statements, matching and close checks.
- `/finance/reports` — date-filtered income/expenditure summaries and CSV export.
- `/api/finance/receipt/[id]` — 60-second RLS-checked signed receipt download.
- `/api/reports/finance` — finance-export-permission CSV ledger.
- `src/app/(app)/finance/actions.ts`, finance route pages, `src/lib/perms.ts`, `src/components/shell.tsx`.

## Tests added

- `tests/db/security.sql` includes employee claim isolation, private receipt isolation, direct-update denial, manager/finance separation, payment state, invoice issue/receipt, statement matching/closing and cross-organization vendor reference denial.
- `tests/db/00_supabase_shim.sql` includes the minimum Storage extension helper needed by the scratch PostgreSQL test harness.

## Validation performed / not performed

- TypeScript transpile parser: all 91 `.ts`/`.tsx` source files parsed with zero syntax diagnostics.
- `tsc --noEmit` was attempted, but dependencies are absent in this environment. It reported missing Next.js, React, Supabase, Vitest and Node type modules; this is not a passing typecheck.
- `npm test`, `npm run build` and `npm run test:db` were not run successfully. PostgreSQL client/server and Docker are unavailable here; migration execution and RLS tests remain unverified.
- `supabase/all_migrations.sql` is regenerated from migrations 0001–0010.

## Deliberate limitations / follow-up

- Payments are manually recorded; no bank/payment gateway integration or automatic bank-feed import is configured.
- Statement lines are entered manually; CSV bank-statement import, duplicate detection across bank feeds and bank-account master data are future work.
- Reimbursements are paid through the expense payment ledger and are not automatically added to payroll runs. Vendor payment records are a payment ledger, not a full purchase-order/AP bill workflow; invoice/expense linkage and vendor outstanding balances need a later AP subledger.
- Invoice UI currently creates one line per draft; multi-line editing, branded PDF generation, tax/HSN/GST configuration, credit notes, recurring invoices and email dispatch need follow-up.
- Reports export CSV only. XLSX/PDF exports and richer monthly trend charts remain future work.
- The report shows client receipts, approved expense claims and vendor payments as distinct streams. Where a vendor payment also corresponds to an expense claim, avoid double-counting cash outflow without a reviewed accounting policy.
- Configure currency, GST/TDS treatment, invoice terms, expense categories, approval limits and accounting treatment with VSM Finance/CA before production use. No tax rates or statutory accounting assumptions are hardcoded.
- Add a dedicated Finance Manager role only through a separately reviewed role-enum/hierarchy migration; currently Finance access is granted through granular sensitive permissions.

## Apply and verify

1. Back up staging and apply `0010_finance_erp.sql` after 0001–0009.
2. Ensure Supabase Storage is enabled; confirm private `finance-receipts` bucket and 10 MB MIME restrictions.
3. Configure Finance permissions through Super Admin. Confirm the default Admin role has the finance permission set.
4. Test as employee A/B, manager, finance reviewer, payment operator, Admin and Super Admin. Verify own/team/org boundaries and two-person approvals.
5. Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:db` before deploying.
6. Use staging bank references only. Do not load live bank statements or actual employee receipts into the test fixture.

## Next block

**Block 05 — Projects & Operations:** project/client 360, milestones, deliverables, dependencies, time logs, project costs/revenue and profitability; integrate approved expenses and client invoices without double-counting.
