# CLAUDE.md — rules for AI agents working on VSM Growth Operations

Read this before touching anything. These rules exist because an earlier change replaced working modules with stubs that queried non-existent tables, deleted the app layout and server actions, and shipped a migration that could not run. Don't repeat that.

## What this is
Internal operating system for VSM Growth and VSM Scholars (Meerut & Noida, India). People, attendance, leave, tasks, daily updates, performance, payroll, CRM, notifications, access control and audit.
**Stack:** Next.js 15 App Router (server components + server actions) · TypeScript 5.9 (strict) · Supabase Postgres, Auth and RLS · Brevo or Resend email · Vercel.

## Non-negotiable rules
1. **Security lives in Postgres.** Every table has RLS. Permission checks use `has_perm()`, `can_view_*()`, `is_in_my_team()` and `can_manage_role()`. UI checks (`can()`, hidden buttons) are cosmetic only. A new feature isn't done until its RLS policies exist and are tested.
2. **The app queries as the signed-in user** (`supabaseServer()`). `supabaseAdmin()` (service role) is allowed only in `api/public/enquiry`, `lib/email/worker.ts` and invites in `people/actions.ts` *after* `requirePerm`. Never add another use without an explicit reason in the PR.
3. **Never query a table that doesn't exist.** Check `supabase/migrations/` first. Real table names include `attendance_events` (not `attendance`), `payroll_entries` (not `salary_slips`), `leave_requests` and `leave_types` (not `leave_balances`), and `employees` + `employee_directory` (not `team_members`).
4. **Don't delete working code to "simplify".** Keep `src/app/(app)/layout.tsx`, every `actions.ts`, the engines in `src/lib/engines/*` and the Block 1 pages. Extend them; don't replace them.
5. **Migrations are append-only.** Never edit an applied migration; add `NNNN_description.sql`. Each must apply cleanly on top of all previous ones (`npm run test:db` proves it). Functions in index predicates must be `IMMUTABLE` (`now()` is not).
6. **No policy recursion.** If policy A reads table B and B's policy reads A, Postgres raises "infinite recursion". Wrap the cross-table check in a `SECURITY DEFINER` helper (see `is_project_member`, `payroll_run_released`).
7. **Salary privacy.** Only the employee themself and `payroll.view_all` / `payroll.approve` holders may read salary or payroll rows. Managers never inherit salary visibility. Emails never contain amounts. Every salary view calls `log_salary_access`.
8. **Hierarchy.** Role levels live in `role_settings` (Super Admin = 100, always all permissions). You can only manage roles strictly below your level, only grant permissions you hold, and payroll/salary/roles/audit/settings permissions are Super-Admin-only. Per-person overrides (GRANT/DENY) are Super-Admin-only. The last Super Admin can't be removed. Don't weaken any of this.
9. **No arbitrary code execution.** No `RUN_SQL`, `eval` or user-defined HTTP calls in automations. Use allow-listed actions only.
10. **Money.** INR (₹, `en-IN`), integer paise in the payroll engine. Statutory deductions (PF/ESI/PT/TDS) are not auto-calculated; they're entered as approved deductions after a CA reviews them.
11. **Time.** Store UTC, display `Asia/Kolkata` via `src/lib/engines/time.ts`.
12. **Never fabricate.** No mock data, no "would appear here" placeholders, no claiming an integration works without testing it. Don't claim tests passed unless you ran them.
13. **Secrets.** Never commit `.env.local`. Never print keys. Never prefix a secret with `NEXT_PUBLIC_`.
14. **Dependencies.** Add a package to `package.json` before importing it (an earlier change imported `lucide-react` without installing it, which broke the build). Keep `typescript@5.9`; TS 7 breaks Next 15.

## Layout
```
supabase/migrations/   0001 foundation · 0002 workforce · 0003 performance+payroll · 0004 CRM+notifications · 0005 payroll adjustments · 0006 access hierarchy
src/lib/engines/       pure, unit-tested logic: attendance.ts performance.ts payroll.ts time.ts
src/lib/data/          server loaders that feed engines (run under RLS)
src/lib/email/         templates.ts · providers.ts (Brevo/Resend) · worker.ts (outbox drain)
src/lib/auth.ts        getContext/requireContext/requirePerm/can — reads my_context() from the DB
src/lib/perms.ts       permission catalogue shown in the UI (must match DB strings)
src/app/(app)/         authenticated pages; each mutating page has an actions.ts (zod-validated server actions)
src/app/api/           public/enquiry · cron/email · reports/* (CSV, permission-checked)
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
