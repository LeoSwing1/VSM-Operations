# VSM Growth Operations

The internal operating system for **VSM Growth** and **VSM Scholars**: people, attendance, leave, tasks, daily updates, performance, payroll, CRM, notifications and audit, in one secured app.

**Stack:** Next.js 15 (App Router, server components and actions) · Supabase (Postgres, Auth, RLS) · Brevo (or Resend) email · Vercel.

| Read this | When |
|---|---|
| **[RUNBOOK.md](RUNBOOK.md)** | Setting up, deploying, first-day configuration: exact steps and commands |
| **[docs/EXECUTION-PLAN.md](docs/EXECUTION-PLAN.md)** | All 10 build blocks in one file: scope, database, screens, tests, acceptance checklist, status |
| **[docs/blocks/](docs/blocks/)** | What each execution block delivered and what to run (start with BLOCK-01.md) |
| **[CLAUDE.md](CLAUDE.md)** | Before any developer or AI agent changes code: architecture and non-negotiable rules |
| This README | Overview, access model, website form hookup, what's built |
**Security model:** every rule lives in Postgres row-level security and `SECURITY DEFINER` functions. Hiding things in the UI is cosmetic only. The app talks to the database *as the signed-in user*. The service-role key is used in exactly three server-only places: the public enquiry intake, the email worker and user invites (after a permission check).

---

## 1. Set up & deploy
Follow **[RUNBOOK.md](RUNBOOK.md)** step by step: Supabase → migrations 0001–0006 → bootstrap → Brevo domain + API key → env → Vercel → DNS → hierarchy.

## 2. Access model: who can do what
**Hierarchy** (`role_settings`, editable labels and levels; Super Admin is fixed at 100):

| Level | Role | Typical scope |
|---:|---|---|
| 100 | Super Admin | Everything. Can't be restricted. Only one who grants sensitive permissions and personal overrides. |
| 90 | Admin | Runs the platform; manages roles and people below 90; no payroll unless granted |
| 80 | HR Manager | People, attendance, leave, performance, payroll preparation (not approval) |
| 75 | Operations Manager | All projects, tasks, attendance |
| 70 | Department Manager | Their department |
| 60 | Project Manager | Projects and task quality |
| 55 | Team Lead | Direct reports |
| 40 | Sales Executive | CRM |
| 20 / 10 | Employee / Intern | Only their own data |

**Rules enforced by the database, not the UI:**
- You can only assign or edit roles **below** your level, and only edit people below your level. Nobody changes their own role.
- When editing a role's permissions you can only grant permissions **you hold yourself** (no escalation).
- Sensitive permissions (`payroll.*`, `salary.*`, `roles.manage`, `audit.view`, `settings.manage`) can be granted **only by a Super Admin**.
- **Personal overrides** (Grant/Deny one permission for one person, with reason and optional expiry) are **Super-Admin-only**. Deny beats the role.
- The **last active Super Admin** can't be demoted or exited.
- Reporting-manager lines decide team scope (attendance, leave, tasks, performance). **Salary is never visible through the reporting line.**
- Every grant, revoke, override and role change is written to the audit log.

**One panel:** **Access control** (`/settings/access`) has four tabs:
- **Permission matrix:** every permission × every role, saved in one go. Cells you're not allowed to change are greyed out.
- **Hierarchy:** the role ladder, plus the reporting tree.
- **People & overrides:** any person's exact effective access and why they have it, plus personal grants and denies.
- **Who has access:** pick a permission and see everyone who holds it, and via what.

## 3. Email (Brevo)
`EMAIL_PROVIDER=brevo` with `BREVO_API_KEY` and a verified `EMAIL_FROM`. Every email goes through the `email_outbox` table first (the event is saved before sending), then `lib/email/worker.ts` sends via Brevo's `POST /v3/smtp/email`. 429 and 5xx responses are retried with backoff (1 → 5 → 15 → 60 → 240 min); 400, 401 and 403 are marked FAILED with the reason. Each row is claimed exactly once, which prevents duplicates (Brevo has no idempotency key). Set `EMAIL_PROVIDER=resend` to switch back. Payslip emails never include amounts.

## 4. Connect the vsmgrowth.com forms to the CRM

The site stays on cPanel, untouched. Add this to any contact or project form:

```html
<form id="vsm-enquiry">
  <input name="name" required> <input name="email" type="email"> <input name="phone">
  <input name="service"> <textarea name="message"></textarea>
  <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
  <button>Send</button>
</form>
<script>
document.getElementById('vsm-enquiry').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  data.page = location.pathname; data.kind = 'contact'; // 'project' for project enquiries
  const r = await fetch('https://ops.vsmgrowth.com/api/public/enquiry', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  e.target.innerHTML = r.ok ? '<p>Thank you! We will reply within one working day.</p>' : '<p>Please call +91 82795 74755.</p>';
});
</script>
```

The lead is saved first. Then come the duplicate check (email or last-10-digit phone), in-app alerts to everyone with `crm.assign`, an internal email to `ALERT_EMAIL` and an acknowledgement to the enquirer (both via Brevo). Protections: an origin allow-list, a honeypot field and a rate limit of 5 per 10 minutes per IP. Server-to-server posts need an `X-Intake-Key` header.

## 5. Tests

```bash
npm test                                            # 31 unit tests
PGHOST=... PGPORT=... PGUSER=postgres npm run test:db  # 135 RLS/security checks on real Postgres
npm run typecheck && npm run build
```

The DB suite applies every migration to a scratch database with a Supabase-compatible `auth` shim, then signs in as each persona (anon, employee, team lead, other-department lead, HR, super admin, another organisation) and verifies, among other things:

- Employee A cannot see Employee B's salary, payslip, performance or attendance.
- An employee can never read confidential manager notes, even about themselves.
- Managers do **not** see their reports' salaries; leads cannot see unrelated departments.
- Nobody can change their own role, edit their own salary or write their own payroll entry.
- HR cannot approve a run they prepared, and nobody can approve a run containing their own salary.
- Approved payroll is locked (even with RLS bypassed); payments need a UTR, and PAID is automatic.
- Attendance has no double clock-ins, no direct event writes, no self-approved corrections, and corrections are audited.
- Organisations are isolated; anonymous users get nothing and can't call service-only RPCs.
- Payslip emails contain no amounts.
- Hierarchy rules: no assigning roles at or above your level, no granting permissions you don't hold, sensitive permissions and personal overrides are Super-Admin-only, Deny beats role, overrides are audited, and the last Super Admin is protected.

## 6. What's built and what's next

| Area | Status |
|---|---|
| Auth (login, reset, invite, session revoke on password change), 10-role hierarchy, Access control panel (matrix, ladder, reporting tree, overrides, who-has-access) | ✅ Built |
| Executive / role-adaptive dashboard (real counts only) | ✅ Built; date and department filters are next |
| Employee 360 (overview, attendance, tasks, daily updates, leave, performance, salary, activity, edit) | ✅ Built; documents, meetings and communication tabs come with those modules |
| Attendance: clock in/out, breaks, late, early, missing clock-out, corrections + approval, CSV, IST display / UTC storage | ✅ Built; holiday and shift admin screens next (data model is in place) |
| Leave: types, balances, apply, cancel, approve/reject with comment, no overlaps | ✅ Built; delegation and escalation next |
| Tasks: list, team, overdue, kanban, workflow, separate quality review, rework tracking, history; basic projects | ✅ Built; subtasks, dependencies, comments, attachments, timeline next |
| Daily updates with manager feedback | ✅ Built; missing-update reminders come with the automation engine |
| Performance engine: configurable weights per department/role, coverage rule, transparent breakdown, snapshots, adjustments with reasons, approval, review requests, private notes | ✅ Built |
| Payroll: versioned structures, incentive slabs, proration, LOP, caps, adjustments, DRAFT→PAID workflow with segregation of duties, payslips (print to PDF), restricted CSV export, access logging | ✅ Built; statutory items (PF/ESI/PT/TDS) are deliberately manual until a CA confirms the rules |
| Employee self-service analytics with ranges, trend and improvement tips | ✅ Built |
| CRM: website intake, dedupe, pipeline, owners, follow-ups, activity, convert to client | ✅ Built; Client 360 and sales analytics next |
| Notifications (in-app) + email outbox via **Brevo** (Resend optional) with retries and templates | ✅ Built; per-user preferences and digest modes next |
| Audit log (immutable) | ✅ Built |
| Chat, groups, spaces, announcements (Supabase Realtime) | ⏭ Block 2 |
| Meetings & Google Calendar; documents & storage | ⏭ Block 3 |
| Flutter mobile app + FCM push | ⏭ Block 4 (same Supabase auth and RLS, no new backend) |
| VSM Scholars, automation engine, integration command center, incidents/SLA | ⏭ Block 5 |
