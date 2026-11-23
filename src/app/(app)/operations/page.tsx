import { LiveSync } from "@/components/live-sync";
import Link from "next/link";
import clsx from "clsx";
import { redirect } from "next/navigation";
import { can, canAny, requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Flash, PageHeader } from "@/components/ui";
import { fmtDateTime, fmtTime, localDate, localMinutes, timeToMinutes, weekday, zonedInstant } from "@/lib/engines/time";
import { AutoRefresh } from "./auto-refresh";
import { retryAllDeliveries, retryWorkflowRuns, reviewFlaggedPunch, runWorkersNow } from "./actions";

export const metadata = { title: "Operations Center" };
export const dynamic = "force-dynamic";

type Live = "IN" | "BREAK" | "OUT" | "LEAVE" | "OFF" | "NOT_IN";
const LIVE_LABEL: Record<Live, string> = {
  IN: "Working",
  BREAK: "On break",
  OUT: "Clocked out",
  LEAVE: "On leave",
  OFF: "Week off / holiday",
  NOT_IN: "Not clocked in",
};
const LIVE_TONE: Record<Live, "green" | "amber" | "grey" | "red"> = {
  IN: "green",
  BREAK: "amber",
  OUT: "grey",
  LEAVE: "grey",
  OFF: "grey",
  NOT_IN: "red",
};
const age = (iso: string) => {
  const h = (Date.now() - Date.parse(iso)) / 3600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
};

export default async function Operations({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!canAny(ctx, ["settings.manage", "attendance.manage", "attendance.approve", "people.view_all", "people.view_team"]))
    redirect("/dashboard?e=" + encodeURIComponent("The Operations Center is for managers and admins."));
  const admin = can(ctx, "settings.manage");
  const auditor = can(ctx, "audit.view");
  const tz = ctx.timezone;
  const now = new Date();
  const today = localDate(now, tz);
  const dayStart = zonedInstant(today, "00:00", tz).toISOString();
  const nowIso = now.toISOString();
  const since24 = new Date(Date.now() - 86400_000).toISOString();
  const sb = await supabaseServer();
  const none = Promise.resolve({ data: null, count: null, error: null });

  const [
    { data: emps },
    { data: shifts },
    { data: events },
    { data: leaves },
    { data: holiday },
    { data: pendLeave },
    { data: pendCorr },
    { data: pendFlow },
    { data: pendExp },
    { data: overdue },
    { count: blocked },
    { count: review },
    { data: runs },
    { data: failedRuns },
    { data: mail },
    { data: deliveries },
    { data: health },
    { data: audit },
  ] = await Promise.all([
    sb.from("employees").select("id, full_name, designation, shift_id").neq("status", "EXITED").order("full_name").limit(500),
    sb.from("shifts").select("id, name, start_time, grace_minutes, weekly_offs"),
    sb.from("attendance_events").select("employee_id, event_type, occurred_at").gte("occurred_at", dayStart).order("occurred_at"),
    sb.from("leave_requests").select("employee_id, half_day").eq("status", "APPROVED").lte("start_date", today).gte("end_date", today),
    sb.from("holidays").select("name").eq("holiday_date", today).maybeSingle(),
    sb.from("leave_requests").select("id, created_at").eq("status", "PENDING").order("created_at").limit(200),
    sb.from("attendance_corrections").select("id, created_at").eq("status", "PENDING").order("created_at").limit(200),
    sb
      .from("workflow_approval_cases")
      .select("id, subject, due_at, created_at, escalation_level")
      .in("status", ["PENDING", "ESCALATED"])
      .order("due_at")
      .limit(200),
    sb.from("finance_expenses").select("id, created_at").in("status", ["SUBMITTED", "MANAGER_APPROVED"]).order("created_at").limit(200),
    sb
      .from("tasks")
      .select("id, title, deadline, priority, assignee:employees!tasks_assignee_id_fkey(full_name)")
      .lt("deadline", nowIso)
      .not("status", "in", "(COMPLETED,CANCELLED)")
      .order("deadline")
      .limit(8),
    sb.from("tasks").select("id", { count: "exact", head: true }).eq("status", "BLOCKED"),
    sb.from("tasks").select("id", { count: "exact", head: true }).eq("status", "REVIEW"),
    admin ? sb.from("workflow_runs").select("status").gte("created_at", since24).limit(5000) : none,
    admin
      ? sb
          .from("workflow_runs")
          .select("id, event_key, attempts, error_message, created_at")
          .eq("status", "FAILED")
          .order("created_at", { ascending: false })
          .limit(8)
      : none,
    admin ? sb.from("email_outbox").select("status").gte("created_at", since24).limit(5000) : none,
    admin ? sb.from("delivery_outbox").select("status").gte("created_at", since24).limit(5000) : none,
    admin ? sb.from("integration_status").select("key, last_success_at, last_failure_at, failure_count, last_error").order("key") : none,
    auditor
      ? sb
          .from("audit_events")
          .select("id, action, entity, created_at, actor:employees!audit_events_actor_employee_id_fkey(full_name)")
          .order("created_at", { ascending: false })
          .limit(12)
      : none,
  ]);

  // ---- teams, CRM, communication (all through RLS: you see what you're allowed to) ----
  const crm = canAny(ctx, ["crm.view_all", "crm.manage"]);
  const [{ data: teams }, { count: leadsToday }, { count: followUps }, { count: wonMonth }, { count: msgsToday }, { data: chanToday }] =
    await Promise.all([
      sb.from("org_teams").select("id, name, chat_channel_id, members:org_team_members(employee_id)").eq("is_active", true).order("name"),
      crm ? sb.from("leads").select("id", { count: "exact", head: true }).gte("created_at", dayStart) : none,
      crm
        ? sb.from("leads").select("id", { count: "exact", head: true }).lte("next_follow_up_at", nowIso).not("status", "in", "(WON,LOST)")
        : none,
      crm
        ? sb
            .from("leads")
            .select("id", { count: "exact", head: true })
            .eq("status", "WON")
            .gte("updated_at", `${today.slice(0, 7)}-01`)
        : none,
      sb.from("chat_messages").select("id", { count: "exact", head: true }).gte("created_at", dayStart).is("deleted_at", null),
      admin ? sb.from("delivery_outbox").select("channel, status").gte("created_at", dayStart).limit(5000) : none,
    ]);

  const canReview = canAny(ctx, ["attendance.manage", "attendance.approve"]);
  const [{ data: flagged }, { data: appErrors }] = await Promise.all([
    canReview
      ? sb
          .from("attendance_events")
          .select(
            "id, employee_id, event_type, occurred_at, flag, selfie_path, offline, distance_m, employee:employees!attendance_events_employee_id_fkey(full_name)",
          )
          .not("flag", "is", null)
          .is("reviewed_at", null)
          .neq("employee_id", ctx.employee_id)
          .gte("occurred_at", new Date(Date.now() - 7 * 86400_000).toISOString())
          .order("occurred_at", { ascending: false })
          .limit(10)
      : none,
    admin
      ? sb.from("app_errors").select("id, occurred_at, kind, path, message, digest").order("occurred_at", { ascending: false }).limit(8)
      : none,
  ]);

  // ---- live attendance ----
  const shiftOf = new Map((shifts ?? []).map((s) => [s.id, s]));
  const onLeave = new Map((leaves ?? []).map((l) => [l.employee_id, l.half_day]));
  const wd = weekday(today);
  const nowMin = localMinutes(now, tz);
  const board = (emps ?? []).map((e) => {
    const evs = (events ?? []).filter((x) => x.employee_id === e.id);
    const first = evs.find((x) => x.event_type === "CLOCK_IN");
    const last = evs.at(-1);
    const shift = e.shift_id ? shiftOf.get(e.shift_id) : undefined;
    const start = shift ? timeToMinutes(shift.start_time) + shift.grace_minutes : 9 * 60 + 10;
    const off = !!holiday || (shift?.weekly_offs ?? [0]).includes(wd);
    const live: Live =
      last?.event_type === "CLOCK_IN" || last?.event_type === "BREAK_END"
        ? "IN"
        : last?.event_type === "BREAK_START"
          ? "BREAK"
          : last?.event_type === "CLOCK_OUT"
            ? "OUT"
            : onLeave.has(e.id) && !onLeave.get(e.id)
              ? "LEAVE"
              : off
                ? "OFF"
                : "NOT_IN";
    const late = !!first && localMinutes(first.occurred_at, tz) > start;
    const overdueStart = live === "NOT_IN" && nowMin > start;
    return { ...e, live, first: first?.occurred_at ?? null, late, overdueStart, shiftName: shift?.name ?? "—" };
  });
  const tally = (l: Live) => board.filter((b) => b.live === l).length;
  const present = tally("IN") + tally("BREAK") + tally("OUT");
  const lateCount = board.filter((b) => b.late).length;
  const missing = board.filter((b) => b.overdueStart);
  const order: Live[] = ["NOT_IN", "BREAK", "IN", "OUT", "LEAVE", "OFF"];
  const sorted = [...board].sort((a, b) => order.indexOf(a.live) - order.indexOf(b.live) || a.full_name.localeCompare(b.full_name));

  // ---- approvals ----
  const queues = [
    { label: "Leave requests", href: "/approvals", rows: pendLeave ?? [] },
    { label: "Attendance corrections", href: "/approvals", rows: pendCorr ?? [] },
    { label: "Workflow approvals", href: "/approvals", rows: pendFlow ?? [] },
    { label: "Expense claims", href: "/finance/expenses", rows: pendExp ?? [] },
  ];
  const pendingTotal = queues.reduce((a, q) => a + q.rows.length, 0);
  const breachedFlow = (pendFlow ?? []).filter((f) => f.due_at < nowIso);

  // ---- executions ----
  const cnt = (rows: { status: string }[] | null, s: string) => (rows ?? []).filter((r) => r.status === s).length;
  const failedJobs = cnt(runs, "FAILED") + cnt(mail, "FAILED") + cnt(deliveries, "FAILED");
  const failing = (health ?? []).filter((h) => h.last_failure_at && (!h.last_success_at || h.last_failure_at > h.last_success_at));
  const cron = (health ?? []).find((h) => h.key === "cron");
  const cronStale = !cron?.last_success_at || Date.now() - Date.parse(cron.last_success_at) > 26 * 3600_000;

  const Kpi = ({
    label,
    value,
    sub,
    tone,
    href,
  }: {
    label: string;
    value: number | string;
    sub?: string;
    tone?: "danger" | "volt";
    href?: string;
  }) => {
    const body = (
      <div className={clsx("card h-full p-4 transition", href && "hover:border-volt/50")}>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</p>
        <p className={clsx("display mt-1 text-3xl tabular-nums", tone === "danger" && "text-danger", tone === "volt" && "text-volt")}>
          {value}
        </p>
        {sub && <p className="text-xs text-muted">{sub}</p>}
      </div>
    );
    return href ? <Link href={href}>{body}</Link> : body;
  };

  return (
    <>
      <PageHeader
        eyebrow={`Management · ${new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(now)}`}
        title="Operations Center"
      >
        <AutoRefresh renderedAt={nowIso} />
      </PageHeader>
      <LiveSync
        tables={[
          "attendance_events",
          "leave_requests",
          "attendance_corrections",
          "tasks",
          "workflow_approval_cases",
          "leads",
          "chat_messages",
        ]}
      />
      <Flash sp={sp} />
      {holiday && (
        <p className="mb-4 rounded-xl border border-line bg-panel px-4 py-2 text-sm">
          Today is a holiday: <b>{holiday.name}</b>
        </p>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Present" value={present} sub={`of ${board.length - tally("OFF") - tally("LEAVE")} expected`} tone="volt" />
        <Kpi label="Working now" value={tally("IN")} sub={`${tally("BREAK")} on break`} />
        <Kpi label="Late today" value={lateCount} tone={lateCount ? "danger" : undefined} />
        <Kpi label="Not clocked in" value={missing.length} sub="past shift start" tone={missing.length ? "danger" : undefined} />
        <Kpi label="On leave" value={tally("LEAVE")} />
        <Kpi
          label="Pending approvals"
          value={pendingTotal}
          sub={breachedFlow.length ? `${breachedFlow.length} past SLA` : "within SLA"}
          tone={breachedFlow.length ? "danger" : undefined}
          href="/approvals"
        />
        <Kpi
          label="Overdue tasks"
          value={overdue?.length === 8 ? "8+" : (overdue?.length ?? 0)}
          sub={`${blocked ?? 0} blocked · ${review ?? 0} in review`}
          tone={overdue?.length ? "danger" : undefined}
          href="/tasks?view=overdue"
        />
        {admin ? (
          <Kpi
            label="Failed jobs · 24h"
            value={failedJobs}
            sub={`${failing.length} integrations failing`}
            tone={failedJobs || failing.length ? "danger" : undefined}
          />
        ) : (
          <Kpi label="Blocked tasks" value={blocked ?? 0} />
        )}
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card
          title="Teams right now"
          action={
            <Link href="/teams" className="text-xs text-volt hover:underline">
              Teams →
            </Link>
          }
        >
          {!teams?.length ? (
            <p className="text-sm text-muted">No teams yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {teams.map((t: { id: string; name: string; chat_channel_id: string | null; members: { employee_id: string }[] }) => {
                const ids = new Set(t.members.map((m) => m.employee_id));
                const inTeam = board.filter((b) => ids.has(b.id));
                const working = inTeam.filter((b) => b.live === "IN" || b.live === "BREAK").length;
                return (
                  <li key={t.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {t.chat_channel_id ? (
                        <Link href={`/chat/${t.chat_channel_id}`} className="hover:text-volt">
                          {t.name}
                        </Link>
                      ) : (
                        t.name
                      )}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted">
                      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-line">
                        <span
                          className="block h-full bg-volt"
                          style={{ width: `${inTeam.length ? (working / inTeam.length) * 100 : 0}%` }}
                        />
                      </span>
                      {working}/{ids.size} in
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card
          title="Clients & leads today"
          action={
            crm ? (
              <Link href="/leads" className="text-xs text-volt hover:underline">
                CRM →
              </Link>
            ) : undefined
          }
        >
          {crm ? (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="display text-3xl tabular-nums">{leadsToday ?? 0}</p>
                <p className="text-[10px] uppercase text-muted">new today</p>
              </div>
              <div>
                <p className={clsx("display text-3xl tabular-nums", followUps && "text-ember")}>{followUps ?? 0}</p>
                <p className="text-[10px] uppercase text-muted">follow-ups due</p>
              </div>
              <div>
                <p className="display text-3xl tabular-nums text-volt">{wonMonth ?? 0}</p>
                <p className="text-[10px] uppercase text-muted">won this month</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">CRM isn&apos;t part of your access.</p>
          )}
        </Card>
        <Card
          title="Communication & channels"
          action={
            <Link href="/chat" className="text-xs text-volt hover:underline">
              Chat →
            </Link>
          }
        >
          <p className="text-sm">
            <span className="display text-3xl tabular-nums">{msgsToday ?? 0}</span>{" "}
            <span className="text-xs text-muted">messages today in your conversations</span>
          </p>
          {admin && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(["WHATSAPP", "PUSH", "SLACK", "TEAMS", "WEBHOOK"] as const).map((c) => {
                const rows = (chanToday ?? []).filter((r: { channel: string }) => r.channel === c);
                const bad = rows.filter((r: { status: string }) => r.status === "FAILED").length;
                return (
                  <span key={c} className={clsx("chip text-[10px]", bad ? "border-danger/50 text-danger" : "border-line text-muted")}>
                    {c.toLowerCase()} {rows.length}
                    {bad ? ` · ${bad} failed` : ""}
                  </span>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card title="Live attendance" hint="Everyone you're allowed to see. Late = first clock-in after shift start + grace.">
          <div className="-mx-5 max-h-[520px] overflow-auto px-5 sm:-mx-6 sm:px-6">
            <table className="table min-w-[560px]">
              <thead className="sticky top-0 bg-panel">
                <tr>
                  <th>Employee</th>
                  <th>Status</th>
                  <th>First in</th>
                  <th>Shift</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link href={`/people/${b.id}`} className="font-medium hover:text-volt">
                        {b.full_name}
                      </Link>
                      <span className="block text-xs text-muted">{b.designation ?? ""}</span>
                    </td>
                    <td>
                      <Badge tone={b.overdueStart ? "red" : LIVE_TONE[b.live] === "red" ? "amber" : LIVE_TONE[b.live]}>
                        {b.overdueStart ? "Missing" : LIVE_LABEL[b.live]}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap text-sm tabular-nums">
                      {b.first ? fmtTime(b.first, tz) : "—"}
                      {b.late && <span className="ml-2 text-xs text-ember">late</span>}
                    </td>
                    <td className="text-xs text-muted">{b.shiftName}</td>
                  </tr>
                ))}
                {!sorted.length && (
                  <tr>
                    <td colSpan={4} className="text-sm text-muted">
                      No employees in your scope.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-6">
          <Card
            title="Approval queues"
            action={
              <Link href="/approvals" className="text-xs text-volt hover:underline">
                Open approvals →
              </Link>
            }
          >
            <ul className="divide-y divide-line">
              {queues.map((q) => (
                <li key={q.label} className="flex items-center justify-between py-2.5 text-sm">
                  <Link href={q.href} className="hover:text-volt">
                    {q.label}
                  </Link>
                  <span className="flex items-center gap-3">
                    {q.rows[0] && <span className="text-xs text-muted">oldest {age(q.rows[0].created_at)}</span>}
                    <span className={clsx("display w-8 text-right text-xl tabular-nums", q.rows.length && "text-ink")}>
                      {q.rows.length}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {!!breachedFlow.length && (
              <div className="mt-3 rounded-xl border border-danger/40 p-3">
                <p className="text-xs font-semibold text-danger">Past SLA</p>
                <ul className="mt-1 space-y-1 text-xs">
                  {breachedFlow.slice(0, 5).map((f) => (
                    <li key={f.id}>
                      {f.subject} · due {fmtDateTime(f.due_at, tz)}
                      {f.escalation_level ? ` · escalated L${f.escalation_level}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card
            title="Overdue tasks"
            action={
              <Link href="/tasks?view=overdue" className="text-xs text-volt hover:underline">
                All →
              </Link>
            }
          >
            {!overdue?.length ? (
              <p className="text-sm text-muted">Nothing overdue. 🎯</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {overdue.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <Link href="/tasks?view=overdue" className="block truncate hover:text-volt">
                        {t.title}
                      </Link>
                      <span className="text-xs text-muted">
                        {(t.assignee as unknown as { full_name: string } | null)?.full_name ?? "Unassigned"} · {t.priority.toLowerCase()}
                      </span>
                    </span>
                    <span className="whitespace-nowrap text-xs text-danger">{age(t.deadline!)} late</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {canReview && !!flagged?.length && (
        <Card
          title={`Flagged punches · ${flagged.length}`}
          className="mt-6"
          hint="Offline punches and punches away from the office. Review them so payroll can trust attendance."
        >
          <ul className="divide-y divide-line text-sm">
            {flagged.map(
              (f: { id: string; event_type: string; occurred_at: string; flag: string; selfie_path: string | null; employee: unknown }) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <b>{(f.employee as { full_name: string } | null)?.full_name}</b> · {f.event_type.replace("_", " ").toLowerCase()} ·{" "}
                    {fmtDateTime(f.occurred_at, tz)}
                    <span className="block text-xs text-ember">{f.flag}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {f.selfie_path && (
                      <a
                        href={`/api/attendance/selfie/${f.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-volt hover:underline"
                      >
                        Selfie
                      </a>
                    )}
                    <form action={reviewFlaggedPunch} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={f.id} />
                      <input name="note" placeholder="Note (optional)" className="input w-36 py-1 text-xs" />
                      <button className="btn-ghost text-xs">Mark reviewed</button>
                    </form>
                  </span>
                </li>
              ),
            )}
          </ul>
        </Card>
      )}

      {admin && !!appErrors?.length && (
        <Card
          title="Recent app errors"
          className="mt-6"
          hint="Server errors are recorded automatically (30 days). The digest matches the code shown to the user."
        >
          <ul className="divide-y divide-line text-xs">
            {appErrors.map(
              (e: { id: number; occurred_at: string; kind: string; path: string | null; message: string; digest: string | null }) => (
                <li key={e.id} className="grid gap-1 py-2 sm:grid-cols-[140px_70px_1fr]">
                  <span className="text-muted">{fmtDateTime(e.occurred_at, tz)}</span>
                  <span className="font-mono">{e.kind.toLowerCase()}</span>
                  <span className="break-words">
                    <span className="font-mono text-muted">{e.path}</span> {e.message}
                    {e.digest ? <span className="text-muted"> · {e.digest}</span> : null}
                  </span>
                </li>
              ),
            )}
          </ul>
        </Card>
      )}

      {admin && (
        <>
          <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-3">
            <h2 className="eyebrow">Executions · last 24 hours</h2>
            <div className="flex flex-wrap gap-2">
              <form action={runWorkersNow}>
                <button className="btn-primary">Run all workers now</button>
              </form>
              {failedJobs > 0 && (
                <form action={retryAllDeliveries}>
                  <button className="btn-ghost">Retry failed messages</button>
                </form>
              )}
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {(
              [
                ["Workflow runs", runs, ["SUCCEEDED", "QUEUED", "RUNNING", "PARTIAL", "FAILED"], "/settings/workflows"],
                ["Email outbox", mail, ["SENT", "QUEUED", "SENDING", "FAILED", "SKIPPED"], "/settings/integrations"],
                ["Channel deliveries", deliveries, ["SENT", "QUEUED", "SENDING", "FAILED", "SKIPPED"], "/settings/integrations/channels"],
              ] as const
            ).map(([title, rows, statuses, href]) => (
              <Card
                key={title}
                title={title}
                action={
                  <Link href={href} className="text-xs text-volt hover:underline">
                    Details →
                  </Link>
                }
              >
                <div className="grid grid-cols-5 gap-1 text-center">
                  {statuses.map((s) => (
                    <div key={s}>
                      <p className={clsx("display text-2xl tabular-nums", s === "FAILED" && cnt(rows, s) > 0 && "text-danger")}>
                        {cnt(rows, s)}
                      </p>
                      <p className="text-[9px] uppercase text-muted">{s.toLowerCase()}</p>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card
              title="Failed workflow runs"
              action={
                failedRuns?.length ? (
                  <form action={retryWorkflowRuns}>
                    <button className="text-xs text-volt hover:underline">Retry all</button>
                  </form>
                ) : undefined
              }
            >
              {!failedRuns?.length ? (
                <p className="text-sm text-muted">No failed runs.</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {failedRuns.map((r) => (
                    <li key={r.id} className="flex items-start justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="font-mono text-xs">{r.event_key}</span>{" "}
                        <span className="text-xs text-muted">
                          · {fmtDateTime(r.created_at, tz)} · {r.attempts} attempts
                        </span>
                        <span className="block break-words text-xs text-danger">{r.error_message}</span>
                      </span>
                      <form action={retryWorkflowRuns}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="text-xs text-muted hover:text-ink">Retry</button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card
              title="System health"
              action={
                <Link href="/settings/integrations" className="text-xs text-volt hover:underline">
                  Integrations →
                </Link>
              }
            >
              <ul className="grid grid-cols-2 gap-2 text-sm">
                <li className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                  <span>Cron heartbeat</span>
                  <Badge tone={cronStale ? "red" : "green"}>{cronStale ? "STALE" : "OK"}</Badge>
                </li>
                {(health ?? [])
                  .filter((h) => h.key !== "cron")
                  .map((h) => {
                    const bad = h.last_failure_at && (!h.last_success_at || h.last_failure_at > h.last_success_at);
                    return (
                      <li
                        key={h.key}
                        title={h.last_error ?? undefined}
                        className="flex items-center justify-between rounded-lg border border-line px-3 py-2"
                      >
                        <span>{h.key.replace("_", " ")}</span>
                        <Badge tone={bad ? "red" : h.last_success_at ? "green" : "grey"}>
                          {bad ? `FAILING ×${h.failure_count}` : h.last_success_at ? "OK" : "UNTESTED"}
                        </Badge>
                      </li>
                    );
                  })}
              </ul>
              <p className="mt-3 text-xs text-muted">
                Last cron success: {cron?.last_success_at ? fmtDateTime(cron.last_success_at, tz) : "never recorded"}
              </p>
            </Card>
          </div>
        </>
      )}

      {auditor && (
        <Card
          title="Recent activity · audit log"
          className="mt-6"
          action={
            <Link href="/settings/audit-logs" className="text-xs text-volt hover:underline">
              Full log →
            </Link>
          }
        >
          <ul className="divide-y divide-line text-sm">
            {(audit ?? []).map((a) => (
              <li key={a.id} className="grid gap-1 py-2 sm:grid-cols-[150px_1fr_160px]">
                <span className="text-xs text-muted">{fmtDateTime(a.created_at, tz)}</span>
                <span>
                  <span className="font-mono text-xs">{a.action}</span> <span className="text-xs text-muted">on {a.entity}</span>
                </span>
                <span className="text-xs">{(a.actor as unknown as { full_name: string } | null)?.full_name ?? "System"}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
