# Block 29 — Unread-chat emails, team tasks, salary day, approval fix (migration 0040)

- **Unread chat email**: `chat_send_unread_reminders(2)` runs inside `/api/cron/email`. An employee with messages unread for 2h+ gets one email (chat names + counts, never message text). They are emailed again only when newer messages have also waited 2h. Muted CHAT email preference = no email.
  Hobby plan: add a cron-job.org job for `GET /api/cron/email` every 5 min with `Authorization: Bearer <CRON_SECRET>`.
- **Team tasks**: Owners/Admin/HR/HR manager/Managers create a task for a team. EACH = a copy for every member; SHARED = one task in the Team pool that a member claims. HR manager now has `tasks.manage`.
- **Salary day**: `employees.salary_day` defaults to the day of (joining date + 7), e.g. 1 Jan → 8th. HR/payroll can change it when adding or editing; it follows the joining date when left on the default. Shown on the profile and on My salary (last day of short months).
- **Approval fix**: the Approve/Reject buttons now write the choice into the form explicitly (`DecisionButtons`), and the server refuses a missing choice (`decisionOf`) instead of treating it as a rejection. Applies to approvals, task review, project time, performance review requests and KYC.
