import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Field, Flash, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/engines/time";
import { confirmFee, enrol, issueCertificate, revokeCertificate, updateStudent, waiveFee } from "../../actions";
import { ScholarsNav, STAGES, STAGE_TONE, rupees } from "../../nav";

export const metadata = { title: "Student · VSM Scholars" };
const local = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 16) : "");

export default async function Student({
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
  const { data: s } = await sb
    .from("scholar_students")
    .select("*, course:scholar_courses(name), referrer:scholar_students!scholar_students_referred_by_fkey(id, full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!s) notFound();
  const [{ data: ens }, { data: courses }, { data: batches }, { data: staff }, { data: referred }] = await Promise.all([
    sb
      .from("scholar_enrollments")
      .select(
        "id, fee_total, discount, status, enrolled_at, batch:scholar_batches(id, name, course:scholar_courses(name, fee)), fees:scholar_fee_payments(id, amount, due_on, status, paid_on, method, reference, receipt_no), cert:scholar_certificates(id, certificate_no, verify_code, issued_on, grade, revoked_at)",
      )
      .eq("student_id", id)
      .order("enrolled_at"),
    sb.from("scholar_courses").select("id, name, fee").eq("is_active", true),
    sb
      .from("scholar_batches")
      .select("id, name, capacity, course:scholar_courses(name, fee)")
      .in("status", ["PLANNED", "RUNNING"])
      .order("starts_on"),
    sb.from("employee_directory").select("id, full_name").order("full_name"),
    sb.from("scholar_students").select("id, full_name, stage").eq("referred_by", id),
  ]);
  const manage = can(ctx, "scholars.manage"),
    fees = can(ctx, "scholars.fees"),
    certify = can(ctx, "scholars.certify");
  const back = `/scholars/students/${id}`;
  const today = new Date().toISOString().slice(0, 10);
  const nextMonth = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
  return (
    <>
      <PageHeader eyebrow="VSM Scholars · student" title={s.full_name}>
        <Badge tone={STAGE_TONE[s.stage]}>{s.stage}</Badge>
        <a
          href={`https://wa.me/${s.phone.replace(/^\+?/, "").replace(/^(\d{10})$/, "91$1")}`}
          target="_blank"
          rel="noreferrer"
          className="btn-ghost"
        >
          WhatsApp
        </a>
        <a href={`tel:${s.phone}`} className="btn-ghost">
          Call
        </a>
      </PageHeader>
      <ScholarsNav active="/scholars/students" />
      <Flash sp={sp} />
      <div className="grid gap-6 xl:grid-cols-[1fr_1.3fr]">
        <Card title="Profile & counselling">
          <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted">Mobile</dt>
              <dd>{s.phone}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Email</dt>
              <dd>{s.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">City</dt>
              <dd>{s.city ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Source</dt>
              <dd>
                {s.source.toLowerCase().replace("_", " ")}
                {s.affiliate_code ? ` · affiliate ${s.affiliate_code}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Referral code</dt>
              <dd className="font-mono">{s.referral_code}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Referred by</dt>
              <dd>
                {(s.referrer as { id: string; full_name: string } | null) ? (
                  <Link className="hover:text-volt" href={`/scholars/students/${(s.referrer as { id: string }).id}`}>
                    {(s.referrer as { full_name: string }).full_name}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>
          {manage ? (
            <form action={updateStudent} className="grid gap-3">
              <input type="hidden" name="id" value={id} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Stage">
                  <select name="stage" defaultValue={s.stage} className="input">
                    {STAGES.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Interested in">
                  <select name="interested_course_id" defaultValue={s.interested_course_id ?? ""} className="input">
                    <option value="">—</option>
                    {(courses ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Counsellor">
                  <select name="counsellor_id" defaultValue={s.counsellor_id ?? ""} className="input">
                    <option value="">—</option>
                    {(staff ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Next follow-up">
                  <input name="next_follow_up_at" type="datetime-local" defaultValue={local(s.next_follow_up_at)} className="input" />
                </Field>
              </div>
              <Field label="Reason (if lost / dropped)">
                <input name="lost_reason" defaultValue={s.lost_reason ?? ""} className="input" />
              </Field>
              <Field label="Notes">
                <textarea name="notes" rows={4} defaultValue={s.notes ?? ""} className="input" />
              </Field>
              <div>
                <button className="btn-primary">Save</button>
              </div>
            </form>
          ) : (
            <p className="whitespace-pre-wrap text-sm">{s.notes}</p>
          )}
          {!!referred?.length && (
            <div className="mt-4 border-t border-line pt-3 text-sm">
              <p className="eyebrow mb-1">Referred {referred.length}</p>
              {referred.map((r) => (
                <Link key={r.id} href={`/scholars/students/${r.id}`} className="mr-3 hover:text-volt">
                  {r.full_name} <span className="text-xs text-muted">({r.stage.toLowerCase()})</span>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-6">
          {(ens ?? []).map((en: Record<string, unknown>) => {
            const b = en.batch as { id: string; name: string; course: { name: string } | null };
            const list = (
              (en.fees as {
                id: string;
                amount: number;
                due_on: string;
                status: string;
                paid_on: string | null;
                method: string | null;
                reference: string | null;
                receipt_no: string | null;
              }[]) ?? []
            ).sort((a, z) => a.due_on.localeCompare(z.due_on));
            const certs =
              (en.cert as
                | {
                    id: string;
                    certificate_no: string;
                    verify_code: string;
                    issued_on: string;
                    grade: string | null;
                    revoked_at: string | null;
                  }[]
                | null) ?? [];
            const cert = certs[0];
            const paid = list.filter((f) => f.status === "PAID").reduce((a, f) => a + Number(f.amount), 0);
            return (
              <Card
                key={en.id as string}
                title={`${b.course?.name} · ${b.name}`}
                action={<Badge tone={en.status === "ACTIVE" ? "green" : "grey"}>{en.status as string}</Badge>}
              >
                <p className="text-sm">
                  Fee {rupees(en.fee_total)}
                  {Number(en.discount) ? ` − discount ${rupees(en.discount)}` : ""} · paid {rupees(paid)} ·{" "}
                  <Link href={`/scholars/batches/${b.id}`} className="text-volt hover:underline">
                    batch
                  </Link>
                </p>
                <ul className="mt-3 divide-y divide-line text-sm">
                  {list.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        {rupees(f.amount)} <span className="text-xs text-muted">due {fmtDate(f.due_on)}</span>
                        {f.status === "PAID" && (
                          <span className="text-xs text-muted">
                            {" "}
                            · {f.method} {f.reference ?? ""} · {f.receipt_no}
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-2">
                        <Badge tone={f.status === "PAID" ? "green" : f.status === "WAIVED" ? "grey" : f.due_on < today ? "red" : "amber"}>
                          {f.status === "DUE" && f.due_on < today ? "OVERDUE" : f.status}
                        </Badge>
                        {f.status === "PAID" && (
                          <a href={`/api/scholars/receipt/${f.id}`} className="text-xs text-volt hover:underline">
                            Receipt PDF
                          </a>
                        )}
                      </span>
                      {f.status === "DUE" && fees && (
                        <div className="w-full">
                          <form action={confirmFee} className="mt-1 flex flex-wrap gap-2">
                            <input type="hidden" name="id" value={f.id} />
                            <input type="hidden" name="back" value={back} />
                            <select name="method" className="input w-28 py-1 text-xs">
                              <option>UPI</option>
                              <option>CASH</option>
                              <option>BANK</option>
                              <option>RAZORPAY</option>
                              <option>CARD</option>
                            </select>
                            <input name="reference" placeholder="UTR / txn id" className="input w-40 py-1 text-xs" />
                            <input name="paid_on" type="date" defaultValue={today} max={today} className="input w-36 py-1 text-xs" />
                            <button className="btn-primary py-1 text-xs">Confirm received</button>
                          </form>
                          <form action={waiveFee} className="mt-1 flex gap-2">
                            <input type="hidden" name="id" value={f.id} />
                            <input type="hidden" name="back" value={back} />
                            <input name="reason" placeholder="Waive reason" className="input w-56 py-1 text-xs" />
                            <button className="btn-ghost py-1 text-xs">Waive</button>
                          </form>
                        </div>
                      )}
                    </li>
                  ))}
                  {!list.length && <li className="py-2 text-xs text-muted">No fee schedule.</li>}
                </ul>
                <div className="mt-3 border-t border-line pt-3 text-sm">
                  {cert ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        Certificate <b className="font-mono">{cert.certificate_no}</b> · {fmtDate(cert.issued_on)}
                        {cert.grade ? ` · grade ${cert.grade}` : ""} {cert.revoked_at && <Badge tone="red">REVOKED</Badge>}
                      </span>
                      <span className="flex gap-2">
                        <a className="btn-ghost text-xs" href={`/api/scholars/certificate/${cert.id}`}>
                          Certificate PDF
                        </a>
                        <a className="btn-ghost text-xs" href={`/verify/${cert.verify_code}`} target="_blank" rel="noreferrer">
                          Verify page
                        </a>
                      </span>
                      {certify && !cert.revoked_at && (
                        <form action={revokeCertificate} className="flex w-full gap-2">
                          <input type="hidden" name="id" value={cert.id} />
                          <input type="hidden" name="back" value={back} />
                          <input name="reason" placeholder="Reason to revoke" className="input w-64 py-1 text-xs" />
                          <button className="btn-ghost py-1 text-xs text-danger">Revoke</button>
                        </form>
                      )}
                    </div>
                  ) : certify ? (
                    <form action={issueCertificate} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="enrollment_id" value={en.id as string} />
                      <input type="hidden" name="back" value={back} />
                      <Field label="Grade">
                        <select name="grade" className="input py-1 text-xs">
                          <option>A+</option>
                          <option>A</option>
                          <option>B</option>
                          <option>C</option>
                          <option>PASS</option>
                        </select>
                      </Field>
                      <Field label="Min attendance %">
                        <input
                          name="min_attendance"
                          type="number"
                          min={0}
                          max={100}
                          defaultValue={75}
                          className="input w-24 py-1 text-xs"
                        />
                      </Field>
                      <button className="btn-primary py-1 text-xs">Issue certificate</button>
                      <span className="text-xs text-muted">Needs all fees settled and attendance at or above the minimum.</span>
                    </form>
                  ) : (
                    <p className="text-xs text-muted">No certificate yet.</p>
                  )}
                </div>
              </Card>
            );
          })}
          {manage && (
            <Card title="Enrol in a batch">
              {!batches?.length ? (
                <p className="text-sm text-muted">
                  No open batches.{" "}
                  <Link className="text-volt hover:underline" href="/scholars/batches">
                    Create one
                  </Link>
                  .
                </p>
              ) : (
                <form action={enrol} className="grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="student_id" value={id} />
                  <Field label="Batch" className="sm:col-span-2">
                    <select name="batch_id" required className="input">
                      {batches.map((b: { id: string; name: string; course: unknown }) => (
                        <option key={b.id} value={b.id}>
                          {(b.course as { name: string; fee: number | null } | null)?.name} · {b.name}
                          {(b.course as { fee: number | null } | null)?.fee ? ` · ${rupees((b.course as { fee: number }).fee)}` : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Course fee ₹">
                    <input name="fee_total" type="number" min={0} step="1" required className="input" />
                  </Field>
                  <Field label="Discount ₹">
                    <input name="discount" type="number" min={0} step="1" defaultValue={0} className="input" />
                  </Field>
                  <Field label="Instalments">
                    <input name="instalments" type="number" min={1} max={12} defaultValue={1} className="input" />
                  </Field>
                  <Field label="First instalment due">
                    <input name="first_due" type="date" defaultValue={nextMonth} required className="input" />
                  </Field>
                  <div>
                    <button className="btn-primary">Enrol & create fee schedule</button>
                  </div>
                </form>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
