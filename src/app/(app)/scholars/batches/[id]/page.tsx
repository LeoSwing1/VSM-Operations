import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Field, Flash, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/engines/time";
import { issueCertificate, markClass, setBatchStatus } from "../../actions";
import { ScholarsNav } from "../../nav";

export const metadata = { title: "Batch · VSM Scholars" };

export default async function Batch({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const { data: b } = await sb
    .from("scholar_batches")
    .select("*, course:scholar_courses(name), trainer:employees(id, full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!b) notFound();
  const [{ data: ens }, { data: sessions }] = await Promise.all([
    sb
      .from("scholar_enrollments")
      .select(
        "id, status, student:scholar_students(id, full_name, phone), fees:scholar_fee_payments(status), cert:scholar_certificates(certificate_no, revoked_at)",
      )
      .eq("batch_id", id)
      .neq("status", "DROPPED"),
    sb
      .from("scholar_sessions")
      .select("id, session_date, topic, att:scholar_session_attendance(student_id, present)")
      .eq("batch_id", id)
      .order("session_date", { ascending: false }),
  ]);
  const isTrainer = (b.trainer as { id: string } | null)?.id === ctx.employee_id;
  const canMark = isTrainer || can(ctx, "scholars.admin");
  const total = sessions?.length ?? 0;
  const pct = (sid: string) => {
    if (!total) return null;
    const p = (sessions ?? []).filter((s) =>
      (s.att as { student_id: string; present: boolean }[]).some((a) => a.student_id === sid && a.present),
    ).length;
    return Math.round((p / total) * 100);
  };
  const today = new Date().toISOString().slice(0, 10);
  const back = `/scholars/batches/${id}`;
  return (
    <>
      <PageHeader eyebrow={`VSM Scholars · ${(b.course as { name: string }).name}`} title={b.name}>
        <Badge tone={b.status === "RUNNING" ? "green" : "amber"}>{b.status}</Badge>
        {can(ctx, "scholars.admin") &&
          (["PLANNED", "RUNNING", "COMPLETED", "CANCELLED"] as const)
            .filter((s) => s !== b.status)
            .map((s) => (
              <form key={s} action={setBatchStatus}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="status" value={s} />
                <button className="btn-ghost text-xs">{s.toLowerCase()}</button>
              </form>
            ))}
      </PageHeader>
      <ScholarsNav active="/scholars/batches" />
      <Flash sp={sp} />
      <p className="mb-6 text-sm text-muted">
        {fmtDate(b.starts_on)}
        {b.ends_on ? ` → ${fmtDate(b.ends_on)}` : ""} · {b.schedule ?? ""} · {b.mode.toLowerCase()} · {b.location ?? ""} · Trainer{" "}
        {(b.trainer as { full_name: string } | null)?.full_name ?? "—"} · {ens?.length ?? 0}/{b.capacity} seats · {total} classes held
      </p>
      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Card
          title="Mark today's class"
          hint={
            canMark
              ? "Tick who is present. Saving the same date again updates it."
              : "Only the batch trainer or an admin can mark attendance."
          }
        >
          {canMark && ens?.length ? (
            <form action={markClass} className="space-y-3">
              <input type="hidden" name="batch_id" value={id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Date">
                  <input name="session_date" type="date" defaultValue={today} max={today} className="input" />
                </Field>
                <Field label="Topic">
                  <input name="topic" placeholder="Meta Ads: campaign structure" className="input" />
                </Field>
              </div>
              <ul className="grid gap-1 sm:grid-cols-2">
                {ens.map((en: { id: string; student: unknown }) => {
                  const st = en.student as { id: string; full_name: string };
                  return (
                    <li key={en.id}>
                      <label className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                        <input type="hidden" name="student" value={st.id} />
                        <input type="checkbox" name="present" value={st.id} defaultChecked className="h-4 w-4 accent-[#D7FF3A]" />
                        {st.full_name}
                      </label>
                    </li>
                  );
                })}
              </ul>
              <button className="btn-primary">Save attendance</button>
            </form>
          ) : (
            <p className="text-sm text-muted">{ens?.length ? "" : "No students enrolled yet."}</p>
          )}
        </Card>
        <Card title="Roster">
          <ul className="divide-y divide-line text-sm">
            {(ens ?? []).map(
              (en: {
                id: string;
                status: string;
                student: unknown;
                fees: { status: string }[];
                cert: { certificate_no: string; revoked_at: string | null }[] | null;
              }) => {
                const st = en.student as { id: string; full_name: string; phone: string };
                const due = en.fees.filter((f) => f.status === "DUE").length;
                const p = pct(st.id);
                const cert = en.cert?.[0];
                return (
                  <li key={en.id} className="py-2">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/scholars/students/${st.id}`} className="hover:text-volt">
                        {st.full_name}
                      </Link>
                      <span className="flex items-center gap-2 text-xs">
                        {p !== null && <span className={p < 75 ? "text-ember" : "text-muted"}>{p}% attendance</span>}
                        {due > 0 && can(ctx, "scholars.view") && <Badge tone="amber">{due} FEE DUE</Badge>}
                        {cert && <Badge tone={cert.revoked_at ? "red" : "green"}>{cert.certificate_no}</Badge>}
                      </span>
                    </div>
                    {!cert && can(ctx, "scholars.certify") && b.status !== "PLANNED" && (
                      <form action={issueCertificate} className="mt-1 flex gap-2">
                        <input type="hidden" name="enrollment_id" value={en.id} />
                        <input type="hidden" name="back" value={back} />
                        <select name="grade" className="input w-20 py-1 text-xs">
                          <option>A+</option>
                          <option>A</option>
                          <option>B</option>
                          <option>C</option>
                          <option>PASS</option>
                        </select>
                        <button className="btn-ghost py-1 text-xs">Issue certificate</button>
                      </form>
                    )}
                  </li>
                );
              },
            )}
          </ul>
        </Card>
      </div>
      <Card title="Class history" className="mt-6">
        {!sessions?.length ? (
          <p className="text-sm text-muted">No classes marked yet.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {sessions.map((s: { id: string; session_date: string; topic: string | null; att: { present: boolean }[] }) => (
              <li key={s.id} className="flex justify-between gap-2 py-2">
                <span>
                  {fmtDate(s.session_date)} <span className="text-xs text-muted">· {s.topic ?? ""}</span>
                </span>
                <span className="text-xs">
                  {s.att.filter((a) => a.present).length}/{s.att.length} present
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
