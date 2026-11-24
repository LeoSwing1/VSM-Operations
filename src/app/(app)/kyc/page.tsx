import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Field, Flash, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/engines/time";
import { DOC_LABELS } from "@/lib/kyc";
import { saveKyc, submitKyc, uploadKycDoc } from "./actions";

export const metadata = { title: "My KYC" };

export default async function MyKyc({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const [{ data: k }, { data: docs }] = await Promise.all([
    sb.from("kyc_profiles").select("*").eq("employee_id", ctx.employee_id).maybeSingle(),
    sb
      .from("kyc_documents")
      .select("id, doc_type, original_name, status, review_note, uploaded_at")
      .eq("employee_id", ctx.employee_id)
      .neq("status", "REPLACED")
      .order("uploaded_at", { ascending: false }),
  ]);
  if (!k) {
    return (
      <>
        <PageHeader eyebrow="Onboarding" title="My KYC" />
        <Card>
          <p className="text-sm text-muted">There is no KYC form for your account (the Super Admin doesn&apos;t need one).</p>
        </Card>
      </>
    );
  }
  const editable = ["NOT_STARTED", "DRAFT", "CHANGES_REQUESTED"].includes(k.status);
  const required = Object.entries(DOC_LABELS).filter(([, d]) => d.required);
  const haveDoc = (t: string) => (docs ?? []).some((d) => d.doc_type === t && d.status !== "REJECTED");
  const fieldsDone = [
    k.date_of_birth,
    k.father_name,
    k.personal_phone,
    k.current_address,
    k.permanent_address,
    k.emergency_name && k.emergency_phone,
    k.pan,
    k.aadhaar_last4,
    k.bank_account_no && k.bank_ifsc && k.bank_account_holder,
  ].filter(Boolean).length;
  const docsDone = required.filter(([t]) => haveDoc(t)).length;
  const mask = (v: string | null, keep = 4) => (v ? "•".repeat(Math.max(0, v.length - keep)) + v.slice(-keep) : "");

  return (
    <>
      <PageHeader eyebrow="Onboarding" title="My KYC">
        <Badge>{k.status}</Badge>
      </PageHeader>
      <Flash sp={sp} />
      {k.status === "CHANGES_REQUESTED" && k.review_note && (
        <div className="mb-6 rounded-xl border border-ember/50 bg-ember/10 px-4 py-3 text-sm">
          <strong>HR asked for changes:</strong> {k.review_note}
        </div>
      )}
      {k.status === "SUBMITTED" && (
        <div className="mb-6 rounded-xl border border-line px-4 py-3 text-sm">
          Submitted {k.submitted_at ? fmtDateTime(k.submitted_at, ctx.timezone) : ""} — HR is verifying. The form is locked until they
          respond.
        </div>
      )}
      {k.status === "VERIFIED" && (
        <div className="mb-6 rounded-xl border border-volt/40 bg-volt/10 px-4 py-3 text-sm text-volt">Verified ✓ Thank you.</div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <div className="card p-4 text-sm">
          <p className="eyebrow">Details</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{fieldsDone}/9</p>
        </div>
        <div className="card p-4 text-sm">
          <p className="eyebrow">Required documents</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {docsDone}/{required.length}
          </p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Card title="1 · Your details" hint="Only you and HR can see this. We store only the last 4 digits of your Aadhaar.">
          <form action={saveKyc} className="grid gap-3 sm:grid-cols-2">
            <fieldset disabled={!editable} className="contents">
              <Field label="Date of birth">
                <input type="date" name="date_of_birth" defaultValue={k.date_of_birth ?? ""} className="input" />
              </Field>
              <Field label="Father's / guardian's name">
                <input name="father_name" defaultValue={k.father_name ?? ""} className="input" maxLength={120} />
              </Field>
              <Field label="Personal phone">
                <input
                  name="personal_phone"
                  inputMode="tel"
                  defaultValue={k.personal_phone ?? ""}
                  className="input"
                  placeholder="98765 43210"
                />
              </Field>
              <Field label="Personal email (optional)">
                <input name="personal_email" type="email" defaultValue={k.personal_email ?? ""} className="input" />
              </Field>
              <Field label="Current address" className="sm:col-span-2">
                <textarea name="current_address" rows={2} defaultValue={k.current_address ?? ""} className="input" maxLength={400} />
              </Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  name="same_address"
                  defaultChecked={!!k.current_address && k.current_address === k.permanent_address}
                />{" "}
                Permanent address is the same
              </label>
              <Field label="Permanent address" className="sm:col-span-2">
                <textarea name="permanent_address" rows={2} defaultValue={k.permanent_address ?? ""} className="input" maxLength={400} />
              </Field>
              <Field label="Emergency contact name">
                <input name="emergency_name" defaultValue={k.emergency_name ?? ""} className="input" />
              </Field>
              <Field label="Relation">
                <input
                  name="emergency_relation"
                  defaultValue={k.emergency_relation ?? ""}
                  className="input"
                  placeholder="Father, Mother, Spouse…"
                />
              </Field>
              <Field label="Emergency phone">
                <input name="emergency_phone" inputMode="tel" defaultValue={k.emergency_phone ?? ""} className="input" />
              </Field>
              <Field label="Blood group (optional)">
                <select name="blood_group" defaultValue={k.blood_group ?? ""} className="input">
                  <option value="">—</option>
                  {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              </Field>
              <Field label="Highest qualification" className="sm:col-span-2">
                <input
                  name="highest_education"
                  defaultValue={k.highest_education ?? ""}
                  className="input"
                  placeholder="e.g. B.Com, CCS University, 2022"
                />
              </Field>
              <Field label="PAN">
                <input name="pan" defaultValue={k.pan ?? ""} className="input uppercase" placeholder="ABCDE1234F" maxLength={10} />
              </Field>
              <Field label="Aadhaar — last 4 digits only">
                <input
                  name="aadhaar_last4"
                  defaultValue={k.aadhaar_last4 ?? ""}
                  className="input"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="1234"
                />
              </Field>
              <Field label="Account holder name">
                <input name="bank_account_holder" defaultValue={k.bank_account_holder ?? ""} className="input" />
              </Field>
              <Field label="Bank account number">
                <input
                  name="bank_account_no"
                  defaultValue={editable ? (k.bank_account_no ?? "") : mask(k.bank_account_no)}
                  className="input"
                  inputMode="numeric"
                  autoComplete="off"
                />
              </Field>
              <Field label="IFSC">
                <input
                  name="bank_ifsc"
                  defaultValue={k.bank_ifsc ?? ""}
                  className="input uppercase"
                  placeholder="HDFC0001234"
                  maxLength={11}
                />
              </Field>
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="declaration" defaultChecked={k.declaration_accepted} className="mt-1" />
                <span>
                  I confirm these details and documents are true and mine, and I allow VSM to use them for employment, payroll and statutory
                  records.
                </span>
              </label>
              {editable && (
                <div className="sm:col-span-2">
                  <button className="btn">Save</button>
                </div>
              )}
            </fieldset>
          </form>
        </Card>

        <div className="grid content-start gap-6">
          <Card title="2 · Documents" hint="PDF or photo, up to 5 MB each. A new upload replaces the old one.">
            <ul className="mb-4 divide-y divide-line">
              {Object.entries(DOC_LABELS).map(([t, d]) => {
                const doc = (docs ?? []).find((x) => x.doc_type === t);
                return (
                  <li key={t} className="flex items-start justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0">
                      {d.label}
                      {d.required && <span className="text-ember"> *</span>}
                      <span className="block text-xs text-muted">{doc ? doc.original_name : d.hint}</span>
                      {doc?.status === "REJECTED" && doc.review_note && (
                        <span className="block text-xs text-danger">HR: {doc.review_note}</span>
                      )}
                    </span>
                    {doc ? (
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge tone={doc.status === "VERIFIED" ? "green" : doc.status === "REJECTED" ? "red" : "amber"}>{doc.status}</Badge>
                        <a className="text-xs underline" href={`/api/kyc/doc/${doc.id}`} target="_blank" rel="noopener noreferrer">
                          View
                        </a>
                      </span>
                    ) : (
                      <Badge tone="grey">MISSING</Badge>
                    )}
                  </li>
                );
              })}
            </ul>
            {editable && (
              <form action={uploadKycDoc} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <select name="doc_type" className="input" aria-label="Document type" required>
                  {Object.entries(DOC_LABELS).map(([t, d]) => (
                    <option key={t} value={t}>
                      {d.label}
                    </option>
                  ))}
                </select>
                <input
                  name="file"
                  type="file"
                  required
                  accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
                  className="input"
                  aria-label="File"
                />
                <button className="btn-ghost">Upload</button>
              </form>
            )}
          </Card>
          {editable && (
            <Card title="3 · Submit" hint="Save your details and upload every starred document first.">
              <form action={submitKyc}>
                <button className="btn-primary w-full" disabled={fieldsDone < 9 || docsDone < required.length || !k.declaration_accepted}>
                  Submit for verification
                </button>
              </form>
              {(fieldsDone < 9 || docsDone < required.length || !k.declaration_accepted) && (
                <p className="mt-2 text-xs text-muted">
                  {9 - fieldsDone > 0 ? `${9 - fieldsDone} detail(s) missing · ` : ""}
                  {required.length - docsDone > 0 ? `${required.length - docsDone} document(s) missing · ` : ""}
                  {!k.declaration_accepted ? "tick the declaration and Save" : ""}
                </p>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
