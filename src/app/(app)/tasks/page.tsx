import Link from "next/link";
import { requireContext, can, canAny } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Field, Flash, PageHeader, TableWrap } from "@/components/ui";
import { fmtDateTime } from "@/lib/engines/time";
import { createProject, createTask, moveTask } from "./actions";
import clsx from "clsx";

export const metadata = { title: "Tasks" };
const COLUMNS = ["BACKLOG", "TODO", "IN_PROGRESS", "BLOCKED", "REVIEW", "COMPLETED"] as const;
const NEXT: Record<string, { to: string; label: string }[]> = {
  BACKLOG: [{ to: "TODO", label: "Plan" }], TODO: [{ to: "IN_PROGRESS", label: "Start" }],
  IN_PROGRESS: [{ to: "REVIEW", label: "Submit for review" }, { to: "BLOCKED", label: "Blocked" }],
  BLOCKED: [{ to: "IN_PROGRESS", label: "Unblock" }], REVIEW: [], COMPLETED: [], CANCELLED: [],
};

export default async function Tasks({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const team = canAny(ctx, ["tasks.view_all", "tasks.view_team"]);
  const view = ["mine", "team", "overdue", "kanban"].includes(sp.view ?? "") ? sp.view! : "mine";
  const now = new Date().toISOString();

  let q = sb.from("tasks").select("id, title, status, priority, deadline, quality_score, reopen_count, assignee_id, assigned_by, estimated_hours, actual_hours, assignee:employees!tasks_assignee_id_fkey(full_name), project:projects(name)")
    .order("deadline", { ascending: true, nullsFirst: false }).limit(300);
  if (view === "mine" || (view === "kanban" && !team)) q = q.eq("assignee_id", ctx.employee_id);
  if (view === "team") q = q.neq("assignee_id", ctx.employee_id);
  if (view === "overdue") q = q.lt("deadline", now).not("status", "in", "(COMPLETED,CANCELLED)");
  if (view !== "overdue" && sp.done !== "1") q = q.neq("status", "CANCELLED");
  const [{ data: tasks }, { data: dir }, { data: projects }, { data: clients }, { data: timeRows }] = await Promise.all([
    q, sb.from("employee_directory").select("id, full_name").order("full_name"), sb.from("projects").select("id, name").neq("status", "CANCELLED").order("name"),
    can(ctx, "projects.manage") ? sb.from("clients").select("id, name").order("name") : Promise.resolve({ data: [] }),
    sb.from("task_time_entries").select("task_id,minutes,status").eq("status", "APPROVED"),
  ]);
  const canAssignOthers = can(ctx, "tasks.manage");
  const back = `/tasks?view=${view}`;

  const Actions = ({ t }: { t: any }) => t.assignee_id !== ctx.employee_id ? null : (
    <div className="flex flex-wrap gap-1">{NEXT[t.status]?.map((n) => (
      <form key={n.to} action={moveTask} className="flex gap-1">
        <input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value={n.to} /><input type="hidden" name="back" value={back} />
        {n.to === "REVIEW" && <input name="actual_hours" type="number" step="0.25" min="0" placeholder="hrs" aria-label="Actual hours" className="input w-16 py-1 text-xs" defaultValue={t.actual_hours ?? ""} />}
        <button className="btn-ghost px-2 py-1 text-xs">{n.label}</button>
      </form>))}</div>
  );
  const overdue = (t: any) => t.deadline && t.deadline < now && !["COMPLETED", "CANCELLED"].includes(t.status);

  return (
    <>
      <PageHeader eyebrow="Work" title="Tasks">
        <Link className="btn-ghost" href="/time">Timesheets</Link>
        <Link className="btn-ghost" href="/quality">Quality register</Link>
        {[["mine", "My tasks"], ...(team ? [["team", "Team tasks"]] : []), ["overdue", "Overdue"], ["kanban", "Kanban"]].map(([k, l]) => (
          <Link key={k} href={`/tasks?view=${k}`} className={view === k ? "btn-primary" : "btn-ghost"}>{l}</Link>))}
      </PageHeader>
      <Flash sp={sp} />

      <details className="card mb-6 p-5" open={!!sp.new}>
        <summary className="cursor-pointer eyebrow">New task</summary>
        <form action={createTask} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Title" className="sm:col-span-2"><input name="title" required className="input" /></Field>
          <Field label="Assignee"><select name="assignee_id" className="input" defaultValue={ctx.employee_id}>
            {(canAssignOthers ? dir ?? [] : (dir ?? []).filter((d) => d.id === ctx.employee_id)).map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}</select></Field>
          <Field label="Project"><select name="project_id" className="input"><option value="">—</option>{(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Priority"><select name="priority" className="input" defaultValue="MEDIUM">{["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => <option key={p}>{p}</option>)}</select></Field>
          <Field label="Deadline (IST)"><input type="datetime-local" name="deadline" className="input" /></Field>
          <Field label="Estimate (hours)"><input type="number" name="estimated_hours" min="0" step="0.25" className="input" /></Field>
          <Field label="Description" className="sm:col-span-2 lg:col-span-4"><textarea name="description" rows={2} className="input" /></Field>
          <div><button className="btn-primary">Create task</button></div>
        </form>
        {can(ctx, "projects.manage") && (
          <form action={createProject} className="mt-6 flex flex-wrap items-end gap-2 border-t border-line pt-4">
            <Field label="New project"><input name="name" className="input" required /></Field>
            <Field label="Client"><select name="client_id" className="input"><option value="">Internal</option>{(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Deadline"><input type="date" name="deadline" className="input" /></Field>
            <button className="btn-ghost">Create project</button>
          </form>
        )}
      </details>

      {!tasks?.length ? <Empty title={view === "overdue" ? "Nothing overdue" : "No tasks"} hint="Tasks assigned to you appear here." /> : view === "kanban" ? (
        <div className="-mx-4 overflow-x-auto px-4"><div className="grid min-w-[1100px] grid-cols-6 gap-3">
          {COLUMNS.map((col) => (
            <div key={col} className="rounded-2xl border border-line p-3">
              <p className="eyebrow mb-3 flex justify-between">{col.replace("_", " ")}<span>{tasks.filter((t) => t.status === col).length}</span></p>
              <div className="space-y-2">{tasks.filter((t) => t.status === col).map((t: any) => (
                <div key={t.id} id={t.id} className={clsx("rounded-xl border bg-panel p-3 text-sm", sp.focus === t.id ? "border-volt" : "border-line")}>
                  <p className="font-semibold">{t.title}</p>
                  <p className="mt-1 text-xs text-muted">{t.assignee?.full_name ?? "—"}{t.project ? ` · ${t.project.name}` : ""}</p>
                  {t.deadline && <p className={clsx("mt-1 text-xs", overdue(t) ? "text-danger" : "text-muted")}>{fmtDateTime(t.deadline, ctx.timezone)}</p>}
                  <div className="mt-2"><Actions t={t} /></div>
                </div>))}</div>
            </div>))}
        </div></div>
      ) : (
        <Card><TableWrap><table className="table min-w-[860px]">
          <thead><tr><th>Task</th><th>Assignee</th><th>Status</th><th>Priority</th><th>Deadline</th><th>Logged</th><th>Quality</th><th></th></tr></thead>
          <tbody>{tasks.map((t: any) => (
            <tr key={t.id} id={t.id} className={sp.focus === t.id ? "bg-volt/5" : ""}>
              <td><p className="font-semibold">{t.title}</p><p className="text-xs text-muted">{t.project?.name ?? "No project"}{t.reopen_count ? ` · reworked ×${t.reopen_count}` : ""}</p></td>
              <td className="text-muted">{t.assignee?.full_name ?? "—"}</td>
              <td><Badge>{overdue(t) ? "OVERDUE" : t.status}</Badge></td>
              <td className="text-xs">{t.priority}</td>
              <td className="whitespace-nowrap text-xs">{t.deadline ? fmtDateTime(t.deadline, ctx.timezone) : "—"}</td>
              <td className="tabular-nums">{((timeRows ?? []).filter((r: any) => r.task_id === t.id).reduce((n: number, r: any) => n + r.minutes, 0) / 60).toFixed(1)}h</td>
              <td className="tabular-nums">{t.quality_score ?? "—"}</td>
              <td><Actions t={t} /></td>
            </tr>))}</tbody>
        </table></TableWrap></Card>
      )}
    </>
  );
}
