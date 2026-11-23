import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext, can, canAny } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Field, Flash, PageHeader, TableWrap } from "@/components/ui";
import { fmtDateTime } from "@/lib/engines/time";
import { addMilestone, addProjectUpdate, addProjectMembers, createProjectChat, logProjectTime, moveMilestone } from "../actions";
export const metadata = { title: "Project workspace" };
export default async function ProjectWorkspace({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params,
    sp = await searchParams,
    ctx = await requireContext(),
    sb = await supabaseServer();
  const [{ data: p }, { data: milestones }, { data: updates }, { data: time }, { data: members }, { data: tasks }, { data: directory }] =
    await Promise.all([
      sb
        .from("projects")
        .select("id,name,description,status,priority,start_date,deadline,manager_id,client:clients(name)")
        .eq("id", id)
        .maybeSingle(),
      sb.from("project_milestones").select("id,title,description,status,due_date,owner_id").eq("project_id", id).order("sort_order"),
      sb
        .from("project_updates")
        .select("id,body,update_type,created_at,author_id")
        .eq("project_id", id)
        .order("created_at", { ascending: false })
        .limit(50),
      sb
        .from("project_time_entries")
        .select("id,work_date,hours,notes,status,billable,employee_id")
        .eq("project_id", id)
        .order("work_date", { ascending: false })
        .limit(100),
      sb.from("project_members").select("employee_id").eq("project_id", id),
      sb
        .from("tasks")
        .select("id,title,status,priority,deadline,assignee_id")
        .eq("project_id", id)
        .order("deadline", { ascending: true, nullsFirst: false })
        .limit(100),
      sb.from("employee_directory").select("id,full_name").order("full_name"),
    ]);
  if (!p) notFound();
  const manage = can(ctx, "projects.manage"),
    timeAllowed = can(ctx, "projects.time_log");
  const { data: projectChat } = await sb
    .from("chat_channels")
    .select("id")
    .eq("project_id", id)
    .eq("channel_type", "PROJECT")
    .maybeSingle();
  const financeVisible = canAny(ctx, ["finance.view", "finance.manage", "finance.pay"]);
  const [{ data: costRows }, { data: invoiceRows }] = await Promise.all(
    financeVisible
      ? [
          sb.from("finance_expenses").select("amount,status").eq("project_id", id).eq("status", "PAID"),
          sb.from("client_invoices").select("id,invoice_payments(amount)").eq("project_id", id),
        ]
      : [Promise.resolve({ data: [] }), Promise.resolve({ data: [] })],
  );
  const projectCosts = (costRows ?? []).reduce((n: number, x: any) => n + Number(x.amount), 0);
  const projectRevenue = (invoiceRows ?? []).reduce(
    (n: number, x: any) => n + (x.invoice_payments ?? []).reduce((v: number, p: any) => v + Number(p.amount), 0),
    0,
  );
  const memberName = (employeeId: string) => directory?.find((e: any) => e.id === employeeId)?.full_name ?? "Team member";
  const approvedHours = (time ?? []).filter((x: any) => x.status === "APPROVED").reduce((n: number, x: any) => n + Number(x.hours), 0);
  return (
    <>
      <PageHeader eyebrow="Project workspace" title={p.name}>
        <Link href="/projects" className="btn-ghost">
          All projects
        </Link>
        <Link href="/tasks?view=team" className="btn-ghost">
          Task board
        </Link>
      </PageHeader>
      <Flash sp={sp} />
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{p.status}</Badge>
          <Badge>{p.priority} priority</Badge>
          <span className="text-xs text-muted">
            {((p.client as unknown as { name?: string }[] | { name?: string } | null) instanceof Array
              ? (p.client as unknown as { name?: string }[])[0]?.name
              : (p.client as unknown as { name?: string } | null)?.name) ?? "Internal"}
          </span>
        </div>
        <p className="mt-3 max-w-3xl text-sm text-muted">{p.description || "No project description yet."}</p>
        <div className={`mt-4 grid grid-cols-2 gap-3 ${financeVisible ? "sm:grid-cols-3 lg:grid-cols-6" : "sm:grid-cols-4"}`}>
          <div>
            <p className="eyebrow">Start</p>
            <p className="mt-1 text-sm">{p.start_date || "—"}</p>
          </div>
          <div>
            <p className="eyebrow">Deadline</p>
            <p className="mt-1 text-sm">{p.deadline || "—"}</p>
          </div>
          <div>
            <p className="eyebrow">Milestones</p>
            <p className="mt-1 text-sm">
              {(milestones ?? []).filter((m: any) => m.status === "COMPLETED").length}/{milestones?.length ?? 0} complete
            </p>
          </div>
          <div>
            <p className="eyebrow">Approved hours</p>
            <p className="mt-1 text-sm tabular-nums">{approvedHours.toFixed(2)}h</p>
          </div>
          {financeVisible && (
            <>
              <div>
                <p className="eyebrow">Paid project costs</p>
                <p className="mt-1 text-sm tabular-nums">₹{projectCosts.toLocaleString("en-IN")}</p>
              </div>
              <div>
                <p className="eyebrow">Cash received</p>
                <p className="mt-1 text-sm tabular-nums">₹{projectRevenue.toLocaleString("en-IN")}</p>
              </div>
            </>
          )}
        </div>
      </Card>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
        <section className="space-y-6">
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Project team</h2>
                <p className="text-xs text-muted">{members?.length ?? 0} members</p>
              </div>
              <div className="flex gap-2">
                {projectChat ? (
                  <Link href={`/chat/${projectChat.id}`} className="btn-ghost px-3 py-1.5 text-xs">
                    Open project chat
                  </Link>
                ) : manage ? (
                  <form action={createProjectChat}>
                    <input type="hidden" name="project_id" value={id} />
                    <input type="hidden" name="name" value={`${p.name} discussion`} />
                    <button className="btn-primary px-3 py-1.5 text-xs">Create project chat</button>
                  </form>
                ) : null}
              </div>
            </div>
            {(members ?? []).map((m: any) => (
              <span key={m.employee_id} className="mr-2 inline-flex rounded-full border border-line px-3 py-1 text-xs">
                {memberName(m.employee_id)}
              </span>
            ))}
            {manage && (
              <form action={addProjectMembers} className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4">
                <input type="hidden" name="project_id" value={id} />
                <Field label="Add team members">
                  <select name="members" multiple size={4} className="input min-w-64">
                    {(directory ?? []).map((e: any) => (
                      <option key={e.id} value={e.id}>
                        {e.full_name}
                      </option>
                    ))}
                  </select>
                </Field>
                <button className="btn-ghost">Update roster</button>
              </form>
            )}
          </Card>
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Milestones</h2>
              <span className="text-xs text-muted">Delivery checkpoints</span>
            </div>
            {!milestones?.length ? (
              <Empty title="No milestones" hint="Add the major checkpoints for this project." />
            ) : (
              <div className="space-y-3">
                {milestones.map((m: any) => (
                  <div key={m.id} className="rounded-xl border border-line p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{m.title}</p>
                      <Badge>{m.status}</Badge>
                    </div>
                    {m.description && <p className="mt-1 text-sm text-muted">{m.description}</p>}
                    <div className="mt-2 flex items-center justify-between text-xs text-muted">
                      <span>{m.owner_id ? memberName(m.owner_id) : "Unassigned"}</span>
                      <span>{m.due_date ?? "No due date"}</span>
                    </div>
                    {manage && (
                      <form action={moveMilestone} className="mt-3 flex items-center gap-2">
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="project_id" value={id} />
                        <select name="status" defaultValue={m.status} className="input max-w-48 py-1 text-xs">
                          <option>PENDING</option>
                          <option>IN_PROGRESS</option>
                          <option>AT_RISK</option>
                          <option>COMPLETED</option>
                        </select>
                        <button className="btn-ghost px-3 py-1 text-xs">Update</button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}
            {manage && (
              <form action={addMilestone} className="mt-5 grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
                <input type="hidden" name="project_id" value={id} />
                <Field label="Milestone title">
                  <input name="title" required className="input" />
                </Field>
                <Field label="Owner">
                  <select name="owner_id" className="input">
                    <option value="">Unassigned</option>
                    {(directory ?? []).map((e: any) => (
                      <option key={e.id} value={e.id}>
                        {e.full_name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Due date">
                  <input name="due_date" type="date" className="input" />
                </Field>
                <Field label="Description">
                  <input name="description" className="input" />
                </Field>
                <div>
                  <button className="btn-primary">Add milestone</button>
                </div>
              </form>
            )}
          </Card>
          <Card>
            <h2 className="mb-4 font-semibold">Tasks in this project</h2>
            {!tasks?.length ? (
              <Empty title="No linked tasks" hint="Create tasks from the task board and assign them to this project." />
            ) : (
              <TableWrap>
                <table className="table min-w-[520px]">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Owner</th>
                      <th>Status</th>
                      <th>Deadline</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((t: any) => (
                      <tr key={t.id}>
                        <td className="font-medium">{t.title}</td>
                        <td>{t.assignee_id ? memberName(t.assignee_id) : "—"}</td>
                        <td>
                          <Badge>{t.status}</Badge>
                        </td>
                        <td>{t.deadline ? fmtDateTime(t.deadline, ctx.timezone) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </section>
        <section className="space-y-6">
          {can(ctx, "projects.updates") && (
            <Card>
              <h2 className="mb-4 font-semibold">Post project update</h2>
              <form action={addProjectUpdate} className="space-y-3">
                <input type="hidden" name="project_id" value={id} />
                <Field label="Update type">
                  <select name="update_type" className="input">
                    <option value="UPDATE">Progress update</option>
                    <option value="RISK">Risk / blocker</option>
                    <option value="DECISION">Decision</option>
                    <option value="MILESTONE">Milestone update</option>
                  </select>
                </Field>
                <Field label="Message">
                  <textarea name="body" required rows={4} className="input" placeholder="Share progress, blockers or decisions…" />
                </Field>
                <button className="btn-primary">Post update</button>
              </form>
            </Card>
          )}
          <Card>
            <h2 className="mb-4 font-semibold">Log project time</h2>
            {timeAllowed ? (
              <form action={logProjectTime} className="space-y-3">
                <input type="hidden" name="project_id" value={id} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Work date">
                    <input name="work_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="input" />
                  </Field>
                  <Field label="Hours">
                    <input name="hours" type="number" min="0.25" max="24" step="0.25" required className="input" />
                  </Field>
                </div>
                <Field label="Notes">
                  <textarea name="notes" rows={2} required className="input" placeholder="What work did you complete?" />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="billable" defaultChecked /> Billable time
                </label>
                <button className="btn-primary">Submit time</button>
              </form>
            ) : (
              <p className="text-sm text-muted">You do not have time logging access.</p>
            )}
          </Card>
          <Card>
            <h2 className="mb-4 font-semibold">Time entries</h2>
            {!time?.length ? (
              <Empty title="No time entries" hint="Project work logs will appear here." />
            ) : (
              <div className="space-y-3">
                {time.slice(0, 12).map((t: any) => (
                  <div key={t.id} className="flex items-start justify-between gap-3 border-b border-line pb-2 last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {memberName(t.employee_id)} · {Number(t.hours).toFixed(2)}h
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {t.work_date} · {t.notes}
                      </p>
                    </div>
                    <Badge>{t.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card>
            <h2 className="mb-4 font-semibold">Project activity</h2>
            {!updates?.length ? (
              <Empty title="No updates yet" hint="Updates from project members will appear here." />
            ) : (
              <div className="space-y-4">
                {updates.map((u: any) => (
                  <div key={u.id} className="border-l-2 border-volt pl-3">
                    <div className="flex justify-between gap-2">
                      <p className="text-sm font-semibold">{memberName(u.author_id)}</p>
                      <Badge>{u.update_type}</Badge>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{u.body}</p>
                    <p className="mt-1 text-xs text-muted">{fmtDateTime(u.created_at, ctx.timezone)}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </section>
      </div>
    </>
  );
}
