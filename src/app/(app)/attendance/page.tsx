import { myToday } from "@/lib/data/today";
import { LiveSync } from "@/components/live-sync";
import Link from "next/link";
import { requireContext, canAny } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { loadAttendance, minutesToHm } from "@/lib/data/attendance";
import { Badge, Card, Empty, Field, Flash, PageHeader, Stat, TableWrap } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtTime, localDate, monthBounds, shiftMonth, zonedInstant } from "@/lib/engines/time";
import { PunchCard } from "./punch-card";
import { requestCorrection } from "./actions";

export const metadata = { title: "Attendance" };

export default async function AttendancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const tz = ctx.timezone;
  const today = localDate(new Date(), tz);
  const month = /^\d{4}-\d{2}-01$/.test(sp.month ?? "") ? sp.month! : monthBounds(today).start;
  const { start, end } = monthBounds(month);
  const canTeam = canAny(ctx, ["attendance.view_all", "attendance.view_team"]);
  const employeeId = canTeam && sp.employee ? sp.employee : ctx.employee_id;
  const self = employeeId === ctx.employee_id;

  const [summary, people, todayEvents, corrections] = await Promise.all([
    loadAttendance(sb, employeeId, start, end, tz),
    canTeam ? sb.from("employees").select("id, full_name").neq("status", "EXITED").order("full_name") : Promise.resolve({ data: null }),
    myToday(sb).then((data) => ({ data })),
    sb
      .from("attendance_corrections")
      .select("id, event_type, requested_time, reason, status, decision_note, created_at")
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  const name = (people.data ?? []).find((p) => p.id === employeeId)?.full_name ?? ctx.full_name;
  const q = (m: string) => `/attendance?month=${m}${self ? "" : `&employee=${employeeId}`}`;

  return (
    <>
      <PageHeader eyebrow="Attendance & workforce" title={self ? "My attendance" : name}>
        <Link className="btn-ghost" href={q(shiftMonth(month, -1))}>
          ← Prev
        </Link>
        <span className="btn pointer-events-none border border-line">
          {new Date(`${month}T12:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric" })}
        </span>
        <Link className="btn-ghost" href={q(shiftMonth(month, 1))}>
          Next →
        </Link>
        <a className="btn-ghost" href={`/api/reports/attendance?month=${month}&employee=${employeeId}&format=csv`}>
          CSV
        </a>
        <a className="btn-ghost" href={`/api/reports/attendance?month=${month}&employee=${employeeId}&format=xlsx`}>
          Excel
        </a>
        <a className="btn-ghost" href={`/api/reports/attendance?month=${month}&employee=${employeeId}&format=pdf`}>
          PDF
        </a>
        <Link className="btn-ghost" href="/time">
          Log work time →
        </Link>
        <Link className="btn-ghost" href="/calendar">
          Calendar
        </Link>
      </PageHeader>
      <LiveSync tables={["attendance_events", "attendance_corrections"]} />
      <Flash sp={sp} />

      {people.data && people.data.length > 1 && (
        <form className="mb-6 flex flex-wrap items-end gap-2">
          <input type="hidden" name="month" value={month} />
          <Field label="View employee" className="min-w-[220px]">
            <select name="employee" defaultValue={employeeId} className="input">
              {people.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                  {p.id === ctx.employee_id ? " (me)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <button className="btn-ghost">Show</button>
        </form>
      )}

      {!summary ? (
        <Empty title="Not available" hint="This employee isn't in your scope." />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-4">
            {self && <PunchCard events={todayEvents.data ?? []} tz={tz} />}
            <div className={`grid grid-cols-2 gap-4 ${self ? "lg:col-span-3" : "lg:col-span-4"} md:grid-cols-3`}>
              <Stat
                label="Attendance"
                value={summary.attendancePct === null ? "—" : `${summary.attendancePct}%`}
                tone="volt"
                hint={`${summary.presentDays} of ${summary.workingDays - summary.leaveDays} expected days`}
              />
              <Stat
                label="Worked"
                value={minutesToHm(summary.totalWorkedMinutes)}
                hint={`Breaks ${minutesToHm(summary.totalBreakMinutes)}`}
              />
              <Stat
                label="Late arrivals"
                value={summary.lateArrivals}
                tone={summary.lateArrivals ? "ember" : undefined}
                hint={summary.punctualityPct === null ? undefined : `${summary.punctualityPct}% on time`}
              />
              <Stat label="Absent" value={summary.absentDays} tone={summary.absentDays ? "danger" : undefined} />
              <Stat label="Missing clock-outs" value={summary.missingClockOuts} tone={summary.missingClockOuts ? "ember" : undefined} />
              <Stat
                label="Loss of pay"
                value={`${summary.lopDays}d`}
                hint={`Leave ${summary.leaveDays}d · Half days ${summary.halfDays}`}
              />
            </div>
          </div>

          <Card title="Day by day" className="mt-6">
            <TableWrap>
              <table className="table min-w-[760px]">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Status</th>
                    <th>In</th>
                    <th>Out</th>
                    <th>Worked</th>
                    <th>Break</th>
                    <th>Late</th>
                    <th>Early leave</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.days
                    .filter((d) => d.status !== "NOT_EMPLOYED")
                    .map((d) => (
                      <tr
                        key={d.date}
                        className={d.status === "WEEKLY_OFF" || d.status === "HOLIDAY" || d.status === "UPCOMING" ? "text-muted" : ""}
                      >
                        <td className="whitespace-nowrap">{fmtDate(d.date)}</td>
                        <td>
                          <Badge>{d.status}</Badge>
                          {d.missingClockOut && <span className="ml-2 text-xs text-ember">no clock-out</span>}
                        </td>
                        <td className="tabular-nums">{d.firstIn ? fmtTime(d.firstIn, tz) : "—"}</td>
                        <td className="tabular-nums">{d.lastOut ? fmtTime(d.lastOut, tz) : "—"}</td>
                        <td className="tabular-nums">{d.workedMinutes ? minutesToHm(d.workedMinutes) : "—"}</td>
                        <td className="tabular-nums">{d.breakMinutes ? `${d.breakMinutes}m` : "—"}</td>
                        <td className={d.lateMinutes ? "tabular-nums text-ember" : "tabular-nums"}>
                          {d.lateMinutes ? `${d.lateMinutes}m` : "—"}
                        </td>
                        <td className="tabular-nums">{d.earlyDepartureMinutes ? `${d.earlyDepartureMinutes}m` : "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        </>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {self && (
          <Card title="Request a correction">
            <form action={requestCorrection} className="grid gap-3 sm:grid-cols-2">
              <Field label="Punch">
                <select name="event_type" className="input" required>
                  <option value="CLOCK_IN">Clock in</option>
                  <option value="CLOCK_OUT">Clock out</option>
                  <option value="BREAK_START">Break start</option>
                  <option value="BREAK_END">Break end</option>
                </select>
              </Field>
              <Field label="Date">
                <input type="date" name="date" max={today} className="input" required />
              </Field>
              <Field label="Time (IST)">
                <input type="time" name="time" className="input" required />
              </Field>
              <Field label="Reason" className="sm:col-span-2">
                <textarea
                  name="reason"
                  rows={2}
                  minLength={5}
                  maxLength={1000}
                  className="input"
                  required
                  placeholder="e.g. Was at client site in Noida, phone battery died"
                />
              </Field>
              <div className="sm:col-span-2">
                <button className="btn-primary">Submit for approval</button>
              </div>
            </form>
          </Card>
        )}
        <Card title="Correction history">
          {(corrections.data ?? []).length === 0 ? (
            <Empty title="No corrections" />
          ) : (
            <ul className="divide-y divide-line">
              {corrections.data!.map((c) => (
                <li key={c.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {c.event_type.replace("_", " ").toLowerCase()} · {fmtDateTime(c.requested_time, tz)}
                    </span>
                    <Badge>{c.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {c.reason}
                    {c.decision_note ? ` — ${c.decision_note}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
