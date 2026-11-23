# Block 16 — Advanced Workflow Builder, Escalation & Approval Intelligence

## Delivered
- Expanded the typed workflow action registry with `notify_manager` and `create_approval`, alongside existing actor/target notifications.
- Workflow creation UI now supports manager notification and approval creation with an SLA duration (1–720 hours).
- Approval cases are durable, organisation-scoped records with requester, approver, due date, status, decision note and escalation level.
- Manager approval routing resolves the requester's configured `manager_id` and validates the approver is active and in the same organisation.
- Approval cases appear in the existing Approvals inbox; only the assigned approver can decide through the RLS-protected update policy.
- Scheduled workflow cron escalates overdue approvals up the configured manager chain, up to three levels, and notifies the next manager. Each escalation gets a fresh 24-hour response window.
- Audit events are recorded for approval decisions. Existing idempotent workflow queue and bounded retry mechanisms are retained.

## Security boundaries
- No arbitrary code, SQL, external URL execution or free-form recipient selection.
- Service-role access is confined to the existing secret-protected cron worker.
- Approval reads are restricted to organisation administrators, requester and assigned approver; decisions are restricted to the assigned approver.
- Manager routing uses the employee hierarchy in the same organisation and excludes exited employees.

## Configuration / limitations
- Employees need a valid `manager_id` chain for approval and escalation routing.
- Escalation is bounded to three manager hops; if no active next manager exists, the approval remains pending with its current approver.
- Escalation currently uses a fixed 24-hour follow-up window; configurable per-level policies, delegation, parallel approvals, multi-stage approval graphs and email actions remain future work.
- Approval action is one manager approval per workflow run; visual drag-and-drop graph editing is not included.
- Apply migration `0021_advanced_workflow_approvals.sql` before deploying this source.

## Validation
Static checks and ZIP integrity are recorded in the delivery response. Full Next.js build, Vitest, PostgreSQL migration execution and live multi-user approval/escalation tests require configured dependencies and a Supabase test environment; they are not claimed as passed.
