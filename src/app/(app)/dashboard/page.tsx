import Link from "next/link";
import { requireContext, can, canAny } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Flash, PageHeader, Stat, inr } from "@/components/ui";
import { localDate, localMinutes, timeToMinutes, zonedInstant, fmtDateTime, monthBounds } from "@/lib/engines/time";
import { computeForEmployee } from "@/lib/data/performance";
import { PunchCard } from "../attendance/punch-card";

export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const tz = ctx.timezone;
  const today = localDate(new Date(), tz);
  const dayStart = zonedInstant(today, "00:00", tz).toISOString();
  const nowIso = new Date().toISOString();
  const { start: mStart, end: mEnd } = monthBounds(today);

  const isPeople = canAny(ctx, ["people.view_all", "people.view_team"]);
  const isApprover = canAny(ctx, ["attendance.approve", "leave.approve", "tasks.review", "attendance.manage", "leave.manage"]);

  const [myTasks, myOverdue, myEvents, perf, team, todayEvents, pendingCorr, pendingLeave, pendingReview, projects, leads, run, activity] = await Promise.all([
    sb.from("tasks").select("id", { count: "exact", head: true }).eq("assignee_id", ctx.employee_id).not("status", "in", "(COMPLETED,CANCELLED)"),
    sb.from("tasks").select("id", { count: "exact", head: true }).eq("assignee_id", ctx.employee_id).not("status", "in", "(COMPLETED,CANCELLED)").lt("deadline", nowIso),
    sb.from("attendance_events").select("event_type, occurred_at").eq("employee_id", ctx.employee_id).gte("occurred_at", dayStart).order("occurred_at"),
    computeForEmployee(sb, ctx.employee_id, mStart, mEnd, tz),
    isPeople ? sb.from("employees").select("id, status, shift:shifts(start_time, grace_minutes, weekly_offs)").neq("id", ctx.employee_id) : Promise.resolve({ data: null }),
    isPeople ? sb.from("attendance_events").select("employee_id, event_type, occurred_at").gte("occurred_at", dayStart).eq("event_type", "CLOCK_IN").order("occurred_at") : Promise.resolve({ data: null }),
    isApprover ? sb.from("attendance_corrections").select("id", { count: "exact", head: true }).eq("status", "PENDING").neq("employee_id", ctx.employee_id) : Promise.resolve({ count: 0 }),
    isApprover ? sb.from("leave_requests").select("id", { count: "exact", head: true }).eq("status", "PENDING").neq("employee_id", ctx.employee_id) : Promise.resolve({ count: 0 }),
    can(ctx, "tasks.review") ? sb.from("tasks").select("id", { count: "exact", head: true }).eq("status", "REVIEW").neq("assignee_id", ctx.employee_id) : Promise.resolve({ count: 0 }),
    can(ctx, "projects.view_all") ? sb.from("projects").select("status") : Promise.resolve({ data: null }),
    canAny(ctx, ["crm.view_all", "crm.manage"]) ? sb.from("leads").select("status, created_at").is("duplicate_of", null).gte("created_at", zonedInstant(mStart, "00:00", tz).toISOString()) : Promise.resolve({ data: null }),
    can(ctx, "payroll.view_all") ? sb.from("payroll_runs").select("id, period_start, period_end, status").not("status", "in", "(CANCELLED)").order("period_start", { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
    can(ctx, "audit.view") ? sb.from("audit_events").select("id, action, entity, created_at").order("created_at", { ascending: false }).limit(8) : Promise.resolve({ data: null }),
  ]);

  // Team attendance today
  let teamStats: { total: number; active: number; present: number; late: number } | null = null;
  if (team.data) {
    const { data: datedSchedules } = await sb.from("schedule_assignments").select("employee_id,effective_from,effective_to,shift:shifts(start_time,grace_minutes,weekly_offs)").lte("effective_from", today).or(`effective_to.is.null,effective_to.gte.${today}`);
    const scheduleByEmployee = new Map((datedSchedules ?? []).map((a: any) => [a.employee_id, Array.isArray(a.shift) ? a.shift[0] : a.shift]));
    const firstIn = new Map<string, string>();
    for (const e of todayEvents.data ?? []) if (!firstIn.has(e.employee_id)) firstIn.set(e.employee_id, e.occurred_at);
    const active = team.data.filter((e: any) => e.status !== "EXITED");
    let late = 0;
    for (const e of active as any[]) {
      const t = firstIn.get(e.id); const sh = scheduleByEmployee.get(e.id) ?? (Array.isArray(e.shift) ? e.shift[0] : e.shift);
      if (t && sh && localMinutes(t, tz) > timeToMinutes(sh.start_time) + sh.grace_minutes) late++;
    }
    teamStats = { total: team.data.length, active: active.length, present: active.filter((e: any) => firstIn.has(e.id)).length, late };
  }

  let runTotal: number | null = null;
  if (run.data) {
    const { data: entries } = await sb.from("payroll_entries").select("net_amount").eq("run_id", run.data.id);
    runTotal = (entries ?? []).reduce((a, e) => a + Number(e.net_amount), 0);
    await sb.rpc("log_salary_access", { p_entity: "payroll_run", p_entity_id: run.data.id, p_subject: null, p_purpose: "dashboard summary" });
  }

  const approvals = (pendingCorr.count ?? 0) + (pendingLeave.count ?? 0) + (pendingReview.count ?? 0);
  const p = perf?.result;
  const hour = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: tz }).format(new Date()));
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHeader eyebrow={new Intl.DateTimeFormat("en-IN", { dateStyle: "full", timeZone: tz }).format(new Date())}
        title={`${greet}, ${ctx.full_name.split(" ")[0]}.`} />
      <Flash sp={sp} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {canAny(ctx, ["projects.workspace_view", "projects.view_all", "projects.manage"]) && <Link href="/projects" className="card flex items-center justify-between p-4 text-sm font-semibold hover:border-volt">Projects & delivery <span>→</span></Link>}
        {can(ctx, "communication.view") && <Link href="/chat" className="card flex items-center justify-between p-4 text-sm font-semibold hover:border-volt">Team chat <span>→</span></Link>}
        {can(ctx, "communication.view") && <Link href="/announcements" className="card flex items-center justify-between p-4 text-sm font-semibold hover:border-volt">Announcements <span>→</span></Link>}
        <Link href="/tasks" className="card flex items-center justify-between p-4 text-sm font-semibold hover:border-volt">Task board <span>→</span></Link>
        <Link href="/time" className="card flex items-center justify-between p-4 text-sm font-semibold hover:border-volt">Timesheets <span>→</span></Link>
        <Link href="/calendar" className="card flex items-center justify-between p-4 text-sm font-semibold hover:border-volt">Calendar <span>→</span></Link>
        <Link href="/teams" className="card flex items-center justify-between p-4 text-sm font-semibold hover:border-volt">Teams & groups <span>→</span></Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <PunchCard events={myEvents.data ?? []} tz={tz} />
        <div className="grid grid-cols-2 gap-4 lg:col-span-2">
          <Stat label="My open tasks" value={myTasks.count ?? 0} href="/tasks" />
          <Stat label="My overdue" value={myOverdue.count ?? 0} tone={(myOverdue.count ?? 0) > 0 ? "danger" : undefined} href="/tasks?view=overdue" />
          <Stat label="Performance · this month" value={p?.score ?? "—"} hint={p?.score === null ? `Insufficient data (${p?.coverage ?? 0}% coverage)` : p?.category?.replaceAll("_", " ")}
            tone="volt" href="/analytics/my-performance" />
          {isApprover
            ? <Stat label="Waiting on me" value={approvals} tone={approvals ? "ember" : undefined} href="/approvals" hint="Corrections, leave, task reviews" />
            : <Stat label="Attendance · this month" value={perf?.attendance?.attendancePct === null || !perf?.attendance ? "—" : `${perf.attendance.attendancePct}%`} href="/attendance" />}
        </div>
      </div>

      {teamStats && (
        <>
          <h2 className="eyebrow mb-3 mt-10">{can(ctx, "people.view_all") ? "Organisation today" : "My team today"}</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="People" value={teamStats.total} href="/people" />
            <Stat label="Active" value={teamStats.active} />
            <Stat label="Clocked in today" value={teamStats.present} hint={`${teamStats.active - teamStats.present} not yet`} tone="signal" />
            <Stat label="Late arrivals" value={teamStats.late} tone={teamStats.late ? "ember" : undefined} />
          </div>
        </>
      )}

      {(projects.data || leads.data || run.data) && (
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {projects.data && (
            <Card title="Projects">
              <div className="grid grid-cols-2 gap-4">
                <div><p className="display text-4xl">{projects.data.filter((x) => x.status === "ACTIVE").length}</p><p className="text-xs text-muted">Active</p></div>
                <div><p className="display text-4xl">{projects.data.filter((x) => x.status === "COMPLETED").length}</p><p className="text-xs text-muted">Completed</p></div>
              </div>
            </Card>
          )}
          {leads.data && (
            <Card title="Leads · this month" action={<Link href="/leads" className="text-xs text-muted hover:text-ink">Open CRM →</Link>}>
              <div className="grid grid-cols-3 gap-4">
                <div><p className="display text-4xl">{leads.data.length}</p><p className="text-xs text-muted">New in</p></div>
                <div><p className="display text-4xl">{leads.data.filter((l) => ["QUALIFIED", "PROPOSAL", "NEGOTIATION"].includes(l.status)).length}</p><p className="text-xs text-muted">Qualified+</p></div>
                <div><p className="display text-4xl text-volt">{leads.data.filter((l) => l.status === "WON").length}</p><p className="text-xs text-muted">Won</p></div>
              </div>
            </Card>
          )}
          {run.data && (
            <Card title="Latest payroll" action={<Link href={`/payroll/runs/${run.data.id}`} className="text-xs text-muted hover:text-ink">Open →</Link>}>
              <p className="display text-4xl">{inr(runTotal)}</p>
              <p className="mt-2 flex items-center gap-2 text-xs text-muted">{run.data.period_start} → {run.data.period_end} <Badge>{run.data.status}</Badge></p>
            </Card>
          )}
        </div>
      )}

      {activity.data && (
        <Card title="Recent organisational activity" className="mt-10" action={<Link href="/settings/audit-logs" className="text-xs text-muted hover:text-ink">Audit log →</Link>}>
          {activity.data.length === 0 ? <Empty title="Quiet so far" /> : (
            <ul className="divide-y divide-line">
              {activity.data.map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                  <span className="font-mono text-xs">{a.action}</span>
                  <span className="text-xs text-muted">{fmtDateTime(a.created_at, tz)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
