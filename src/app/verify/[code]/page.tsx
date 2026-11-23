import { supabaseServer } from "@/lib/supabase/server";
import { VsmMark } from "@/components/brand";
import { fmtDate } from "@/lib/engines/time";

export const metadata = { title: "Verify certificate · VSM Scholars", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Public page behind the QR code. Shows only what is printed on the certificate. */
export default async function Verify({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const valid = /^[0-9a-f]{12}$/i.test(code);
  const sb = await supabaseServer();
  const { data } = valid ? await sb.rpc("verify_certificate", { p_code: code }) : { data: null };
  const c = (
    data as
      | {
          certificate_no: string;
          student_name: string;
          course: string;
          batch: string;
          starts_on: string;
          ends_on: string | null;
          issued_on: string;
          grade: string | null;
          status: string;
        }[]
      | null
  )?.[0];
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 p-6">
      <VsmMark className="text-4xl" sub={false} />
      <p className="eyebrow">VSM Scholars · certificate check</p>
      {!c ? (
        <div className="card p-6">
          <h1 className="display text-4xl">Not found</h1>
          <p className="mt-2 text-sm text-muted">No certificate matches this code. Check the link or contact VSM Scholars.</p>
        </div>
      ) : (
        <div className="card p-6">
          <p className={`chip ${c.status === "VALID" ? "border-volt text-volt" : "border-danger text-danger"}`}>
            {c.status === "VALID" ? "✓ Genuine certificate" : "✕ Revoked"}
          </p>
          <h1 className="display mt-4 text-4xl">{c.student_name}</h1>
          <p className="mt-2 text-sm">
            completed <b>{c.course}</b>
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted">Certificate no.</dt>
              <dd className="font-mono">{c.certificate_no}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Issued</dt>
              <dd>{fmtDate(c.issued_on)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Batch</dt>
              <dd>{c.batch}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Grade</dt>
              <dd>{c.grade ?? "—"}</dd>
            </div>
          </dl>
        </div>
      )}
      <p className="text-xs text-muted">VSM Scholars — Digital Marketing, Graphic Design and Video Editing · Meerut & Noida</p>
    </main>
  );
}
