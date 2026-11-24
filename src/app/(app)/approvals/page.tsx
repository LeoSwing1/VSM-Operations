import { LiveSync } from "@/components/live-sync";
import { requirePerm, can } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Empty, Flash, PageHeader } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/engines/time";
import { decide, decideWorkflowApproval } from "./actions";
import { reviewTask } from "../tasks/actions";
import { DecisionButtons } from "@/components/decision-buttons";

export const metadata = { title: "Approvals" };

export default async function Approvals({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePerm("attendance.approve", "leave.approve", "tasks.review", "attendance.manage", "leave.manage");
  const sb = await supabaseServer();
  const [corr, leave, review, workflowApprovals] = await Promise.all([
    sb
      .from("attendance_corrections")
      .select("id, event_type, requested_time, reason, created_at, employee:employees!attendance_corrections_employee_id_fkey(full_name)")
      .eq("status", "PENDING")
      .neq("employee_id", ctx.employee_id)
      .order("created_at"),
    sb
      .from("leave_requests")
      .select(
        "id, start_date, end_date, half_day, reason, created_at, leave_type:leave_types(name, is_paid), employee:employees!leave_requests_employee_id_fkey(full_name)",
      )
      .eq("status", "PENDING")
      .neq("employee_id", ctx.employee_id)
      .order("start_date"),
    can(ctx, "tasks.review")
      ? sb
          .from("tasks")
          .select(
            "id, title, submitted_at, deadline, estimated_hours, actual_hours, reopen_count, assignee:employees!tasks_assignee_id_fkey(full_name)",
          )
          .eq("status", "REVIEW")
          .neq("assignee_id", ctx.employee_id)
          .order("submitted_at")
      : Promise.resolve({ data: [] }),
    sb
      .from("workflow_approval_cases")
      .select("id,subject,details,due_at,created_at,requester:employees!workflow_approval_cases_requester_id_fkey(full_name)")
      .eq("status", "PENDING")
      .eq("approver_id", ctx.employee_id)
      .order("due_at"),
  ]);
  const total = (corr.data?.length ?? 0) + (leave.data?.length ?? 0) + (review.data?.length ?? 0) + (workflowApprovals.data?.length ?? 0);

  const Decide = ({ kind, id, requireNote }: { kind: string; id: string; requireNote?: boolean }) => (
    <form action={decide} className="mt-3 flex flex-wrap gap-2">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input
        name="note"
        className="input min-w-[180px] flex-1"
        placeholder={requireNote ? "Comment (required to reject)" : "Comment (optional)"}
      />
      <DecisionButtons />
    </form>
  );

  return (
    <>
      <PageHeader eyebrow={`${total} waiting`} title="Approvals" />
      <LiveSync tables={["leave_requests", "attendance_corrections", "tasks", "workflow_approval_cases"]} />
      <Flash sp={sp} />
      {total === 0 && <Empty title="Inbox zero" hint="Nothing needs your decision right now." />}

      {!!workflowApprovals.data?.length && <h2 className="eyebrow mb-3">Workflow approvals</h2>}
      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        {workflowApprovals.data?.map((a: any) => (
          <Card key={a.id} title={a.subject}>
            <p className="text-sm">
              Requested by <b>{a.requester?.full_name ?? "Employee"}</b>
            </p>
            <p className="mt-1 text-sm text-muted">{a.details}</p>
            <p className="mt-2 text-xs text-muted">Decision due {fmtDateTime(a.due_at, ctx.timezone)}</p>
            <form action={decideWorkflowApproval} className="mt-3 flex flex-wrap gap-2">
              <input type="hidden" name="id" value={a.id} />
              <input name="note" className="input min-w-[180px] flex-1" placeholder="Decision note" />
              <DecisionButtons />
            </form>
          </Card>
        ))}
      </div>
      {!!leave.data?.length && <h2 className="eyebrow mb-3">Leave</h2>}
      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        {leave.data?.map((l: any) => (
          <Card key={l.id} title={l.employee?.full_name ?? "Employee"}>
            <p className="text-sm">
              <b>{l.leave_type?.name}</b>
              {!l.leave_type?.is_paid && " (unpaid)"} · {fmtDate(l.start_date)}
              {l.end_date !== l.start_date ? ` → ${fmtDate(l.end_date)}` : ""}
              {l.half_day ? " · half day" : ""}
            </p>
            <p className="mt-1 text-sm text-muted">{l.reason}</p>
            <Decide kind="leave" id={l.id} requireNote />
          </Card>
        ))}
      </div>

      {!!corr.data?.length && <h2 className="eyebrow mb-3">Attendance corrections</h2>}
      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        {corr.data?.map((c: any) => (
          <Card key={c.id} title={c.employee?.full_name ?? "Employee"}>
            <p className="text-sm">
              Add <b>{c.event_type.replace("_", " ").toLowerCase()}</b> at {fmtDateTime(c.requested_time, ctx.timezone)}
            </p>
            <p className="mt-1 text-sm text-muted">{c.reason}</p>
            <Decide kind="correction" id={c.id} />
          </Card>
        ))}
      </div>

      {!!review.data?.length && <h2 className="eyebrow mb-3">Task reviews — quality is scored separately from completion</h2>}
      <div className="grid gap-4 lg:grid-cols-2">
        {review.data?.map((t: any) => (
          <Card key={t.id} title={t.assignee?.full_name ?? "Employee"}>
            <p className="font-semibold">{t.title}</p>
            <p className="mt-1 text-xs text-muted">
              Submitted {t.submitted_at ? fmtDateTime(t.submitted_at, ctx.timezone) : "—"}
              {t.deadline ? ` · due ${fmtDateTime(t.deadline, ctx.timezone)}` : ""} · {t.estimated_hours ?? "?"}h est /{" "}
              {t.actual_hours ?? "?"}h actual{t.reopen_count ? ` · reworked ×${t.reopen_count}` : ""}
            </p>
            <form action={reviewTask} className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={t.id} />
              <input type="hidden" name="back" value="/approvals" />
              <label className="w-24">
                <span className="label">Quality 0–100</span>
                <input name="quality" type="number" min="0" max="100" className="input" />
              </label>
              <input name="note" className="input min-w-[160px] flex-1" placeholder="Feedback for the employee" />
              <DecisionButtons
                choices={[
                  { value: "approve", label: "Approve", className: "btn-primary" },
                  { value: "reject", label: "Send back", className: "btn-danger" },
                ]}
              />
            </form>
          </Card>
        ))}
      </div>
    </>
  );
}
