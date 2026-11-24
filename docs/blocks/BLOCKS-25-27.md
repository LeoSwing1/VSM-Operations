# Blocks 25–27 — OKRs/KPIs/360°/training, AI assistant, scheduled reports

> Block 24 (client portal) was **dropped at your request** — nothing from it is in the code or the database.

## Run on live Supabase
1. SQL Editor → run `supabase/repair/catch_up.sql` (now 0001–0034; skips what's already there).
2. Run `supabase/diagnostics/health_check.sql` → the `0032 OKRs & KPIs`, `0033 AI assistant`, `0034 reports` lines must say `ok`, no `MISSING`/`ERROR`.
3. Vercel: add `ANTHROPIC_API_KEY` (optional, for the assistant) and redeploy. `vercel.json` gains a `/api/cron/reports` job every 15 minutes.

## Block 25 · Performance & growth (`/growth`, menu: Me → OKRs, KPIs & growth)
- **OKRs** — Indian financial-year quarters (Q1 = Apr–Jun). Company → team → personal objectives, each with 2–4 key results (number, %, ₹ or done/not done, weighted; "lower is better" works).
  - Check-ins update the value and confidence; the suggested confidence compares progress with time gone in the quarter.
  - Company and team OKRs are visible to everyone; personal OKRs only to the owner, their managers and HR.
  - Company OKRs need `okr.manage`; team leads/managers add team OKRs; anyone adds their own.
- **KPIs per post** — seeded from each post's KPI list. These are calculated automatically every night (and on *Recalculate*): tasks on time, tickets closed, leads contacted, conversions, Scholars admissions, plus *Days present* and *Daily updates* for everyone. The rest are entered by hand, and the manager verifies them (nobody verifies their own; verified values lock). Set monthly targets in *KPI setup*.
- **360° reviews** — HR creates a cycle, then *Open* generates self, manager, direct-report (upward) and same-team peer forms and notifies everyone.
  - Peer and upward feedback is anonymous, and comments only show once at least 2 people have responded.
  - People see their own summary only after HR closes the cycle; managers see their team's at any time; HR also sees who wrote what.
- **Training** — personal records; managers or HR can assign (with a notification) and verify completed training. Hours this year are shown.

## Block 26 · AI assistant (`/assistant`, Settings → AI assistant)
- **Ask Ops** chat (Hinglish/English/Hindi): tasks, attendance today, daily updates, leads and follow-ups, projects, leave, OKRs, KPIs, Scholars pipeline, outstanding invoices.
- **Summarise daily updates** for managers, and **draft a client update** (monthly report / email / WhatsApp) from a project's milestones and updates — you always review and send it yourself.
- Safety:
  - It reads data with the signed-in person's own access (row-level security), so it can never see more than they can.
  - It's read-only.
  - It has **no access to payroll, salaries, bank or tax details**.
  - Chats are **not stored** — only token counts.
- Off by default. Settings → AI assistant: switch on, model (`claude-sonnet-5-5`), monthly token budget (default 3M) and requests per person per day (default 40). Interns don't get `ai.use` by default.

## Block 27 · Reports & BI (`/reports`)
- **Reports:** attendance summary, task delivery, CRM funnel, management P&L, VSM Scholars admissions and KPI summary. Each needs its own permission (for example, P&L needs `finance.view`).
- **Run now** (Excel, PDF or CSV), or **schedule** daily, weekly or monthly in IST:
  - a weekly run covers last Monday–Sunday; a monthly run covers the previous month
  - recipients are re-checked at delivery, so anyone who lost access is skipped
  - the notification and email carry **only a download link**, never figures
- **Accountant pack:** one Excel file per month with sales register (client GSTIN), receipts, expenses, vendor payments, Scholars fees and payroll **totals** (only with `payroll.export`; never per person).
- Files sit in a private `reports` bucket; every download is audited.
- **Before using the P&L:** it is a management view (invoices on accrual, fees and payments on cash), not a statutory P&L. Add client GSTINs in the client records so the sales register is complete.

## Verified in this workspace
- `tsc` 0 errors · Prettier ✓ · `next build` ✓
- Vitest **164/164** (+9: FY quarters, OKR progress maths, KPI status, CSV/XLSX/PDF report files, multi-sheet workbook, AI tool list has no payroll tools, chat history trimming).
- PostgreSQL 16: **381/381** security checks in normal *and* strict-grant mode (+50). The new checks cover:
  - OKR visibility and check-in rights
  - auto vs manual KPIs, and self-verification blocked
  - 360° anonymity and release timing
  - training verification
  - the AI on/off switch and daily limits; usage rows can't be faked
  - report permissions, schedule timing and periods
  - link-only report emails
  - accountant pack access
- A copy of a live database at 0031 with no automatic grants: `catch_up.sql` applies 0032–0034 cleanly, a re-run is a no-op, and the health check shows no MISSING or ERROR lines.
- Playwright **16/16** public tests (desktop and mobile), including the new protected routes.

**Not verified here:**
- real Claude API calls (needs your key)
- signed-in page rendering of the new screens (needs a staging login)
- the scheduled cron on Vercel
