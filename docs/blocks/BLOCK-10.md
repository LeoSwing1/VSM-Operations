# Block 10 — Workflow Automation & SLA Foundation

## Delivered

- Tenant-scoped workflow rule definitions with enabled state, event key, JSON conditions/actions and bounded cooldown configuration.
- Idempotent workflow event enqueueing: a repeated event key cannot create duplicate runs for the same rule.
- Durable workflow run ledger with payload/result snapshots, attempts, timestamps, lock recovery and bounded retry/backoff.
- Concurrency-safe worker claiming using `FOR UPDATE SKIP LOCKED`; stale RUNNING jobs can be reclaimed after 15 minutes.
- Worker-only claim/finish RPCs are restricted to `service_role`. Authenticated users can enqueue only when they hold `settings.manage`; rule reads and management are protected by RLS.
- JSON shape and size/attempt bounds prevent malformed job definitions and unbounded retries.

## Important implementation boundary

This block delivers the database foundation and tested queue contracts, not a visual no-code workflow builder or a production worker. No business event is automatically enqueued until an application action/trigger is explicitly wired to `enqueue_workflow_event`; no automation is executed until a trusted worker claims and finishes the run. This is deliberate: rules must not be able to execute arbitrary SQL or arbitrary code. The next stage should add a typed action registry (notifications, reminders, approval escalation, SLA warnings), an admin UI, and a scheduled worker with per-action permission checks and audit records.

## Migration

Apply `supabase/migrations/0016_workflow_automation_sla.sql` after Block 09. `supabase/all_migrations.sql` is the ordered concatenation of all migration files.
