import { can, canAny, requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Field, Flash, PageHeader, TableWrap, Tabs } from "@/components/ui";
import { fmtDate, fmtDateTime, localDate, monthBounds, shiftMonth } from "@/lib/engines/time";
import { REPORT_TYPES } from "@/lib/reports/build";
import { deleteSchedule, runReport, saveSchedule, toggleSchedule } from "./actions";

export const metadata = { title: "Reports & BI" };
const DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default async function Reports({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const mine = Object.entries(REPORT_TYPES).filter(([, r]) => can(ctx, r.perm));
  const scheduler = can(ctx, "reports.schedule");
  const accountant = can(ctx, "finance.export");
  if (!mine.length && !accountant && !scheduler) {
    return (
      <>
        <PageHeader eyebrow="Organisation" title="Reports & BI" />
        <Empty title="No reports for your role" hint="Ask an admin if you need attendance, CRM, finance or KPI reports." />
      </>
    );
  }
  const tabs = [
    { key: "run", label: "Run a report" },
    ...(scheduler ? [{ key: "schedules", label: "Scheduled" }] : []),
    ...(accountant ? [{ key: "accountant", label: "Accountant pack" }] : []),
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : "run";
  const today = localDate(new Date(), ctx.timezone);
  const lastMonth = monthBounds(shiftMonth(monthBounds(today).start, -1));

  const [{ data: runs }, { data: schedules }, { data: people }] = await Promise.all([
    sb
      .from("report_runs")
      .select("id,report_type,format,period_start,period_end,status,row_count,error,created_at,schedule_id")
      .order("created_at", { ascending: false })
      .limit(40),
    scheduler ? sb.from("report_schedules").select("*").order("created_at") : Promise.resolve({ data: [] as Record<string, never>[] }),
    sb.from("employees").select("id,full_name,designation").neq("status", "EXITED").order("full_name"),
  ]);
  const name = new Map((people ?? []).map((p) => [p.id, p.full_name as string]));

  return (
    <>
      <PageHeader eyebrow="Organisation" title="Reports & BI" />
      <Flash sp={sp} />
      <Tabs tabs={tabs} active={tab} base="/reports" />

      {tab === "run" && (
        <div className="grid gap-6">
          <Card title="Run a report" hint="Files are kept privately. Only people who hold that report's permission can download them.">
            <form action={runReport} className="grid gap-3 sm:grid-cols-6">
              <Field label="Report" className="sm:col-span-2">
                <select name="report_type" className="input" required>
                  {mine.map(([k, r]) => (
                    <option key={k} value={k}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="From">
                <input type="date" name="from" required defaultValue={lastMonth.start} className="input" />
              </Field>
              <Field label="To">
                <input type="date" name="to" required defaultValue={lastMonth.end} className="input" />
              </Field>
              <Field label="Format">
                <select name="format" className="input">
                  <option value="XLSX">Excel</option>
                  <option value="PDF">PDF</option>
                  <option value="CSV">CSV</option>
                </select>
              </Field>
              <div className="flex items-end">
                <button className="btn">Generate</button>
              </div>
            </form>
            <ul className="mt-5 grid gap-2 text-xs text-muted sm:grid-cols-2">
              {mine.map(([k, r]) => (
                <li key={k}>
                  <strong className="text-ink">{r.label}:</strong> {r.hint}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Recent files">
            {!(runs ?? []).length ? (
              <Empty title="No reports yet" />
            ) : (
              <TableWrap>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr>
                      <th className="py-2">Report</th>
                      <th>Period</th>
                      <th>Made</th>
                      <th>Rows</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {(runs ?? []).map((r) => (
                      <tr key={r.id} className={sp.run === r.id ? "bg-volt/10" : undefined}>
                        <td className="py-2">
                          {REPORT_TYPES[r.report_type]?.label ?? r.report_type}
                          <span className="block text-xs text-muted">
                            {r.schedule_id ? "Scheduled" : "On demand"} · {r.format}
                          </span>
                        </td>
                        <td className="text-xs">
                          {fmtDate(r.period_start)} – {fmtDate(r.period_end)}
                        </td>
                        <td className="text-xs text-muted">{fmtDateTime(r.created_at, ctx.timezone)}</td>
                        <td className="tabular-nums">{r.row_count ?? "–"}</td>
                        <td>
                          <Badge tone={r.status === "READY" ? "green" : r.status === "FAILED" ? "red" : "amber"}>{r.status}</Badge>
                        </td>
                        <td>
                          {r.status === "READY" && (
                            <a className="btn-ghost" href={`/api/reports/runs/${r.id}`}>
                              Download
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </div>
      )}

      {tab === "schedules" && scheduler && (
        <div className="grid gap-6">
          <Card
            title="New schedule"
            hint="Times are India time. Weekly runs cover last Monday–Sunday; monthly runs cover the previous month; daily runs cover yesterday."
          >
            <form action={saveSchedule} className="grid gap-3 sm:grid-cols-6">
              <Field label="Name" className="sm:col-span-2">
                <input name="name" required className="input" placeholder="e.g. Monday attendance for HR" />
              </Field>
              <Field label="Report" className="sm:col-span-2">
                <select name="report_type" className="input">
                  {mine.map(([k, r]) => (
                    <option key={k} value={k}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Format">
                <select name="format" className="input">
                  <option value="XLSX">Excel</option>
                  <option value="PDF">PDF</option>
                  <option value="CSV">CSV</option>
                </select>
              </Field>
              <Field label="How often">
                <select name="frequency" className="input" defaultValue="WEEKLY">
                  <option value="DAILY">Daily</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="MONTHLY">Monthly</option>
                </select>
              </Field>
              <Field label="Weekday (weekly)">
                <select name="weekday" className="input" defaultValue="1">
                  {DAYS.slice(1).map((d, i) => (
                    <option key={d} value={i + 1}>
                      {d}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Day of month (monthly)">
                <input name="month_day" type="number" min={1} max={28} defaultValue={1} className="input" />
              </Field>
              <Field label="Hour (IST)">
                <input name="hour_local" type="number" min={0} max={23} defaultValue={9} className="input" />
              </Field>
              <Field label="Recipients" className="sm:col-span-3">
                <select name="recipients" multiple size={5} className="input" required>
                  {(people ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                      {p.designation ? ` · ${p.designation}` : ""}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-muted">
                  Ctrl/Cmd-click for several. People without access to the report are skipped automatically.
                </span>
              </Field>
              <div className="flex items-end">
                <button className="btn">Save schedule</button>
              </div>
            </form>
          </Card>
          <Card title="Schedules">
            {!(schedules ?? []).length ? (
              <Empty
                title="Nothing scheduled"
                hint="Typical setup: weekly attendance to HR on Monday 9 am, monthly P&L to the founders on the 2nd."
              />
            ) : (
              <ul className="divide-y divide-line">
                {(schedules ?? []).map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                    <span className="min-w-0">
                      {s.name}{" "}
                      <span className="text-muted">
                        · {REPORT_TYPES[s.report_type]?.label} · {s.format} ·{" "}
                        {s.frequency === "DAILY"
                          ? "daily"
                          : s.frequency === "WEEKLY"
                            ? `every ${DAYS[s.weekday]}`
                            : `monthly on day ${s.month_day}`}{" "}
                        at {String(s.hour_local).padStart(2, "0")}:00
                      </span>
                      <span className="block text-xs text-muted">
                        To: {(s.recipients as string[]).map((r) => name.get(r) ?? "—").join(", ")} · next{" "}
                        {s.active && s.next_run_at ? fmtDateTime(s.next_run_at, ctx.timezone) : "paused"}
                      </span>
                    </span>
                    <span className="flex gap-2">
                      {!s.active && <Badge tone="grey">PAUSED</Badge>}
                      <form action={toggleSchedule}>
                        <input type="hidden" name="id" value={s.id} />
                        <button className="btn-ghost">{s.active ? "Pause" : "Resume"}</button>
                      </form>
                      <form action={deleteSchedule}>
                        <input type="hidden" name="id" value={s.id} />
                        <button className="btn-ghost text-danger">Delete</button>
                      </form>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === "accountant" && accountant && (
        <Card
          title="Accountant pack"
          hint="One Excel file per month: sales register with client GSTIN, receipts, expenses, vendor payments, Scholars fees and payroll totals (company totals only — no individual salaries; shown only if you also have payroll export rights)."
        >
          <form action="/api/reports/accountant" method="get" className="flex flex-wrap items-end gap-3">
            <Field label="Month">
              <input type="month" name="month" required defaultValue={lastMonth.start.slice(0, 7)} className="input" />
            </Field>
            <button className="btn">Download</button>
          </form>
          {!canAny(ctx, ["payroll.export"]) && (
            <p className="mt-3 text-xs text-muted">Payroll totals sheet needs the payroll export permission.</p>
          )}
        </Card>
      )}
    </>
  );
}
