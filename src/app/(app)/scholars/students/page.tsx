import Link from "next/link";
import { redirect } from "next/navigation";
import { can, canAny, requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Field, Flash, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/engines/time";
import { addStudent } from "../actions";
import { ScholarsNav, SOURCES, STAGES, STAGE_TONE } from "../nav";

export const metadata = { title: "Students · VSM Scholars" };

export default async function Students({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!canAny(ctx, ["scholars.view", "scholars.teach"])) redirect("/dashboard");
  const sb = await supabaseServer();
  let q = sb
    .from("scholar_students")
    .select(
      "id, full_name, phone, city, stage, source, next_follow_up_at, created_at, course:scholar_courses(code), counsellor:employees!scholar_students_counsellor_id_fkey(full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(300);
  if (sp.stage && (STAGES as readonly string[]).includes(sp.stage)) q = q.eq("stage", sp.stage);
  if (sp.q) q = q.or(`full_name.ilike.%${sp.q.replace(/[%,()]/g, "")}%,phone.ilike.%${sp.q.replace(/[^0-9+]/g, "")}%`);
  const [{ data: rows }, { data: courses }] = await Promise.all([
    q,
    sb.from("scholar_courses").select("id, code, name").eq("is_active", true).order("code"),
  ]);
  const manage = can(ctx, "scholars.manage");
  return (
    <>
      <PageHeader eyebrow="VSM Scholars" title="Students & enquiries" />
      <ScholarsNav active="/scholars/students" />
      <Flash sp={sp} />
      {manage && (
        <details open={sp.new === "1"} className="card mb-6 p-5">
          <summary className="cursor-pointer font-semibold">+ New enquiry</summary>
          <form action={addStudent} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Full name">
              <input name="full_name" required className="input" />
            </Field>
            <Field label="Mobile">
              <input name="phone" required inputMode="tel" placeholder="98765 43210" className="input" />
            </Field>
            <Field label="Email">
              <input name="email" type="email" className="input" />
            </Field>
            <Field label="City">
              <input name="city" defaultValue="Meerut" className="input" />
            </Field>
            <Field label="Interested in">
              <select name="interested_course_id" className="input">
                <option value="">—</option>
                {(courses ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Source">
              <select name="source" defaultValue="INSTAGRAM" className="input">
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ").toLowerCase()}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Referral code (optional)">
              <input name="referral" className="input uppercase" placeholder="AB12CD34" />
            </Field>
            <Field label="Affiliate code (optional)">
              <input name="affiliate_code" className="input" />
            </Field>
            <Field label="Notes" className="sm:col-span-2 lg:col-span-4">
              <textarea name="notes" rows={2} className="input" />
            </Field>
            <div>
              <button className="btn-primary">Add enquiry</button>
            </div>
          </form>
        </details>
      )}
      <form className="mb-3 flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name or phone" className="input max-w-xs" />
        <select name="stage" defaultValue={sp.stage ?? ""} className="input max-w-[12rem]">
          <option value="">All stages</option>
          {STAGES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <button className="btn-ghost">Filter</button>
      </form>
      <Card>
        <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
          <table className="table min-w-[760px]">
            <thead>
              <tr>
                <th>Student</th>
                <th>Course</th>
                <th>Stage</th>
                <th>Source</th>
                <th>Counsellor</th>
                <th>Next follow-up</th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map(
                (r: {
                  id: string;
                  full_name: string;
                  phone: string;
                  city: string | null;
                  stage: string;
                  source: string;
                  next_follow_up_at: string | null;
                  course: unknown;
                  counsellor: unknown;
                }) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/scholars/students/${r.id}`} className="font-medium hover:text-volt">
                        {r.full_name}
                      </Link>
                      <span className="block text-xs text-muted">
                        {r.phone}
                        {r.city ? ` · ${r.city}` : ""}
                      </span>
                    </td>
                    <td className="text-xs">{(r.course as { code: string } | null)?.code ?? "—"}</td>
                    <td>
                      <Badge tone={STAGE_TONE[r.stage]}>{r.stage}</Badge>
                    </td>
                    <td className="text-xs text-muted">{r.source.toLowerCase().replace("_", " ")}</td>
                    <td className="text-xs">{(r.counsellor as { full_name: string } | null)?.full_name ?? "—"}</td>
                    <td
                      className={`text-xs ${r.next_follow_up_at && r.next_follow_up_at < new Date().toISOString() ? "text-ember" : "text-muted"}`}
                    >
                      {r.next_follow_up_at ? fmtDateTime(r.next_follow_up_at, ctx.timezone) : "—"}
                    </td>
                  </tr>
                ),
              )}
              {!rows?.length && (
                <tr>
                  <td colSpan={6} className="text-sm text-muted">
                    No students yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
