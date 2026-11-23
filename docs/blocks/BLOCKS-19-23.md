# Blocks 19–23 — hardening, field attendance, Indian payroll, Google Workspace, VSM Scholars

## Run on live Supabase
1. Paste `supabase/repair/catch_up.sql` into the SQL Editor and run it. It now covers migrations 0001–0031 in one transaction and skips whatever is already applied.
2. Run `supabase/diagnostics/health_check.sql`. You should see no `MISSING` or `ERROR` lines; the 0027–0031 lines should read `ok`.
3. Redeploy on Vercel, then add the new environment variables (below) for the parts you want to use.

## Block 19 · Live testing & hardening
- **Error log:** every server error (pages, actions, API, cron) is written to `app_errors` with secrets scrubbed. You see them in **Operations Center → Recent app errors**; they are kept for 30 days and pruned daily.
- **Rate limits** (stored in the database, so they work across Vercel instances):
  - sign-in: 10 per IP and 5 per account every 15 minutes
  - forgot password: 5 per IP and 3 per address per hour
  - `/status`: 30 per minute
- **Offline page and service worker:** shows `/offline` when there's no connection. Private pages are never cached.
- **CI** (`.github/workflows/ci.yml`):
  - format, typecheck, 155 unit tests, build, then Playwright on desktop and mobile
  - the database security suite in both modes: normal, and installed through the live repair script
- **Playwright:** `npm run e2e`. The public tests run anywhere. Signed-in tests run when `E2E_EMAIL` / `E2E_PASSWORD` are set — use a demo login on a **staging** project.
- **Staging (recommended):** create a second Supabase project, run `catch_up.sql` on it, then point a Vercel *Preview* environment at it.

## Block 20 · Mobile & field attendance (Settings → Attendance → Field & mobile)
- **Offices:** add Meerut and Noida by standing inside each office and clicking *Use my current location*. Each office has a radius, 150 m by default.
- **Geofence:**
  - **Off:** location isn't checked.
  - **Warn** (default): punches are saved but flagged when outside an office.
  - **Enforce:** clock-in and clock-out are refused outside an office.

  People marked *Remote work allowed* are never flagged.
- **Selfie at clock-in:** off, optional or required. Photos go to a private bucket that only the person, their manager and HR can open.
- **Offline punches:** saved on the phone when there's no internet and synced automatically with the original time. The database accepts them only within the window (12 h by default) and always flags them.
- **Review:** flagged punches show in **Operations Center → Flagged punches**. The manager or HR marks them reviewed, and nobody can review their own.
- Location is saved only at the moment of a punch. The app never tracks people in between.

## Block 21 · Indian payroll (Payroll → Statutory & bank)
- **Statutory engine** (`src/lib/engines/statutory.ts`, 11 tests). The defaults are what applied in November 2026:
  - **EPF:** 12% employee + 12% employer, wage ceiling ₹25,000 (from 17 Sep 2026); employer share split into EPS 8.33% and EPF.
  - **ESI:** 0.75% employee / 3.25% employer up to ₹21,000 gross, each rounded up to the next rupee.
  - **TDS:** new regime FY 2026-27 slabs with ₹75,000 standard deduction, Section 87A rebate up to ₹12 lakh taxable (with marginal relief) and 4% cess. Old regime → set a monthly TDS override.
  - **PT:** off by default, since Uttar Pradesh has none. You can add your state's slabs.

  Every number is editable. **Have your CA confirm the rules before the first live run.**
- **Calculation:** the statutory lines are added to every payroll entry. The payslip shows employee deductions plus employer contributions (marked "not deducted").
- **Payslip PDF:** a *Download PDF* button on the payslip, available to the employee and to payroll staff. PAN and bank numbers are masked.
- **Bank transfer file:** a generic NEFT/RTGS bulk CSV for APPROVED or PROCESSED runs, covering only unpaid employees with valid bank details. Your own salary is excluded. It never marks anything paid. Bank-specific fixed layouts need a sample file from your bank.
- **RazorpayX payouts:** payouts matched by the webhook appear on the run page under *Confirm paid* (needs `payroll.pay`). The UTR becomes the payment reference.
- **Form 16 data:** a CSV per financial year (April–March) with monthly gross and TDS plus PF/ESI/PT totals and PAN, for your CA. This is working data, not the filed form.
- **Statutory and bank details:** PAN, UAN, ESIC number and bank details are stored per employee. Only payroll managers can change them, never for themselves. Stored numbers are never shown in full, and every change is audited without logging the numbers.

## Block 22 · Google Workspace (Settings → Integrations → Google)
- **One-time setup:** in Google Cloud Console create an OAuth client (type: Web application) and add the redirect URI. Enable the Calendar, Drive and Gmail APIs. Then set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `CALENDAR_TOKEN_ENCRYPTION_KEY`.
- **Calendar, both ways:**
  - Every VSM meeting is copied to each participant's own Google Calendar, and updates and cancellations follow.
  - Google never emails anyone, because the copies carry no attendees.
  - Google events are imported as private entries in VSM, and the app's own copies are never re-imported.
  - The queue runs every 5 minutes; there's also a **Run now** button.
- **Drive:** HR can *Copy to Drive* any employee document into the company folder. The app only ever sees the files it created (`drive.file` scope).
- **Gmail:** pick a connected account as the company sender and set `EMAIL_PROVIDER=gmail`. Welcome, reset and notification emails then go out from that Gmail account (about 2,000 per day on Workspace).
- Tokens are encrypted with AES-256-GCM and can never be read from the browser.

## Block 23 · VSM Scholars (`/scholars`)
- **Courses:** Digital Marketing, Graphic Design and Video Editing are seeded **with no fee set**. Set the fees in *Courses*.
- **Counselling pipeline:** enquiry → counselled → demo → enrolled → alumni, plus lost or dropped with a reason.
  - Follow-up dates, with WhatsApp and call buttons
  - Referral codes, with a reward record when a referred student enrols
  - Affiliate codes
- **Batches:** trainer, seats, schedule, Meerut, Noida or online. Trainers mark class attendance; class history and attendance % per student.
- **Fees:**
  - an instalment schedule is created at enrolment
  - only `scholars.fees` can **confirm** a payment (method + reference) or waive one with a reason
  - sequential receipt numbers and a receipt PDF
  - overdue fees are listed
- **Certificates:**
  - issued only when the fees are settled and attendance is at or above the minimum (75% default)
  - landscape PDF with a QR code
  - public `/verify/<code>` page shows **Genuine** or **Revoked**
- **Post-based access:**
  - *Course Counsellor* gets students and enrolments
  - *Trainer* gets their own batches and attendance
  - *Accounts Executive* gets fees

  A post can never grant a sensitive permission.

## Verified in this workspace
- `tsc`: 0 errors · `next build`: ✓ · Prettier: ✓
- Vitest: **155/155**
- Playwright public suite: **14/14** (desktop and mobile) against `next start`
- PostgreSQL 16, **331/331** security checks in normal *and* strict-grant mode. The new checks cover:
  - geofence enforce/warn
  - foreign selfie paths
  - the offline window
  - review rules
  - bank-detail privacy
  - token columns
  - counsellor vs fees rights
  - receipt numbers
  - certificate rules and public verification
  - sensitive post grants
- Simulated live database (partial migrations, no automatic grants): `catch_up.sql` applies 0001–0031 cleanly, a re-run is a no-op, and the health check shows no MISSING or ERROR lines.
- Sample payslip, certificate and receipt PDFs were generated and checked visually.

**Not verified here:**
- real Google OAuth, Calendar, Drive and Gmail calls
- a real camera or GPS on a phone
- real RazorpayX payouts
- signed-in end-to-end tests on staging
