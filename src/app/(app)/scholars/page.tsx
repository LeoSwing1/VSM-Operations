import Link from "next/link";
import { redirect } from "next/navigation";
import { canAny, requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, PageHeader, Stat, Flash } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/engines/time";
import { LiveSync } from "@/components/live-sync";
import { ScholarsNav, STAGES, STAGE_TONE, rupees } from "./nav";

export const metadata = { title: "VSM Scholars" };

export default async function Scholars({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!canAny(ctx, ["scholars.view", "scholars.teach"]))
    redirect("/dashboard?e=" + encodeURIComponent("VSM Scholars isn't part of your access."));
  const sb = await supabaseServer();
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: students }, { data: batches }, { data: fees }, { count: certs }, { data: due }] = await Promise.all([
    sb.from("scholar_students").select("stage").limit(10000),
    sb
      .from("scholar_batches")
      .select(
        "id, name, status, capacity, starts_on, schedule, course:scholar_courses(name), trainer:employees(full_name), seats:scholar_enrollments(count)",
      )
      .in("status", ["PLANNED", "RUNNING"])
      .order("starts_on"),
    sb.from("scholar_fee_payments").select("amount, status, due_on").limit(10000),
    sb.from("scholar_certificates").select("id", { count: "exact", head: true }).is("revoked_at", null),
    sb
      .from("scholar_students")
      .select("id, full_name, phone, stage, next_follow_up_at")
      .lte("next_follow_up_at", new Date(Date.now() + 86400_000).toISOString())
      .in("stage", ["ENQUIRY", "COUNSELLED", "DEMO"])
      .order("next_follow_up_at")
      .limit(12),
  ]);
  const by = (s: string) => (students ?? []).filter((x) => x.stage === s).length;
  const sum = (f: (r: { amount: number; status: string; due_on: string }) => boolean) =>
    (fees ?? []).filter(f).reduce((a, r) => a + Number(r.amount), 0);
  const overdue = sum((r) => r.status === "DUE" && r.due_on < today),
    dueSoon = sum((r) => r.status === "DUE" && r.due_on >= today);
  const collected = sum((r) => r.status === "PAID");
  const leads = by("ENQUIRY") + by("COUNSELLED") + by("DEMO");
  const conv =
    leads + by("ENROLLED") + by("ALUMNI") + by("LOST")
      ? Math.round(((by("ENROLLED") + by("ALUMNI")) / (leads + by("ENROLLED") + by("ALUMNI") + by("LOST"))) * 100)
      : 0;
  return (
    <>
      <PageHeader eyebrow="Digital Marketing · Graphic Design · Video Editing" title="VSM Scholars">
        {canAny(ctx, ["scholars.manage"]) && (
          <Link href="/scholars/students?new=1" className="btn-primary">
            New enquiry
          </Link>
        )}
      </PageHeader>
      <ScholarsNav active="/scholars" />
      <LiveSync tables={["scholar_students", "scholar_enrollments", "scholar_fee_payments"]} />
      <Flash sp={sp} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Open enquiries" value={leads} />
        <Stat label="Enrolled now" value={by("ENROLLED")} tone="volt" />
        <Stat label="Alumni" value={by("ALUMNI")} />
        <Stat label="Conversion" value={`${conv}%`} />
        <Stat label="Fees collected" value={rupees(collected)} />
        <Stat label="Overdue fees" value={rupees(overdue)} tone={overdue ? "danger" : undefined} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <Card title="Counselling pipeline">
          <div className="grid grid-cols-7 gap-2 text-center">
            {STAGES.map((s) => (
              <Link key={s} href={`/scholars/students?stage=${s}`} className="rounded-xl border border-line p-2 hover:border-volt/50">
                <p className="display text-2xl tabular-nums">{by(s)}</p>
                <p className="text-[9px] uppercase text-muted">{s.toLowerCase()}</p>
              </Link>
            ))}
          </div>
          <h3 className="eyebrow mb-2 mt-6">Follow up today</h3>
          {!due?.length ? (
            <p className="text-sm text-muted">No follow-ups due. 🎯</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {due.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                  <Link href={`/scholars/students/${s.id}`} className="hover:text-volt">
                    {s.full_name} <span className="text-xs text-muted">· {s.phone}</span>
                  </Link>
                  <span className="flex items-center gap-2">
                    <Badge tone={STAGE_TONE[s.stage]}>{s.stage}</Badge>
                    <span className={`text-xs ${s.next_follow_up_at! < new Date().toISOString() ? "text-ember" : "text-muted"}`}>
                      {fmtDateTime(s.next_follow_up_at!, ctx.timezone)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card
          title="Open batches"
          action={
            <Link href="/scholars/batches" className="text-xs text-volt hover:underline">
              All →
            </Link>
          }
        >
          {!batches?.length ? (
            <p className="text-sm text-muted">No planned or running batches.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {batches.map(
                (b: {
                  id: string;
                  name: string;
                  status: string;
                  capacity: number;
                  starts_on: string;
                  schedule: string | null;
                  course: unknown;
                  trainer: unknown;
                  seats: { count: number }[];
                }) => {
                  const seats = b.seats?.[0]?.count ?? 0;
                  return (
                    <li key={b.id}>
                      <Link href={`/scholars/batches/${b.id}`} className="flex items-center justify-between gap-2 hover:text-volt">
                        <span>
                          <b>{b.name}</b>{" "}
                          <span className="text-xs text-muted">
                            · {(b.course as { name: string } | null)?.name} ·{" "}
                            {(b.trainer as { full_name: string } | null)?.full_name ?? "no trainer"} · from {fmtDate(b.starts_on)}
                          </span>
                        </span>
                        <Badge tone={b.status === "RUNNING" ? "green" : "amber"}>{b.status}</Badge>
                      </Link>
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-line">
                        <span className="block h-full bg-volt" style={{ width: `${Math.min(100, (seats / b.capacity) * 100)}%` }} />
                      </span>
                      <span className="text-[11px] text-muted">
                        {seats}/{b.capacity} seats{b.schedule ? ` · ${b.schedule}` : ""}
                      </span>
                    </li>
                  );
                },
              )}
            </ul>
          )}
          <p className="mt-4 text-xs text-muted">
            {certs ?? 0} valid certificates issued · {rupees(dueSoon)} due in coming instalments
          </p>
        </Card>
      </div>
    </>
  );
}
