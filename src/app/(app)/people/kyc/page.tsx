import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Flash, PageHeader, TableWrap } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/engines/time";
import { DOC_LABELS } from "@/lib/kyc";
import { remindKyc, reviewKyc, reviewKycDoc } from "../../kyc/actions";
import { DecisionButtons } from "@/components/decision-buttons";

export const metadata = { title: "KYC verification" };
const ORDER = ["SUBMITTED", "CHANGES_REQUESTED", "DRAFT", "NOT_STARTED", "VERIFIED"];

export default async function KycQueue({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePerm("kyc.verify");
  const sb = await supabaseServer();
  const [{ data: rows }, { data: people }] = await Promise.all([
    sb.from("kyc_profiles").select("employee_id, status, requested_at, submitted_at, reviewed_at"),
    sb.from("employees").select("id, full_name, employee_code, designation, joining_date, status").neq("status", "EXITED"),
  ]);
  const person = new Map((people ?? []).map((p) => [p.id, p]));
  const list = (rows ?? [])
    .filter((r) => person.has(r.employee_id))
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || (b.submitted_at ?? "").localeCompare(a.submitted_at ?? ""));
  const sel = sp.e && /^[0-9a-f-]{36}$/.test(sp.e) ? sp.e : null;
  const [{ data: k }, { data: docs }] = sel
    ? await Promise.all([
        sb.from("kyc_profiles").select("*").eq("employee_id", sel).maybeSingle(),
        sb.from("kyc_documents").select("*").eq("employee_id", sel).neq("status", "REPLACED").order("uploaded_at", { ascending: false }),
      ])
    : [{ data: null }, { data: null }];
  const who = sel ? person.get(sel) : null;
  const count = (s: string) => list.filter((r) => r.status === s).length;
  const mask = (v: string | null, keep = 4) => (v ? "•".repeat(Math.max(0, v.length - keep)) + v.slice(-keep) : "—");

  return (
    <>
      <PageHeader eyebrow="People" title="KYC verification">
        <Badge tone="amber">{`${count("SUBMITTED")} TO VERIFY`}</Badge>
      </PageHeader>
      <Flash sp={sp} />

      {sel && k && who && (
        <div className="mb-6 grid gap-6 xl:grid-cols-[1fr_1.2fr]">
          <Card
            title={`${who.full_name} · ${who.employee_code}`}
            hint={`${who.designation ?? ""} · joined ${who.joining_date ? fmtDate(who.joining_date) : "—"}`}
          >
            <p className="mb-3 text-sm">
              Status: <Badge>{k.status}</Badge>
              {k.submitted_at && <span className="ml-2 text-xs text-muted">submitted {fmtDateTime(k.submitted_at, ctx.timezone)}</span>}
            </p>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {(
                [
                  ["Date of birth", k.date_of_birth ? fmtDate(k.date_of_birth) : "—"],
                  ["Father / guardian", k.father_name ?? "—"],
                  ["Personal phone", k.personal_phone ?? "—"],
                  ["Personal email", k.personal_email ?? "—"],
                  ["Current address", k.current_address ?? "—"],
                  ["Permanent address", k.permanent_address ?? "—"],
                  [
                    "Emergency contact",
                    k.emergency_name ? `${k.emergency_name} (${k.emergency_relation ?? "—"}) · ${k.emergency_phone ?? ""}` : "—",
                  ],
                  ["Blood group", k.blood_group ?? "—"],
                  ["Highest qualification", k.highest_education ?? "—"],
                  ["PAN", k.pan ?? "—"],
                  ["Aadhaar", k.aadhaar_last4 ? `XXXX XXXX ${k.aadhaar_last4}` : "—"],
                  ["Bank", k.bank_account_no ? `${k.bank_account_holder ?? ""} · ${mask(k.bank_account_no)} · ${k.bank_ifsc ?? ""}` : "—"],
                  ["Declaration", k.declaration_accepted ? "Accepted" : "Not accepted"],
                ] as [string, string][]
              ).map(([a, b]) => (
                <div key={a}>
                  <dt className="text-xs text-muted">{a}</dt>
                  <dd className="mt-0.5 break-words">{b}</dd>
                </div>
              ))}
            </dl>
            {k.status === "SUBMITTED" && (
              <form action={reviewKyc} className="mt-5 grid gap-2">
                <input type="hidden" name="employee_id" value={sel} />
                <textarea name="note" rows={2} maxLength={1000} className="input" placeholder="Note (required when asking for changes)" />
                <div className="flex flex-wrap gap-2">
                  <DecisionButtons
                    choices={[
                      { value: "VERIFIED", label: "Verify KYC", className: "btn-primary" },
                      { value: "CHANGES_REQUESTED", label: "Ask for changes", className: "btn-ghost" },
                    ]}
                  />
                </div>
                <p className="text-xs text-muted">
                  Verify each required document first. On verification, PAN and bank details are added to payroll where empty.
                </p>
              </form>
            )}
          </Card>
          <Card title="Documents" hint="Opens a private 60-second link. Every view is recorded in the audit log.">
            {!(docs ?? []).length ? (
              <Empty title="No documents yet" />
            ) : (
              <ul className="divide-y divide-line">
                {(docs ?? []).map((d) => (
                  <li key={d.id} className="grid gap-2 py-3 text-sm sm:grid-cols-[1fr_auto]">
                    <span className="min-w-0">
                      <a href={`/api/kyc/doc/${d.id}`} target="_blank" rel="noopener noreferrer" className="font-semibold hover:text-volt">
                        {DOC_LABELS[d.doc_type]?.label ?? d.doc_type} ↗
                      </a>
                      <span className="block truncate text-xs text-muted">
                        {d.original_name} · {(d.size_bytes / 1024).toFixed(0)} KB · {fmtDateTime(d.uploaded_at, ctx.timezone)}
                      </span>
                      {d.review_note && <span className="block text-xs text-muted">Note: {d.review_note}</span>}
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={d.status === "VERIFIED" ? "green" : d.status === "REJECTED" ? "red" : "amber"}>{d.status}</Badge>
                      {k.status === "SUBMITTED" && d.status === "PENDING" && (
                        <form action={reviewKycDoc} className="flex flex-wrap gap-1">
                          <input type="hidden" name="id" value={d.id} />
                          <input type="hidden" name="employee_id" value={sel} />
                          <input name="note" placeholder="Reason if rejecting" className="input w-36 py-1 text-xs" maxLength={500} />
                          <DecisionButtons
                            choices={[
                              { value: "VERIFIED", label: "✓ Verify", className: "btn-ghost text-xs" },
                              { value: "REJECTED", label: "Reject", className: "btn-ghost text-xs text-danger" },
                            ]}
                          />
                        </form>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      <Card title="Everyone" hint="New joiners get an automatic chat message asking for KYC. Send a reminder if someone hasn't started.">
        {!list.length ? (
          <Empty title="No KYC records yet" />
        ) : (
          <TableWrap>
            <table className="table min-w-[640px]">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Status</th>
                  <th>Asked</th>
                  <th>Submitted</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const p = person.get(r.employee_id)!;
                  return (
                    <tr key={r.employee_id} className={sel === r.employee_id ? "bg-volt/10" : undefined}>
                      <td>
                        <Link href={`/people/kyc?e=${r.employee_id}`} className="font-semibold hover:text-volt">
                          {p.full_name}
                        </Link>
                        <span className="block text-xs text-muted">
                          {p.employee_code} · {p.designation ?? "—"}
                        </span>
                      </td>
                      <td>
                        <Badge
                          tone={
                            r.status === "VERIFIED"
                              ? "green"
                              : r.status === "SUBMITTED"
                                ? "amber"
                                : r.status === "CHANGES_REQUESTED"
                                  ? "red"
                                  : "grey"
                          }
                        >
                          {r.status}
                        </Badge>
                      </td>
                      <td className="text-xs text-muted">{r.requested_at ? fmtDateTime(r.requested_at, ctx.timezone) : "—"}</td>
                      <td className="text-xs text-muted">{r.submitted_at ? fmtDateTime(r.submitted_at, ctx.timezone) : "—"}</td>
                      <td>
                        {["NOT_STARTED", "DRAFT", "CHANGES_REQUESTED"].includes(r.status) && (
                          <form action={remindKyc}>
                            <input type="hidden" name="employee_id" value={r.employee_id} />
                            <button className="btn-ghost text-xs">Send reminder</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
