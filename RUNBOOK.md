# RUNBOOK — exactly what to run, in order

Follow the steps top to bottom. Each one has a **✔ Check** line; don't move on until it passes.
Time needed: about 60 minutes the first time.

---

## 0. Before you start
- [ ] Node.js 20 or newer: `node -v`
- [ ] A GitHub account, a Vercel account, a Supabase account, a Brevo account
- [ ] Access to cPanel → Zone Editor for `vsmgrowth.com` (DNS lives there, not at Namecheap)
- [ ] **Use this project as the base.** Don't deploy the `vsm-current-sit` zip: it doesn't build, and its pages query tables that don't exist.

---

## 1. Put the code on GitHub
```bash
unzip vsm-growth-operations.zip && cd vsm-ops
git init && git add . && git commit -m "VSM Growth Operations"
# create an EMPTY private repo on github.com named vsm-growth-operations, then:
git remote add origin https://github.com/<your-user>/vsm-growth-operations.git
git branch -M main && git push -u origin main
```
✔ Check: the repo on GitHub shows `CLAUDE.md`, `RUNBOOK.md` and `supabase/migrations/0001…0018`, and does **not** contain `.env.local`.

---

## 2. Create the database (Supabase)
1. supabase.com → **New project** → name `vsm-ops`, strong DB password (save it in your password manager). Note the region; `vercel.json` must use the matching Vercel region (Tokyo `ap-northeast-1` ↔ `hnd1`, Mumbai `ap-south-1` ↔ `bom1`).
2. **Run the migrations.** Choose **one** option:

   **Option A, terminal (recommended).** Supabase → **Connect** → *Session pooler* → copy the URI. Use port **5432**, not the transaction pooler on 6543. Then run:
   ```bash
   export DATABASE_URL='postgresql://postgres.<project-ref>:<DB-PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres'
   ./scripts/migrate.sh
   ```
   It applies every migration (currently 0001→0018) in order, each in its own transaction, stops at the first error, and skips anything already applied, so it's safe to re-run.
   ✔ Check: it ends with `RLS-enabled table count is printed for review` and `migrations applied: 0001 … 0018`.

   **Already applied earlier migrations by hand?** Don't run `migrate.sh` (it would try them again). Paste only the new file(s) listed in the latest `docs/blocks/BLOCK-NN.md` into the SQL Editor. For this source build, Block 02 adds `0008_hr_recruitment.sql`, Block 03 adds `0009_hr_documents_probation_exit.sql`, and Block 04 adds `0010_finance_erp.sql`, Block 05 adds `0011_operations_communication.sql`; Block 06 adds `0012_chat_security_access_controls.sql`; Block 07 adds `0013_executive_reporting.sql`; Block 08 adds `0014_workforce_collaboration_calendar.sql`; Block 09 adds `0015_advanced_calendar_time_quality_exports.sql`; Block 10 adds `0016_workflow_automation_sla.sql`; Block 11 adds `0017_workflow_builder_execution.sql`; Block 13 adds `0018_integration_control_centre.sql`.

   **Option B, browser.** Supabase → **SQL Editor → New query** → paste the whole of `supabase/all_migrations.sql` → **Run** (empty project only).
   ✔ Check: "Success. No rows returned".

3. **Authentication → Users → Add user → Create new user:** your email + a strong password, tick *Auto Confirm User*. Copy the user's **UID**.
4. SQL Editor, run once (replace the values):
   ```sql
   select bootstrap_organization('VSM Growth', 'vsm-growth', '<YOUR-UID>', 'Vishant Malik', 'you@vsmgrowth.com');
   ```
   ✔ Check: it returns a UUID. Running it a second time must fail with "bootstrap already completed". That's correct; it means no hidden second admin can be created this way.
5. **Authentication → Sign In / Providers:** turn **off** "Allow new users to sign up" (staff are invited, nobody self-registers).
6. **Authentication → URL Configuration:** Site URL `https://ops.vsmgrowth.com`; Redirect URLs: add `https://ops.vsmgrowth.com/auth/callback` and `http://localhost:3000/auth/callback`.
7. **Project Settings → API:** copy the **Project URL**, the **anon public** key and the **service_role** key (keep the service_role key secret).

---

## 3. Set up email (Brevo)
1. Brevo → **Senders, Domains & Dedicated IPs → Domains → Add a domain** → `vsmgrowth.com`.
2. Brevo shows several DNS records (a Brevo code TXT, DKIM and DMARC). In **cPanel → Zone Editor → vsmgrowth.com → Manage**, add each record exactly as shown.
   - If you already have a DMARC (`_dmarc`) TXT record, keep **one** only; don't create a second.
   - Don't touch existing MX records.
3. Back in Brevo, click **Authenticate this domain** (DNS can take 15 minutes to a few hours).
4. **Senders → Add a sender:** `VSM Growth` / `ops@vsmgrowth.com` (any address on the authenticated domain).
5. **SMTP & API → API Keys → Generate a new API key** → name `vsm-ops` → copy it (starts with `xkeysib-`).

✔ Check: the domain shows **Authenticated** and the sender shows **Verified** in Brevo.

---

## 4. Environment variables
Create the secrets (run in a terminal):
```bash
node -e "console.log('CRON_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('ENQUIRY_INTAKE_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
```
Copy `.env.example` → `.env.local` and fill in **every** line:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key (secret) |
| `EMAIL_PROVIDER` | `brevo` |
| `BREVO_API_KEY` | `xkeysib-…` |
| `EMAIL_FROM` | `VSM Growth <ops@vsmgrowth.com>` (must be your verified Brevo sender) |
| `EMAIL_REPLY_TO` | where client replies should go |
| `ALERT_EMAIL` | who gets "new enquiry" alerts |
| `ORG_SLUG` | `vsm-growth` |
| `ENQUIRY_INTAKE_KEY`, `CRON_SECRET` | from the commands above |
| `ENQUIRY_ALLOWED_ORIGINS` | `https://vsmgrowth.com,https://www.vsmgrowth.com` |
| `APP_URL` | `https://ops.vsmgrowth.com` |
| `APP_TIMEZONE` | `Asia/Kolkata` |

Test locally:
```bash
npm install
npm test            # unit suite must pass (see package scripts)
npm run typecheck   # ✔ no output
npm run build       # ✔ "Compiled successfully"
npm run dev         # open http://localhost:3000 → sign in with the user from step 2.3
```
✔ Check: you land on the Dashboard as **Super Admin**, and the sidebar shows **Access control**.

---

## 5. Deploy (Vercel)
1. vercel.com → **Add New → Project** → import `vsm-growth-operations`. Framework: Next.js (auto-detected). `vercel.json` pins functions to `hnd1` (Tokyo), next to the database. Change it if your Supabase region is different.
2. **Environment Variables:** add every key from your `.env.local` for **Production** (and Preview if you use it).
3. **Deploy.** ✔ Check: the build log ends with "Compiled successfully" and the deployment shows Ready.
4. **Settings → Domains → Add** `ops.vsmgrowth.com`. Vercel shows a CNAME target.
5. cPanel → Zone Editor → **Add Record → CNAME:** name `ops`, value `cname.vercel-dns.com` (or exactly what Vercel shows).
   ✔ Check: `https://ops.vsmgrowth.com/login` loads with a padlock.
6. **Scheduled jobs (cron):** `vercel.json` runs `/api/cron/email` every 5 minutes (needs Vercel **Pro**) and `/api/cron/digest` daily at 7 pm IST. On **Hobby**, either change the schedule in `vercel.json` to `"0 3 * * *"` (daily) or create a free job at cron-job.org:
   - URL `https://ops.vsmgrowth.com/api/cron/email`, every 5 min
   - URL `https://ops.vsmgrowth.com/api/cron/digest`, daily 19:00 Asia/Kolkata
   - Header `Authorization: Bearer <CRON_SECRET>`

   (Enquiry emails are also sent immediately on submit; the cron only handles retries and task/payroll emails.)

---

## 6. Set up your hierarchy (first day)
1. **Access control → Hierarchy:** check the role ladder. Rename roles to your designations if you like (for example Team Lead → "Content Lead"; the underlying permissions stay the same). Higher roles manage lower ones, never the reverse.
2. **People → Departments:** add your departments (Content Production, SEO, Web Development, Sales, VSM Scholars…).
3. **People → Add employee:** for each person, set department, **reporting manager** and **role**, with "Email a sign-in invitation" ticked. The reporting manager decides whose attendance, leave, tasks and performance they see and approve.
   - Add your co-founder as **Super Admin** too, so there are always two (the system won't let the last Super Admin be removed).
4. **Access control → Permission matrix:** review each role's column and click **Save all changes**.
   - Sensitive permissions (payroll, salary, finance, roles, audit, settings) can only be granted by a Super Admin. Block 04 grants the complete finance set to the default ADMIN role; grant only approved granular finance permissions to other Finance/Accounts users.
   - Admins can change roles below them, but only with permissions they hold themselves.
5. **Access control → People & overrides:** to give one person one extra permission without changing their role (for example "View all leads" while covering sales), add a **Grant** with a reason and an expiry date. Use **Deny** to block one permission for one person. Every change appears in the audit log.
6. **Access control → Who has access:** pick `payroll.view_all` and confirm only the people you expect are listed.
7. **Payroll → Salary structures:** add a structure for each employee. Review the example incentive slabs and change them to your policy.

✔ Check: sign in as a normal employee (use a test invite). They should see only their own attendance, tasks, performance and salary, and no Access control or Payroll admin menu.

---

## 7. Connect the website forms (vsmgrowth.com stays on cPanel)
Use the HTML/JS snippet in `README.md` § "Connect the vsmgrowth.com forms". Then:
```bash
curl -i -X POST https://ops.vsmgrowth.com/api/public/enquiry \
  -H "Origin: https://vsmgrowth.com" -H "Content-Type: application/json" \
  -d '{"name":"Test Lead","email":"you+test@vsmgrowth.com","service":"SEO","message":"Runbook test"}'
```
✔ Check: HTTP `201`; the lead appears under **CRM · Leads**; `ALERT_EMAIL` gets the alert and the test address gets the acknowledgement.
If emails don't arrive: in Supabase, run `select status, last_error from email_outbox order by created_at desc limit 5;` and read `last_error`.

---

## 8. Every time you change code
```bash
git pull
npm install
npm test && npm run typecheck && npm run build       # all must pass
# database tests (needs Docker once):
docker run -d --name vsm-pg -p 5432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16
PGHOST=localhost PGPORT=5432 PGUSER=postgres npm run test:db   # ✔ "security suite complete" + "sweep complete", no FAIL
git add . && git commit -m "…" && git push           # Vercel deploys automatically
```
New migration? Run it in the Supabase SQL Editor **after** `test:db` passes, and before the code that uses it goes live. Block 03 creates the private `employee-private` Storage bucket; Block 04 creates the private `finance-receipts` bucket; Block 05 creates the private `chat-files` bucket (15 MB limit, PDF/image/text/ZIP types). Block 06 adds report/moderation tables and RPC-controlled channel membership; verify moderator-only report access, cross-organization member rejection and direct-message membership immutability. Confirm Storage is enabled, enforce the 10 MB PDF/image restrictions, and test employee-vs-employee receipt signed URL isolation, manager/finance approval separation, private-group isolation and chat attachment signed URL access in staging.

---

## Troubleshooting
| Symptom | Fix |
|---|---|
| Login works, then "isn't linked to an active employee profile" | That auth user has no `employees` row. Add them in People, or run `bootstrap_organization` for the very first admin. |
| "You can only assign roles below your own level" | Working as intended. Ask someone higher, or a Super Admin. |
| Emails stuck as QUEUED | `BREVO_API_KEY` / `EMAIL_FROM` missing, or the cron isn't running. FAILED with `Brevo 401` means a bad key; `Brevo 400` usually means the sender isn't verified. |
| Invite email not received | Supabase → Authentication → Emails. For production, set custom SMTP to Brevo (SMTP & API → SMTP tab: host `smtp-relay.brevo.com`, port 587, your SMTP login and key). |
| Build fails on Vercel with module not found | A package was imported without being added to `package.json`. Run `npm i <pkg>` and commit. |
| "infinite recursion detected in policy" | A new RLS policy references a table whose policy references back. Use a `SECURITY DEFINER` helper (see CLAUDE.md rule 6). |


## Executive reporting (Block 07)

- Apply migration `0013_executive_reporting.sql` before enabling the executive route.
- Grant `executive.view` only to leadership roles that should access the overview. The migration seeds ADMIN and OPERATIONS_MANAGER.
- Finance metrics require the separate `finance.view` permission; people, project, task and CRM sections require their own permissions.
- CSV export uses the same permission gates as the dashboard.
- The displayed cash movement is an operational indicator only, not a statutory accounting report.

## Block 08 deployment notes

1. Back up the staging database and apply `supabase/migrations/0014_workforce_collaboration_calendar.sql` after migrations 0001–0013 (continue through 0018 for the latest source bundle).
2. Verify new role permissions for every role in a seeded organisation and verify the `organizations_seed_workforce_collaboration_permissions` trigger for a newly bootstrapped organisation.
3. Test schedule assignment date ranges, overlap rejection, and attendance calculations for two employees with different shift policies.
4. Test tenant isolation for teams, group memberships, time entries, quality assessments, calendar events, attendees and meeting notes.
5. Test time approval self-approval denial and team/all permission boundaries.
6. Test private calendar events and attendee response visibility; test invite notification deduplication.
7. Run `npm ci && npm run typecheck && npm test && npm run test:db` before deployment.

Timesheets are work allocation, not attendance. Do not use them as payroll hours until a separately reviewed reconciliation policy is configured. No production changes are performed by this repository block.

## Block 09 integrations and reporting

1. Apply migration `0015_advanced_calendar_time_quality_exports.sql` after migration 0014.
2. Set `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `MICROSOFT_CALENDAR_CLIENT_ID`, `MICROSOFT_CALENDAR_CLIENT_SECRET`, and a 32-byte `CALENDAR_TOKEN_ENCRYPTION_KEY` (base64 or 64-character hex). Register both callback URLs shown in `.env.example`.
3. Confirm the private `quality-evidence` Storage bucket exists after migration. Evidence upload limits are 15 MB per file, 8 files per assessment.
4. Keep `CRON_SECRET` configured. Vercel runs invitation delivery every 5 minutes and calendar sync every 15 minutes. Verify `/api/cron/calendar-invitations` and `/api/cron/calendar-sync` return successful JSON when invoked with the cron bearer token.
5. Configure a verified Brevo or Resend sender for calendar invitations. The delivery queue claims rows atomically, uses retries with backoff, and abandons after five attempts.
6. Test calendar OAuth with a non-production account first. Confirm both inbound private event import and outbound organiser event sync before enabling for the organisation.
7. Verify attendance, timesheet, finance, payroll and quality CSV/XLSX/PDF exports, plus calendar ICS export. Payroll and finance exports retain their existing permission gates and are audited.

### Block 10 — Workflow automation foundation

Apply migration `0016_workflow_automation_sla.sql` after Block 09. The queue is dormant until explicit application event wiring and a trusted service-role worker are deployed. Do not expose `claim_workflow_runs` or `finish_workflow_run` to browser clients. Workflow rule administration currently uses the existing `settings.manage` permission.

## Block 12 — Admin and communication UI

- Super Admin entry: **Admin → Super Admin console** (`/settings/admin`). The route requires `roles.manage` and explicitly checks `SUPER_ADMIN`.
- Role configuration: **Admin → Access control** (`/settings/access`). Save the matrix using the existing server action; verify role grants in the database and audit log.
- Team chat: `/chat` lists joined conversations and discoverable channels. Open a conversation to send messages, attach supported files, react, reply or report.
- Chat continues to poll every four seconds. Do not describe it as WebSocket/live-presence chat.


## 8. Integration Control Centre (Block 13)

Open **Settings → Integrations** as a user with `settings.manage`. Run the database, Storage, Auth Admin and Realtime checks individually. The results are saved in the organisation-scoped diagnostic history.

- Storage check requires the service-role key and confirms `employee-private`, `finance-receipts`, `chat-files` and `quality-evidence` exist as private buckets.
- Auth Admin check verifies service-role access to Supabase Auth; it does not display user records.
- Realtime check verifies a temporary channel handshake only. It does not prove chat has migrated from polling to live subscriptions.
- Google/Microsoft cards distinguish OAuth credential readiness from actual linked accounts and sync errors. Set both client credentials and `CALENDAR_TOKEN_ENCRYPTION_KEY`; register the callback URLs shown in the panel with each provider.
- Cron health is based on real worker heartbeats. Confirm `CRON_SECRET` matches the scheduler's Authorization header and that all routes in `vercel.json` are scheduled.
- Diagnostic checks are manual and may make a real provider request. Do not run repeatedly as a load test.

Apply migration `0018_integration_control_centre.sql` before using diagnostic history. Do not mark a provider connected solely because environment variables are present.


### Block 13 migration

Apply `supabase/migrations/0018_integration_control_centre.sql` after `0017_workflow_builder_execution.sql`. It creates organisation-scoped diagnostic history. Then deploy the app and open Settings → Integrations as a `settings.manage` administrator. Run the database, Storage, Auth Admin and Realtime checks. The dashboard records actual check outcomes; it does not auto-connect third-party services or alter production credentials.

## Block 14 — Realtime chat and notifications

- Apply migration `0019_realtime_chat_notifications.sql`.
- Confirm the Supabase project has Realtime enabled and the `supabase_realtime` publication available.
- Validate private channel authorization with two users who are members of one channel; verify a non-member cannot subscribe to `chat:<channel-id>`.
- Verify message and reaction updates, typing broadcasts, online presence and channel-level read receipts.
- Verify a new chat message creates notifications only for other channel members and the recipient receives a live badge/toast.
- Browser desktop alerts require explicit permission from Notifications. They do not provide closed-browser Web Push or native mobile push.
- If Realtime is unavailable, the chat client refreshes on a 30-second visible-tab fallback (15 seconds for read-only moderation).


## Block 15 operations
- Apply migration `0020_business_workflow_sla_execution.sql` (or the regenerated `supabase/all_migrations.sql`).
- Deploy the updated `/api/cron/workflows` route; it scans SLA events before draining workflow runs every five minutes.
- Configure `CRON_SECRET` in the deployment environment.
- Tune the 24-hour task due-soon, 48-hour pending-timesheet and 12-hour incomplete-attendance thresholds to the organisation policy before payroll-critical use.
- Workflow actions support `notify_actor` and `notify_target`; target routing requires `target_employee_id` in the event payload and same-organisation active employee validation.

### Block 16 workflow approvals
1. Apply migration `0021_advanced_workflow_approvals.sql`.
2. Confirm employee manager relationships (`employees.manager_id`) are populated and remain within the same organisation.
3. Deploy the application and ensure the existing `/api/cron/workflows` schedule remains enabled with `CRON_SECRET` configured.
4. Create a workflow with the `Create manager approval request` action and a 1–720 hour SLA.
5. Verify the assigned manager sees the item in Approvals and can approve/reject it.
6. In staging, age a pending approval past its due time and verify escalation to the next active manager, audit/notification records and the three-level cap.
7. Do not treat a successful deployment as proof of live cron execution; inspect cron heartbeat and workflow run history.

### Block 17 — integrations, permissions, Operations Center, login
1. SQL Editor: run any pending `0019`–`0021`, then `0022_block17_repair.sql`, then `0023_integrations_channels.sql`. Run the check query in `docs/blocks/BLOCK-17.md`.
2. Add only the channel env vars you need (`.env.example` → Block 17 section) in Vercel. Redeploy.
3. Admin → Integrations → **Channels**: opt your own number in (Notifications → Preferences), then *Send test to my WhatsApp*, *Send test push*, *Send test message* (Slack/Teams). Save routing.
4. **Webhooks**: create an endpoint, copy the secret (shown once), and *Send ping*.
5. Meta: add the callback URL and verify token in the Meta app, subscribe the Page to `leadgen`, then submit a test lead from the Lead Ads Testing Tool. It should appear under **Inbound events** and in CRM → Leads.
6. Razorpay: add the webhook URL and secret. A paid test payment link with `notes.invoice_number` should show as *matched → review*. A finance user then confirms payment on the invoice; it is never auto-paid.
7. Open **Operations Center** and check live attendance, queues and *Run all workers now*.

### Block 18
1. SQL Editor: run `0024_block18_people_teams_live.sql`, then the check query in `docs/blocks/BLOCK-18.md` (expect 1 super admin, 18 posts, 3 teams with chat).
2. Redeploy. Super Admin console → **Create demo team** → copy the logins → **Test login**.
3. Sign in as a demo SEO Executive in another browser: clock in (the clock ticks), open the *SEO Team* chat, and send a message. As yourself you should get the chat badge and a Windows notification (turn notifications on with the banner first).
4. Profile → *Email a reset link* / *Generate temporary password*. The employee is forced to set their own password.
5. Break-glass (only if the Super Admin account is lost): in the SQL Editor, `update employees set user_id = '<new auth uid>' where role='SUPER_ADMIN';`. This works only from the SQL Editor and is audited.
6. Local Docker: `./scripts/local-up.ps1 -Email you@vsmgrowth.com -Name "Your Name"`, then `npm run dev`.

### Blocks 19–23
1. SQL Editor: run `supabase/repair/catch_up.sql`, then `supabase/diagnostics/health_check.sql` (no MISSING/ERROR lines).
2. Field attendance: Settings → Attendance → Field & mobile → add Meerut + Noida from inside each office; choose Warn first, Enforce later.
3. Payroll: Payroll → Statutory & bank → check rules with your CA → enter PAN/UAN/bank for each employee → recalculate the draft run → Bank transfer file after approval.
4. Google: create the OAuth client (Calendar, Drive, Gmail APIs), set the three env vars, then Settings → Integrations → Google → Connect.
5. VSM Scholars: /scholars/courses → set fees → create a batch with a trainer → give counsellors the *Course Counsellor* post.
6. CI: push the repo to GitHub — the workflow runs automatically. For signed-in E2E, add `E2E_EMAIL`/`E2E_PASSWORD` (staging demo login) as repo secrets.

### Blocks 25–27
1. SQL Editor: run `supabase/repair/catch_up.sql`, then `health_check.sql` (0032–0034 ok).
2. Growth: /growth/kpis → KPI setup → set monthly targets per post. HR: /growth/reviews → Manage cycles → create → Open.
3. AI: add `ANTHROPIC_API_KEY` on Vercel → redeploy → Settings → AI assistant → switch on, set budget.
4. Reports: /reports → Scheduled → e.g. weekly attendance to HR (Mon 09:00), monthly P&L to founders (day 2, 10:00). Accountant: /reports → Accountant pack → month → Download.
