import { appUrl } from "@/lib/app-url";
import { NextResponse, type NextRequest } from "next/server";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { certificatePdf } from "@/lib/pdf/scholars";
import { fmtDate } from "@/lib/engines/time";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const sb = await supabaseServer();
  const { data: c } = await sb
    .from("scholar_certificates")
    .select(
      "certificate_no, verify_code, issued_on, grade, revoked_at, enrollment:scholar_enrollments(student:scholar_students(full_name), batch:scholar_batches(name, starts_on, ends_on, course:scholar_courses(name)))",
    )
    .eq("id", id)
    .maybeSingle(); // RLS: scholars.view
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (c.revoked_at) return NextResponse.json({ error: "This certificate was revoked." }, { status: 410 });
  const en = c.enrollment as unknown as {
    student: { full_name: string };
    batch: { name: string; starts_on: string; ends_on: string | null; course: { name: string } };
  };
  const base = appUrl();
  const pdf = await certificatePdf({
    name: en.student.full_name,
    course: en.batch.course.name,
    batch: en.batch.name,
    from: fmtDate(en.batch.starts_on),
    to: en.batch.ends_on ? fmtDate(en.batch.ends_on) : fmtDate(c.issued_on),
    issued: fmtDate(c.issued_on),
    number: c.certificate_no,
    grade: c.grade,
    verifyUrl: `${base}/verify/${c.verify_code}`,
  });
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${c.certificate_no}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
