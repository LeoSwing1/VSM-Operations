import { NextResponse, type NextRequest } from "next/server";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { receiptPdf } from "@/lib/pdf/scholars";
import { fmtDate } from "@/lib/engines/time";

export const dynamic = "force-dynamic";
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const sb = await supabaseServer();
  const { data: f } = await sb
    .from("scholar_fee_payments")
    .select(
      "amount, paid_on, method, reference, receipt_no, status, enrollment_id, enrollment:scholar_enrollments(student:scholar_students(full_name, phone), batch:scholar_batches(name, course:scholar_courses(name)))",
    )
    .eq("id", id)
    .maybeSingle(); // RLS: scholars.fees / scholars.manage
  if (!f || f.status !== "PAID" || !f.receipt_no) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data: rest } = await sb.from("scholar_fee_payments").select("amount").eq("enrollment_id", f.enrollment_id).eq("status", "DUE");
  const en = f.enrollment as unknown as {
    student: { full_name: string; phone: string };
    batch: { name: string; course: { name: string } };
  };
  const pdf = await receiptPdf({
    receipt: f.receipt_no,
    date: fmtDate(f.paid_on!),
    student: en.student.full_name,
    phone: en.student.phone,
    course: en.batch.course.name,
    batch: en.batch.name,
    amount: Number(f.amount),
    method: f.method ?? "",
    reference: f.reference,
    balance: (rest ?? []).reduce((a, r) => a + Number(r.amount), 0),
    org: ctx.org_name,
  });
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${f.receipt_no}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
