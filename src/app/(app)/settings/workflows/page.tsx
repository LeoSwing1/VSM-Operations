import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Flash, PageHeader, TableWrap } from "@/components/ui";
import { fmtDateTime } from "@/lib/engines/time";
import { createWorkflow, deleteWorkflow, setWorkflowEnabled } from "./actions";
export const metadata = { title: "Workflow automation" };
export const dynamic = "force-dynamic";
const EVENTS: [string, string][] = [
  ["task.created", "Task created"],
  ["task.due_soon", "Task approaching deadline"],
  ["task.overdue", "Task overdue"],
  ["leave.submitted", "Leave request submitted"],
  ["leave.decided", "Leave request decided"],
  ["attendance.incomplete", "Incomplete attendance"],
  ["timesheet.submitted", "Timesheet submitted"],
  ["timesheet.overdue", "Timesheet awaiting approval"],
  ["quality.rework", "Quality assessment marked rework"],
  ["meeting.invitation", "Meeting invitation created"],
];
export default async function Workflows({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePerm("settings.manage");
  const sb = await supabaseServer();
  const [{ data: rules }, { data: runs }] = await Promise.all([
    sb
      .from("workflow_rules")
      .select("id,name,event_key,enabled,actions,created_at,updated_at")
      .eq("org_id", ctx.org_id)
      .order("created_at", { ascending: false }),
    sb
      .from("workflow_runs")
      .select("id,event_key,status,attempts,error_message,created_at,finished_at")
      .eq("org_id", ctx.org_id)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  return (
    <>
      <PageHeader eyebrow="Administration · typed actions only" title="Workflow automation" />
      <Flash sp={sp} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
        <Card title="Create workflow">
          <form action={createWorkflow} className="space-y-3">
            <label className="block">
              <span className="label">Workflow name</span>
              <input className="input" name="name" required minLength={3} maxLength={120} placeholder="Overdue task reminder" />
            </label>
            <label className="block">
              <span className="label">When this happens</span>
              <select className="input" name="event_key">
                {EVENTS.map(([v, l]) => (
                  <option value={v} key={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Send notification to</span>
              <select className="input" name="recipient">
                <option value="actor">Person who triggered the event</option>
                <option value="event_target">Employee referenced by the event</option>
                <option value="manager">Event actor's manager</option>
                <option value="approval">Create manager approval request</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Approval SLA hours (used for approval action)</span>
              <input className="input" type="number" name="sla_hours" min="1" max="720" defaultValue="24" />
            </label>
            <label className="block">
              <span className="label">Approval details (optional)</span>
              <textarea className="input" name="details" maxLength={2000} />
            </label>
            <label className="block">
              <span className="label">Notification title / approval subject</span>
              <input className="input" name="title" required maxLength={120} placeholder="Task needs attention" />
            </label>
            <label className="block">
              <span className="label">Notification message</span>
              <textarea
                className="input min-h-24"
                name="body"
                required
                maxLength={1000}
                placeholder="A task assigned to you is approaching its deadline."
              />
            </label>
            <label className="block">
              <span className="label">In-app link (relative path)</span>
              <input className="input" name="link" maxLength={200} defaultValue="/tasks" />
            </label>
            <button className="btn-primary">Create workflow</button>
          </form>
        </Card>
        <Card title="How execution works">
          <div className="space-y-3 text-sm text-muted">
            <p>
              <strong className="text-ink">1. Trigger:</strong> a supported business event is emitted with an idempotency key and actor
              employee.
            </p>
            <p>
              <strong className="text-ink">2. Queue:</strong> matching enabled rules create durable workflow runs; duplicate event keys are
              ignored.
            </p>
            <p>
              <strong className="text-ink">3. Action:</strong> the trusted cron worker sends an in-app notification to the event actor or
              validated event target.
            </p>
            <p>
              <strong className="text-ink">4. Recovery:</strong> failed runs retry with bounded exponential backoff and retain error
              history.
            </p>
            <p className="rounded-lg border border-line p-3">
              Current action registry: <strong className="text-ink">Notify actor, event target, manager, or create approval</strong>.
              Manager and target recipients are validated as active same-organisation employees. Rules do not execute arbitrary SQL,
              scripts, external URLs or arbitrary recipient IDs.
            </p>
          </div>
        </Card>
      </div>
      <Card title={`Configured workflows · ${rules?.length ?? 0}`} className="mt-6">
        {!rules?.length ? (
          <Empty
            title="No workflows yet"
            hint="Create a rule above. It will become active when its business event is wired into the relevant module."
          />
        ) : (
          <TableWrap>
            <table className="table min-w-[760px]">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Trigger</th>
                  <th>Action</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Controls</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td className="font-semibold">{r.name}</td>
                    <td>
                      <code className="text-xs">{r.event_key}</code>
                    </td>
                    <td className="text-xs">
                      {Array.isArray(r.actions) && r.actions[0]?.type === "notify_target"
                        ? "Notify event target"
                        : r.actions[0]?.type === "notify_manager"
                          ? "Notify manager"
                          : r.actions[0]?.type === "create_approval"
                            ? "Create manager approval"
                            : "Notify event actor"}
                    </td>
                    <td>
                      <Badge>{r.enabled ? "ACTIVE" : "PAUSED"}</Badge>
                    </td>
                    <td className="text-xs">{fmtDateTime(r.created_at, ctx.timezone)}</td>
                    <td>
                      <div className="flex gap-2">
                        <form action={setWorkflowEnabled}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="enabled" value={String(!r.enabled)} />
                          <button className="btn-ghost">{r.enabled ? "Pause" : "Enable"}</button>
                        </form>
                        <form action={deleteWorkflow}>
                          <input type="hidden" name="id" value={r.id} />
                          <button className="btn-ghost text-danger">Delete</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      <Card title="Recent execution history" className="mt-6">
        {!runs?.length ? (
          <Empty title="No workflow runs" hint="Execution records appear when a module emits a matching event." />
        ) : (
          <TableWrap>
            <table className="table min-w-[680px]">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Event</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Last error</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="text-xs">{fmtDateTime(r.created_at, ctx.timezone)}</td>
                    <td>
                      <code className="text-xs">{r.event_key}</code>
                    </td>
                    <td>
                      <Badge>{r.status}</Badge>
                    </td>
                    <td>{r.attempts}</td>
                    <td className="max-w-xs truncate text-xs text-danger">{r.error_message ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
