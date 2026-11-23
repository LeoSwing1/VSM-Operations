import { notFound } from "next/navigation";
import { requireContext, can } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/engines/time";
import { PrintButton } from "./print-button";

export default async function EmployeeLetterPage({ params }: { params: Promise<{ id: string; letterId: string }> }) {
  const { id, letterId } = await params;
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const { data: letter } = await sb
    .from("employee_letters")
    .select("id,employee_id,letter_type,reference_no,issued_on,snapshot,status")
    .eq("id", letterId)
    .eq("employee_id", id)
    .maybeSingle();
  if (!letter) notFound();
  if (letter.status !== "ISSUED") notFound();
  const snap = letter.snapshot as Record<string, string | null>;
  const self = id === ctx.employee_id;
  if (!self && !can(ctx, "people.manage")) notFound();
  const type = letter.letter_type as string;
  const title =
    (
      {
        OFFER: "Offer of Employment",
        APPOINTMENT: "Letter of Appointment",
        EXPERIENCE: "Experience Certificate",
        RELIEVING: "Relieving Letter",
      } as Record<string, string>
    )[type] ?? "Employment Letter";
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex items-center justify-between gap-3 print:hidden">
        <PageHeader eyebrow="VSM Growth · Employee document" title={title}>
          <Badge>{letter.status}</Badge>
        </PageHeader>
        <PrintButton />
      </div>
      <article className="min-h-[900px] border border-line bg-white p-10 text-slate-900 shadow-sm sm:p-16 print:min-h-0 print:border-0 print:p-0 print:shadow-none">
        <header className="border-b-2 border-slate-900 pb-6">
          <p className="text-2xl font-bold tracking-tight">{snap.company_name}</p>
          <p className="mt-1 text-sm text-slate-500">People & Culture</p>
        </header>
        <div className="mt-8 flex justify-between gap-4 text-sm">
          <span>Ref: {letter.reference_no}</span>
          <span>Date: {fmtDate(letter.issued_on)}</span>
        </div>
        <h1 className="mt-12 text-center text-xl font-bold uppercase tracking-wide">{title}</h1>
        <p className="mt-10 text-base">
          To,
          <br />
          <b>{snap.employee_name}</b>
          <br />
          Employee ID: {snap.employee_code}
          <br />
          {snap.designation}
          {snap.department ? ` · ${snap.department}` : ""}
        </p>
        {type === "OFFER" || type === "APPOINTMENT" ? (
          <div className="mt-8 space-y-4 text-[15px] leading-7">
            <p>Dear {snap.employee_name},</p>
            <p>
              We are pleased to confirm your {type === "OFFER" ? "employment offer" : "appointment"} with {snap.company_name} as{" "}
              <b>{snap.designation}</b>
              {snap.department ? ` in the ${snap.department} department` : ""}.
            </p>
            <p>
              Your recorded date of joining is <b>{fmtDate(snap.joining_date ?? "")}</b>. Your employment type is{" "}
              {String(snap.employment_type ?? "")
                .replaceAll("_", " ")
                .toLowerCase()}
              .
            </p>
            <p>
              Please contact the People & Culture team if any detail in this letter requires correction. This letter is generated from the
              employment record held by the company.
            </p>
            <p>We look forward to your contribution.</p>
          </div>
        ) : type === "EXPERIENCE" ? (
          <div className="mt-8 space-y-4 text-[15px] leading-7">
            <p>To whom it may concern,</p>
            <p>
              This is to certify that <b>{snap.employee_name}</b> (Employee ID: {snap.employee_code}) was associated with{" "}
              {snap.company_name} as <b>{snap.designation}</b>
              {snap.department ? ` in ${snap.department}` : ""}.
            </p>
            <p>
              The recorded joining date is {fmtDate(snap.joining_date ?? "")}. This certificate is issued on {fmtDate(letter.issued_on)}{" "}
              based on company employment records.
            </p>
          </div>
        ) : (
          <div className="mt-8 space-y-4 text-[15px] leading-7">
            <p>Dear {snap.employee_name},</p>
            <p>
              This is to acknowledge the conclusion of your employment with {snap.company_name}. The company records this relieving letter
              as issued on {fmtDate(letter.issued_on)}.
            </p>
            <p>We thank you for your contribution and wish you success in your future endeavours.</p>
          </div>
        )}
        <div className="mt-20 text-sm">
          <p>For {snap.company_name},</p>
          <div className="mt-14 border-t border-slate-500 pt-2 w-56">
            <b>Authorized Signatory</b>
            <br />
            <span className="text-slate-500">People & Culture</span>
          </div>
        </div>
        <footer className="mt-20 border-t border-slate-200 pt-3 text-center text-xs text-slate-400">
          Reference {letter.reference_no} · Issued {fmtDate(letter.issued_on)} · System-generated employment record
        </footer>
      </article>
      <style>{`@media print { body { background: white !important; } }`}</style>
    </div>
  );
}
