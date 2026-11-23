# Block 11 — Workflow Builder & Typed Execution

## Delivered

- Organisation-scoped Workflow Automation page at `/settings/workflows`, guarded by `settings.manage` and existing workflow RLS.
- Rule creation for a curated set of event keys, one or more simple in-app notification fields, enable/pause and delete controls.
- Strict typed action registry: `notify_actor` only. Arbitrary JavaScript, SQL, arbitrary external URLs and client-selected recipient IDs are not accepted.
- Migration `0017_workflow_builder_execution.sql` validates action structure in PostgreSQL and adds operational indexes.
- Authenticated event enqueueing now derives organisation and employee identity from the signed-in database context; payload actor must exactly match `current_employee_id()`. It is no longer restricted to settings managers.
- Task creation emits `task.created` with a task UUID idempotency key. Queue insert is idempotent per rule/event key. Failure to enqueue does not roll back the task; an audit event records the enqueue failure.
- Service-role-only cron worker claims jobs with the Block 10 `SKIP LOCKED` queue RPC, checks the rule and active actor remain in the same tenant, and delivers an in-app notification with a deterministic dedupe key.
- Worker endpoint `/api/cron/workflows` uses the existing constant-time `CRON_SECRET` authorization and integration heartbeat.
- Vercel cron schedule added every five minutes. The aggregate migration file is regenerated from migrations 0001–0017.

## Current limitations

- Only `task.created` is wired to a real business action in this block. Other displayed event keys are reserved contracts and do not execute until their corresponding module actions emit them.
- Only the event actor receives notifications; manager/team recipient resolution, email, webhooks, multi-step branches, delays and approval escalation are not included.
- Conditions are currently `{}`; the UI does not expose a condition builder. There is no drag-and-drop canvas.
- Notification is an in-app database insert. Email is deliberately not sent from the workflow worker; it must be implemented through the existing email outbox with approved templates and recipient rules.
- The worker retries through Block 10's bounded queue contract. An action may be retried after a transient database failure; the notification dedupe key prevents duplicate notification rows.

## Deployment

1. Apply `0017_workflow_builder_execution.sql` after migration 0016.
2. Confirm `CRON_SECRET` is configured and Vercel Cron or an external scheduler can call `/api/cron/workflows` every five minutes.
3. Give workflow administration only to trusted administrators through the existing `settings.manage` permission.
4. Test with a staging organisation: create a `task.created` rule, create a task as an active employee, wait for the cron run, and verify one notification and one successful workflow run. Repeat with the same event idempotency key at the RPC level to verify duplicate suppression.

## Validation status

- Source syntax, database migration execution, Next.js build and end-to-end cron execution must be run in an environment with project dependencies and a staging Supabase database. This development environment does not establish production readiness merely from static inspection.
