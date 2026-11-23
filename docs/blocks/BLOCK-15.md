# Block 15 — Complete Business Workflow Automation & SLA Execution

## Delivered
- Wired `leave.submitted` when an employee submits a leave request.
- Wired `leave.decided` after the leave decision RPC succeeds; payload identifies the requester as `target_employee_id`.
- Wired `timesheet.submitted` after a task time entry is successfully created.
- Wired `quality.rework` after a REWORK assessment and evidence processing complete; payload identifies the assessed employee as target.
- Preserved `task.created` from Block 11.
- Added scheduled SLA scanning for tasks due within 24 hours, overdue tasks, pending time entries older than 48 hours, and clock-ins older than 12 hours without a later clock-out.
- Added `notify_target` as a typed workflow action. The worker resolves `target_employee_id` and verifies the employee is active and belongs to the run organisation before notification.
- Protected workflow cron runs the SLA scanner before draining the durable queue. Stable idempotency keys prevent duplicate enqueue on repeated cron runs.
- Added migration `0020_business_workflow_sla_execution.sql` and regenerated the ordered migration aggregate.

## Event coverage
| Event | Status |
|---|---|
| `task.created` | Wired in Block 11 |
| `task.due_soon` | Scheduled scanner |
| `task.overdue` | Scheduled scanner |
| `leave.submitted` | Wired |
| `leave.decided` | Wired |
| `attendance.incomplete` | Scheduled scanner: clock-in >12h with no later clock-out |
| `timesheet.submitted` | Wired |
| `timesheet.overdue` | Scheduled scanner: PENDING >48h |
| `quality.rework` | Wired |
| `meeting.invitation` | Reserved; calendar invitations already have their own email delivery flow, but workflow event is not wired |

## Action and security boundaries
- Supported actions: `notify_actor`, `notify_target`.
- Target IDs are read only from trusted event payloads and checked against the run organisation and active employee status.
- No arbitrary SQL, scripts, URLs, email templates, or unbounded recipients are accepted.
- Scheduled scanner runs only behind the existing CRON_SECRET-protected route and uses the service-role client server-side.
- Email delivery and manager/team escalation are not included in this block; they remain future work.

## Operational behaviour
- Tasks due soon means deadline in the next 24 hours.
- Tasks overdue means deadline is at or before scan time and status is not COMPLETED/CANCELLED.
- Timesheet overdue means a PENDING task time entry has been pending for at least 48 hours.
- Incomplete attendance means a CLOCK_IN older than 12 hours has no later CLOCK_OUT. This is a heuristic and should be tuned to each organisation's shift policy before relying on it for payroll or disciplinary decisions.
- SLA scan runs every five minutes through `/api/cron/workflows`.

## Validation
- Static source and migration checks are included in `tests/block15.test.ts`.
- Full Next.js build, Vitest, PostgreSQL migration execution and live cron tests require project dependencies and a configured Supabase test environment; these were not run in the packaging workspace.
