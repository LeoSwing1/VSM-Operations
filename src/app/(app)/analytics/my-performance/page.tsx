import Link from "next/link";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { computeForEmployee } from "@/lib/data/performance";
import { minutesToHm } from "@/lib/data/attendance";
import { Badge, Bars, Card, Empty, Flash, Meter, PageHeader, Stat } from "@/components/ui";
import { fmtDate, localDate, monthBounds, shiftMonth } from "@/lib/engines/time";
import { requestReview } from "../../performance/actions";

export const metadata = { title: "My performance" };

const RANGES = [
  ["current", "This month"],
  ["previous", "Last month"],
  ["3m", "Last 3 months"],
  ["6m", "Last 6 months"],
  ["custom", "Custom"],
] as const;

export default async function MyPerformance({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const tz = ctx.timezone;
  const today = localDate(new Date(), tz);
  const cur = monthBounds(today);
  const range = RANGES.some(([k]) => k === sp.range) ? sp.range! : "current";
  let start = cur.start,
    end = cur.end;
  if (range === "previous") ({ start, end } = monthBounds(shiftMonth(today, -1)));
  if (range === "3m") start = shiftMonth(today, -2);
  if (range === "6m") start = shiftMonth(today, -5);
  if (range === "custom" && /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") && sp.from! <= sp.to!) {
    start = sp.from!;
    end = sp.to!;
  }
  if (end > today) end = today < start ? start : today;

  const trendMonths = Array.from({ length: 6 }, (_, i) => monthBounds(shiftMonth(today, i - 5)));
  const [main, trend, { data: snaps }, { data: reviews }, { data: requests }] = await Promise.all([
    computeForEmployee(sb, ctx.employee_id, start, end, tz),
    Promise.all(trendMonths.map((m) => computeForEmployee(sb, ctx.employee_id, m.start, m.end > today ? today : m.end, tz))),
    sb
      .from("performance_snapshots")
      .select("id, period_start, period_end, computed_score, adjustment, final_score, category, status")
      .eq("employee_id", ctx.employee_id)
      .neq("status", "SUPERSEDED")
      .order("period_start", { ascending: false })
      .limit(12),
    sb
      .from("manager_reviews")
      .select("id, period_start, rating, shared_comments")
      .eq("employee_id", ctx.employee_id)
      .order("period_start", { ascending: false })
      .limit(6),
    sb.from("performance_review_requests").select("snapshot_id, status").eq("employee_id", ctx.employee_id),
  ]);
  if (!main) return <Empty title="Profile not found" />;
  const r = main.result,
    a = main.attendance;
  const tasks = main.tasks as any[];
  const open = tasks.filter((t) => !["COMPLETED", "CANCELLED"].includes(t.status));
  const overdue = open.filter((t) => t.deadline && t.deadline < new Date().toISOString());

  return (
    <>
      <PageHeader eyebrow={`${fmtDate(start)} – ${fmtDate(end)}`} title="My performance">
        {RANGES.filter(([k]) => k !== "custom").map(([k, l]) => (
          <Link key={k} href={`?range=${k}`} className={range === k ? "btn-primary" : "btn-ghost"}>
            {l}
          </Link>
        ))}
      </PageHeader>
      <Flash sp={sp} />
      <form className="mb-6 flex flex-wrap items-end gap-2">
        <input type="hidden" name="range" value="custom" />
        <label>
          <span className="label">From</span>
          <input type="date" name="from" defaultValue={range === "custom" ? start : ""} className="input" />
        </label>
        <label>
          <span className="label">To</span>
          <input type="date" name="to" defaultValue={range === "custom" ? end : ""} max={today} className="input" />
        </label>
        <button className="btn-ghost">Apply</button>
        <a href={`/api/reports/attendance?month=${cur.start}`} className="btn-ghost ml-auto">
          Attendance CSV (this month)
        </a>
      </form>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Performance score" className="lg:row-span-2">
          <p className="display text-8xl tabular-nums">{r.score ?? "—"}</p>
          <p className="mt-2 text-sm">{r.score === null ? "Not enough data yet to publish a fair score." : <Badge>{r.category!}</Badge>}</p>
          <p className="mt-1 text-xs text-muted">
            Built from {r.coverage}% of the weighted dimensions{main.policy ? ` · policy “${main.policy.name}”` : ""}.
          </p>
          <div className="mt-6 space-y-4">
            {r.components.map((c) => (
              <div key={c.key}>
                <Meter label={`${c.label} · weight ${c.weight}%`} value={c.score} />
                <p className="mt-1 text-[11px] text-muted">
                  {c.detail}
                  {c.formula !== "—" ? ` · ${c.formula}` : ""}
                  {c.contribution !== null ? ` · +${c.contribution} pts` : ""}
                </p>
              </div>
            ))}
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-4 lg:col-span-2 md:grid-cols-4">
          <Stat
            label="Attendance"
            value={a?.attendancePct === null || !a ? "—" : `${a.attendancePct}%`}
            hint={a ? `${a.presentDays} present · ${a.absentDays} absent` : undefined}
            tone="volt"
          />
          <Stat label="Late arrivals" value={a?.lateArrivals ?? 0} />
          <Stat label="Hours worked" value={a ? minutesToHm(a.totalWorkedMinutes) : "—"} />
          <Stat label="Daily updates" value={main.updates} />
          <Stat label="Completed tasks" value={tasks.filter((t) => t.status === "COMPLETED").length} />
          <Stat label="Pending tasks" value={open.length} />
          <Stat label="Overdue" value={overdue.length} tone={overdue.length ? "danger" : undefined} />
          <Stat label="Reworked" value={tasks.filter((t) => t.reopen_count > 0).length} />
        </div>
        <Card title="Monthly trend" className="lg:col-span-2">
          <Bars
            label="Performance score by month"
            max={100}
            data={trendMonths.map((m, i) => ({
              label: new Date(`${m.start}T12:00:00Z`).toLocaleString("en-IN", { month: "short" }),
              value: trend[i]?.result.score ?? null,
            }))}
          />
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="How to improve">
          {!r.improvements.length ? (
            <p className="text-sm text-muted">Every scored dimension is at 80 or above. Keep it up.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {r.improvements.map((t, i) => (
                <li key={i} className="border-l-2 border-volt pl-3">
                  {t}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Manager feedback">
          {!reviews?.length ? (
            <Empty title="No reviews yet" />
          ) : (
            <ul className="space-y-3">
              {reviews.map((v) => (
                <li key={v.id} className="text-sm">
                  <p className="text-xs text-muted">
                    {fmtDate(v.period_start)} · rating {v.rating}
                  </p>
                  <p>{v.shared_comments ?? "No comments shared."}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Official snapshots" className="mt-6">
        {!snaps?.length ? (
          <Empty title="No snapshots yet" hint="Your manager publishes a snapshot at the end of each review period." />
        ) : (
          <ul className="divide-y divide-line">
            {snaps.map((s) => {
              const asked = requests?.some((q) => q.snapshot_id === s.id);
              return (
                <li key={s.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>
                      {fmtDate(s.period_start)} – {fmtDate(s.period_end)}
                    </span>
                    <span className="flex items-center gap-2 tabular-nums">
                      <b>{s.final_score ?? "—"}</b>
                      {Number(s.adjustment) !== 0 && (
                        <span className="text-xs text-muted">
                          ({s.computed_score} {Number(s.adjustment) > 0 ? "+" : ""}
                          {s.adjustment} adjusted)
                        </span>
                      )}
                      <Badge>{s.status}</Badge>
                    </span>
                  </div>
                  {asked ? (
                    <p className="mt-1 text-xs text-muted">Review requested.</p>
                  ) : (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-muted">Request a review of this score</summary>
                      <form action={requestReview} className="mt-2 flex flex-wrap gap-2">
                        <input type="hidden" name="snapshot_id" value={s.id} />
                        <input
                          name="message"
                          minLength={10}
                          required
                          className="input flex-1"
                          placeholder="What do you think was missed?"
                        />
                        <button className="btn-ghost">Send</button>
                      </form>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
