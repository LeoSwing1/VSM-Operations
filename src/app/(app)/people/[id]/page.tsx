import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext, can, ROLE_LABEL, type Role } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { loadAttendance, minutesToHm } from "@/lib/data/attendance";
import { computeForEmployee } from "@/lib/data/performance";
import { Badge, Card, Empty, Flash, Meter, PageHeader, Stat, TableWrap, Tabs, inr } from "@/components/ui";
import { fmtDate, fmtDateTime, localDate, monthBounds } from "@/lib/engines/time";
import { EmployeeFields } from "../employee-form";
import { resendInvite, updateEmployee } from "../actions";
import { assignableRoles } from "@/lib/data/roles";

export const metadata = { title: "Employee 360" };

const TABS = [
  { key: "overview", label: "Overview" }, { key: "attendance", label: "Attendance" }, { key: "tasks", label: "Tasks" },
  { key: "updates", label: "Daily updates" }, { key: "leave", label: "Leave" }, { key: "performance", label: "Performance" },
  { key: "salary", label: "Salary" }, { key: "activity", label: "Activity" },
];

export default async function Employee360({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const { data: e } = await sb.from("employees")
    .select("*, department:departments(name), manager:employees!employees_manager_id_fkey(id, full_name), shift:shifts(name, start_time, end_time)")
    .eq("id", id).maybeSingle();
  if (!e) notFound();      // RLS: out of scope looks identical to non-existent
  const self = id === ctx.employee_id;
  const manage = can(ctx, "people.manage");
  const salaryAllowed = self || can(ctx, "payroll.view_all");
  const tabs = [...TABS.filter((t) => t.key !== "salary" || salaryAllowed).filter((t) => t.key !== "activity" || can(ctx, "audit.view")),
    ...(manage ? [{ key: "edit", label: "Edit" }] : [])];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : "overview";
  const tz = ctx.timezone;
  const { start, end } = monthBounds(localDate(new Date(), tz));

  return (
    <>
      <PageHeader eyebrow={`${e.employee_code} · ${ROLE_LABEL[e.role as Role]}`} title={e.full_name}>
        <Badge>{e.status}</Badge>
      </PageHeader>
      <Flash sp={sp} />
      <Tabs tabs={tabs} active={tab} base={`/people/${id}`} />

      {tab === "overview" && <Overview e={e} manage={manage} />}
      {tab === "attendance" && <AttendanceTab sb={sb} id={id} start={start} end={end} tz={tz} />}
      {tab === "tasks" && <TasksTab sb={sb} id={id} tz={tz} />}
      {tab === "updates" && <UpdatesTab sb={sb} id={id} />}
      {tab === "leave" && <LeaveTab sb={sb} id={id} />}
      {tab === "performance" && <PerformanceTab sb={sb} id={id} start={start} end={end} tz={tz} />}
      {tab === "salary" && salaryAllowed && <SalaryTab sb={sb} id={id} />}
      {tab === "activity" && can(ctx, "audit.view") && <ActivityTab sb={sb} id={id} tz={tz} />}
      {tab === "edit" && manage && <EditTab sb={sb} e={e} assignable={await assignableRoles(sb, ctx)} />}
    </>
  );
}

type SB = Awaited<ReturnType<typeof supabaseServer>>;

function Overview({ e, manage }: { e: any; manage: boolean }) {
  const rows: [string, React.ReactNode][] = [
    ["Official email", e.official_email], ["Phone", e.phone ?? "—"], ["Designation", e.designation ?? "—"],
    ["Department", e.department?.name ?? "—"],
    ["Reporting manager", e.manager ? <Link href={`/people/${e.manager.id}`} className="hover:text-volt">{e.manager.full_name}</Link> : "—"],
    ["Joining date", fmtDate(e.joining_date)], ["Employment", `${e.employment_type.replace("_", " ")}`],
    ["Work location", e.work_location ?? "—"], ["Shift", e.shift ? `${e.shift.name} (${e.shift.start_time.slice(0, 5)}–${e.shift.end_time.slice(0, 5)})` : "—"],
    ["Skills", e.skills?.length ? e.skills.join(", ") : "—"],
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Profile" className="lg:col-span-2">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="mt-0.5 text-sm">{v}</dd></div>)}
        </dl>
      </Card>
      <Card title="Account">
        <p className="text-sm">{e.user_id ? "Sign-in linked." : "No sign-in yet."}</p>
        {!e.user_id && manage && (
          <form action={resendInvite} className="mt-3"><input type="hidden" name="id" value={e.id} /><button className="btn-ghost">Send invitation</button></form>
        )}
      </Card>
    </div>
  );
}

async function AttendanceTab({ sb, id, start, end, tz }: { sb: SB; id: string; start: string; end: string; tz: string }) {
  const s = await loadAttendance(sb, id, start, end, tz);
  if (!s) return <Empty title="Attendance not visible" hint="You don't have attendance access for this employee." />;
  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Attendance · month" value={s.attendancePct === null ? "—" : `${s.attendancePct}%`} tone="volt" />
        <Stat label="Worked" value={minutesToHm(s.totalWorkedMinutes)} />
        <Stat label="Late" value={s.lateArrivals} />
        <Stat label="Loss of pay" value={`${s.lopDays}d`} />
      </div>
      <Link href={`/attendance?employee=${id}`} className="btn-ghost mt-4">Open full attendance →</Link>
    </>
  );
}

async function TasksTab({ sb, id, tz }: { sb: SB; id: string; tz: string }) {
  const { data } = await sb.from("tasks").select("id, title, status, deadline, quality_score, project:projects(name)").eq("assignee_id", id).order("created_at", { ascending: false }).limit(30);
  if (!data?.length) return <Empty title="No visible tasks" />;
  return (
    <Card><TableWrap><table className="table min-w-[600px]">
      <thead><tr><th>Task</th><th>Project</th><th>Status</th><th>Deadline</th><th>Quality</th></tr></thead>
      <tbody>{data.map((t: any) => (
        <tr key={t.id}><td>{t.title}</td><td className="text-muted">{t.project?.name ?? "—"}</td><td><Badge>{t.status}</Badge></td>
          <td className="text-xs">{t.deadline ? fmtDateTime(t.deadline, tz) : "—"}</td><td className="tabular-nums">{t.quality_score ?? "—"}</td></tr>))}
      </tbody></table></TableWrap></Card>
  );
}

async function UpdatesTab({ sb, id }: { sb: SB; id: string }) {
  const { data } = await sb.from("daily_updates").select("id, work_date, completed, blockers, minutes_spent, manager_comment").eq("employee_id", id).order("work_date", { ascending: false }).limit(20);
  if (!data?.length) return <Empty title="No daily updates" />;
  return <div className="space-y-3">{data.map((u) => (
    <Card key={u.id} title={fmtDate(u.work_date)}>
      <p className="whitespace-pre-wrap text-sm">{u.completed}</p>
      {u.blockers && <p className="mt-2 text-sm text-ember">Blockers: {u.blockers}</p>}
      {u.manager_comment && <p className="mt-2 text-xs text-muted">Manager: {u.manager_comment}</p>}
    </Card>))}</div>;
}

async function LeaveTab({ sb, id }: { sb: SB; id: string }) {
  const { data } = await sb.from("leave_requests").select("id, start_date, end_date, half_day, status, reason, leave_type:leave_types(name)").eq("employee_id", id).order("start_date", { ascending: false }).limit(30);
  if (!data?.length) return <Empty title="No leave records" />;
  return <Card><TableWrap><table className="table min-w-[560px]"><thead><tr><th>Type</th><th>From</th><th>To</th><th>Status</th><th>Reason</th></tr></thead>
    <tbody>{data.map((l: any) => <tr key={l.id}><td>{l.leave_type?.name}{l.half_day ? " (½)" : ""}</td><td>{fmtDate(l.start_date)}</td><td>{fmtDate(l.end_date)}</td><td><Badge>{l.status}</Badge></td><td className="text-muted">{l.reason}</td></tr>)}</tbody>
  </table></TableWrap></Card>;
}

async function PerformanceTab({ sb, id, start, end, tz }: { sb: SB; id: string; start: string; end: string; tz: string }) {
  const [live, { data: snaps }] = await Promise.all([
    computeForEmployee(sb, id, start, end, tz),
    sb.from("performance_snapshots").select("id, period_start, period_end, final_score, category, status").eq("employee_id", id).order("period_start", { ascending: false }).limit(12),
  ]);
  if (!live) return <Empty title="Performance not visible" />;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="This month (live)">
        <p className="display text-6xl">{live.result.score ?? "—"}</p>
        <p className="mt-1 text-xs text-muted">{live.result.score === null ? `Insufficient data · ${live.result.coverage}% coverage` : `${live.result.category?.replaceAll("_", " ")} · ${live.result.coverage}% coverage`}</p>
        <div className="mt-5 space-y-3">{live.result.components.map((c) => <Meter key={c.key} label={`${c.label} · ${c.weight}%`} value={c.score} />)}</div>
      </Card>
      <Card title="Snapshots">
        {!snaps?.length ? <Empty title="No snapshots yet" /> : <ul className="divide-y divide-line">{snaps.map((s) => (
          <li key={s.id} className="flex items-center justify-between py-2 text-sm"><span>{fmtDate(s.period_start)} – {fmtDate(s.period_end)}</span>
            <span className="flex items-center gap-2"><b className="tabular-nums">{s.final_score ?? "—"}</b><Badge>{s.status}</Badge></span></li>))}</ul>}
      </Card>
    </div>
  );
}

async function SalaryTab({ sb, id }: { sb: SB; id: string }) {
  const { data } = await sb.from("salary_structures").select("id, effective_from, effective_to, pay_type, base_monthly, target_incentive, allowances").eq("employee_id", id).order("effective_from", { ascending: false });
  await sb.rpc("log_salary_access", { p_entity: "employee", p_entity_id: id, p_subject: id, p_purpose: "employee 360 salary tab" });
  if (!data?.length) return <Empty title="No salary structure" hint="Payroll admins add structures under Payroll → Structures." />;
  return <Card title="Salary history (confidential)"><TableWrap><table className="table min-w-[560px]">
    <thead><tr><th>Effective</th><th>Type</th><th>Base / month</th><th>Allowances</th><th>Target incentive</th></tr></thead>
    <tbody>{data.map((s: any) => <tr key={s.id}><td>{fmtDate(s.effective_from)} → {s.effective_to ? fmtDate(s.effective_to) : "current"}</td><td className="text-xs">{s.pay_type.replaceAll("_", " ")}</td>
      <td className="tabular-nums">{inr(s.base_monthly)}</td><td className="tabular-nums">{inr((s.allowances ?? []).reduce((a: number, x: any) => a + Number(x.amount), 0))}</td><td className="tabular-nums">{inr(s.target_incentive)}</td></tr>)}</tbody>
  </table></TableWrap></Card>;
}

async function ActivityTab({ sb, id, tz }: { sb: SB; id: string; tz: string }) {
  const { data } = await sb.from("audit_events").select("id, action, metadata, created_at").eq("entity_id", id).order("created_at", { ascending: false }).limit(50);
  if (!data?.length) return <Empty title="No recorded activity" />;
  return <Card><ul className="divide-y divide-line">{data.map((a) => (
    <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span className="font-mono text-xs">{a.action}</span><span className="text-xs text-muted">{fmtDateTime(a.created_at, tz)}</span></li>))}</ul></Card>;
}

async function EditTab({ sb, e, assignable }: { sb: SB; e: any; assignable: { role: Role; label: string }[] }) {
  const [{ data: depts }, { data: shifts }, { data: dir }] = await Promise.all([
    sb.from("departments").select("id, name").order("name"), sb.from("shifts").select("id, name"), sb.from("employee_directory").select("id, full_name").order("full_name"),
  ]);
  return (
    <Card title="Edit employee">
      <form action={updateEmployee} className="space-y-4">
        <input type="hidden" name="id" value={e.id} />
        <EmployeeFields e={e} departments={(depts ?? []) as any} managers={(dir ?? []).map((d) => ({ id: d.id, name: d.full_name }))} shifts={(shifts ?? []) as any} assignable={assignable} />
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block"><span className="label">Status</span><select name="status" defaultValue={e.status} className="input">
            {["ACTIVE", "PROBATION", "NOTICE", "ON_LEAVE", "EXITED"].map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="block"><span className="label">Exit date</span><input type="date" name="exit_date" defaultValue={e.exit_date ?? ""} className="input" /></label>
        </div>
        <button className="btn-primary">Save changes</button>
      </form>
    </Card>
  );
}
