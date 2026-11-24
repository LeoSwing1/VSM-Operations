# VSM Growth Operations — what's done and what's due
_Updated 24 Nov 2026, after Blocks 25–27 and the people/KYC update (Block 24 client portal dropped)._

## Live database checklist
- [ ] Run `supabase/repair/catch_up.sql` in the SQL Editor. It applies all missing migrations through 0035 and the table access grants in one transaction.
- [ ] Run `supabase/diagnostics/health_check.sql` and confirm there are no `MISSING` or `ERROR` lines.
- [ ] **Backups:** the project is on the Supabase **Free** plan, which shows "No backups". Upgrade to Pro (daily backups + optional PITR) before real payroll data, or schedule a nightly `pg_dump`.
- [ ] Compute is **Nano** with RAM at about 60% and 24/60 connections. Move to Micro or Small before onboarding the whole team.
- [ ] Vercel env: `APP_URL`, `CRON_SECRET`, `BREVO_API_KEY`/`EMAIL_FROM` (welcome and reset emails), VAPID keys (Windows push), `DEMO_EMAIL_DOMAIN`.
- [ ] Optional for Blocks 21–22: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CALENDAR_TOKEN_ENCRYPTION_KEY`; `EMAIL_PROVIDER=gmail` if Gmail should send.
- [ ] Optional for Block 26: `ANTHROPIC_API_KEY`, then Settings → AI assistant → switch on.
- [ ] Supabase Auth → URL configuration: Site URL = `APP_URL`; redirect URLs `APP_URL/auth/callback` and `APP_URL/login/reset`.

## Done (Blocks 1–23, 25–27)
- **Foundation:** auth, RBAC with levels and overrides, one protected Super Admin, audit log, HttpOnly sessions, RLS on every table.
- **People and HR:**
  - Employee 360, auto employee IDs, company posts → departments → teams → chat groups
  - onboarding, documents, letters, probation, exit, recruitment
  - welcome emails, password reset, temporary passwords, activity timeline
- **Attendance and time:** live clock, breaks, corrections, shifts, holidays, timesheets, calendar, meetings.
- **Work:** tasks, daily updates, projects and milestones, approvals with SLA and escalation, workflow builder with execution worker.
- **Money:** payroll runs and adjustments, payslips (no amounts in any message), finance ERP (expenses, invoices, reconciliation), Razorpay matching with human confirmation.
- **CRM:** leads, website/Meta enquiries, follow-ups.
- **Communication:**
  - chat with presence and typing, moderation, chat inbox badge
  - notifications: in-app, email (Brevo/Resend), WhatsApp, web push and Windows notifications; Slack/Teams; signed webhooks
- **Operations Center:** live attendance, teams, CRM tiles, communication, queues, workers, health, audit — all live-synced.
- **Admin:** instant-save permission matrix, integration control centre, demo team, login and connection tests, `/status`.
- **Hardening (19):** server error log with secret scrubbing, DB-backed rate limits on sign-in/forgot/status, offline page, GitHub Actions CI, Playwright desktop + mobile.
- **Field attendance (20):** office geofence (off/warn/enforce), selfie at clock-in (private bucket), offline punch queue with a time window, flagged-punch review.
- **Indian payroll (21):** EPF/EPS/ESI/PT/TDS engine (new regime FY 2026-27), payslip PDF, NEFT/RTGS bulk CSV, Form 16 data CSV, RazorpayX payout confirmation, masked PAN/bank details.
- **Google Workspace (22):** two-way Calendar queue, Drive copy for employee documents, Gmail as sender.
- **VSM Scholars (23):** counselling pipeline, referrals/affiliates, batches and class attendance, fee instalments with receipts, certificates with QR + public `/verify`.
- **Performance & growth (25):** OKRs (FY quarters, company → team → personal, check-ins), KPIs per post with nightly auto values + verified manual ones, 360° reviews with anonymous peer/upward feedback, training records.
- **AI assistant (26):** permission-aware "Ask Ops" chat, daily-update summaries, Hinglish client report/email/WhatsApp drafts; budget and daily caps; no payroll access; chats not stored.
- **Reports & BI (27):** 6 reports (attendance, task delivery, CRM funnel, management P&L, Scholars admissions, KPI summary) on demand or scheduled in IST; link-only emails; monthly accountant pack.
- **People & KYC (28):** profile fix, 2 owners, HR/manager onboarding rights, no deletes for employees, owners/admins in every group, KYC form + documents + HR verification, instant chat with clickable names.
- **Tooling:** local Docker stack, health check, catch-up repair, 414 DB security checks in two grant modes, 164 unit tests, 16 e2e tests.

## Due blocks (proposed — tell me which to build next)
| Block | Scope | Needs from you |
|---|---|---|
| **29 · Scholars website link-up** | vsmscholars.com enquiry form → counselling pipeline, affiliate dashboard and payouts (with confirmation). | Website access; affiliate commission rules |
| **30 · Payroll extras** | Bank-specific transfer files, old-regime declarations (80C/HRA proofs), Form 16 Part B helper. | Sample bank file; CA sign-off |
| **31 · Native mobile app** | Installable Android/iOS app with FCM/APNs push for punches, approvals and chat. | Play/App Store accounts |
| **32 · Assets & inventory** | Laptops, cameras, SIMs issued to people; returns at exit; maintenance. | Asset list |

_Block 24 (client portal) was dropped on 23 Nov 2026 at the owner's request._

## Known gaps / not verified yet
- Real delivery of WhatsApp, web push, Slack/Teams, Meta and Razorpay (needs keys on live).
- `scripts/local-up.ps1` has not been run on your PC yet; the sandbox has no Docker.
- Supabase Realtime on live (after the catch-up, open two browsers and clock in to check live sync).

## Open gaps from Blocks 19–23
- Bank-specific fixed-format files (HDFC/ICICI/SBI etc.) — needs a sample file from your bank.
- Old tax regime declarations (80C/HRA proofs) — today handled by a monthly TDS override.
- Scholars website enquiry API (vsmscholars.com form → pipeline) and affiliate payouts.
- Native app push (FCM/APNs) for field staff.
- Signed-in e2e on a staging project; live Google, RazorpayX and phone camera/GPS checks.

## Open gaps from Blocks 25–27
- Real Claude API calls not tested (needs the key); signed-in rendering of the new screens needs a staging login.
- P&L is a management view (accrual invoices, cash fees) — not a statutory P&L. Client GSTINs must be filled for a complete sales register.
- KPI targets per post are blank until you set them.
