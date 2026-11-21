# Block 07 — Executive ERP & organisation reporting

## Delivered

- Permission-gated `/executive` leadership workspace.
- Date-bounded reporting period with validation and organisation-timezone defaults.
- Workforce by department, delivery portfolio, task throughput and CRM pipeline sections, each shown only when the signed-in employee has the relevant underlying permissions.
- Financial section is independently gated by `finance.view`; it reports recorded client receipts, paid expenses, issued invoices and a deliberately limited cash-movement calculation. Payroll is excluded.
- CSV export at `/executive/export`, with date filters, per-section permission checks, CSV formula-injection protection, and `no-store` response headers.
- `executive.view` permission added to the catalogue and seeded for ADMIN and OPERATIONS_MANAGER roles in existing and newly created organisations.
- Supporting date/status indexes for reporting queries.

## Important accounting boundaries

The executive financial panel is not a statutory P&L, balance sheet, cash-flow statement, or audited management account. It is a limited operational cash summary: invoice receipts less paid `finance_expenses`. It excludes payroll, standalone vendor payments, bank fees, tax liabilities, accruals, credit notes, refunds and other accounting adjustments. Do not use it for statutory filing or financial close.

## Security model

- Executive access is gated by `executive.view` at the page and export route.
- People, projects, tasks and CRM data are fetched only when the current user has the corresponding permissions.
- Finance metrics are separately gated by `finance.view` and remain subject to table RLS.
- No payroll tables or salary values are queried by this module.
- The feature does not grant broader access to employee PII or finance records.

## Validation

Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:db` in an environment with dependencies and a PostgreSQL/Supabase test database. This development environment may not have those dependencies/services available; do not mark those checks passed unless actually executed successfully.
