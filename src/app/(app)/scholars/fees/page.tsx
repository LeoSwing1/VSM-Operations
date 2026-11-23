import Link from "next/link";
import { redirect } from "next/navigation";
import { canAny, requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Flash, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/engines/time";
import { ScholarsNav, rupees } from "../nav";

export const metadata = { title: "Fees · VSM Scholars" };

export default async function Fees({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!canAny(ctx, ["scholars.fees", "scholars.manage"])) redirect("/scholars");
  const sb = await supabaseServer();
  const view = sp.view === "paid" ? "paid" : "due";
  let q = sb
    .from("scholar_fee_payments")
    .select(
      "id, amount, due_on, status, paid_on, method, reference, receipt_no, enrollment:scholar_enrollments(student:scholar_students(id, full_name, phone), batch:scholar_batches(name))",
    )
    .limit(300);
  q = view === "paid" ? q.eq("status", "PAID").order("paid_on", { ascending: false }) : q.eq("status", "DUE").order("due_on");
  const { data } = await q;
  const today = new Date().toISOString().slice(0, 10);
  const total = (data ?? []).reduce((a, f) => a + Number(f.amount), 0);
  return (
    <>
      <PageHeader eyebrow="VSM Scholars" title="Fees" />
      <ScholarsNav active="/scholars/fees" />
      <Flash sp={sp} />
      <nav className="mb-3 flex gap-2">
        <Link href="?view=due" className={view === "due" ? "chip border-volt text-volt" : "chip border-line text-muted"}>
          Due & overdue
        </Link>
        <Link href="?view=paid" className={view === "paid" ? "chip border-volt text-volt" : "chip border-line text-muted"}>
          Received
        </Link>
        <span className="ml-auto text-sm">{rupees(total)}</span>
      </nav>
      <Card>
        <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
          <table className="table min-w-[720px]">
            <thead>
              <tr>
                <th>Student</th>
                <th>Batch</th>
                <th className="text-right">Amount</th>
                <th>{view === "paid" ? "Paid" : "Due"}</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map(
                (f: {
                  id: string;
                  amount: number;
                  due_on: string;
                  status: string;
                  paid_on: string | null;
                  method: string | null;
                  receipt_no: string | null;
                  enrollment: unknown;
                }) => {
                  const en = f.enrollment as { student: { id: string; full_name: string; phone: string }; batch: { name: string } };
                  const overdue = f.status === "DUE" && f.due_on < today;
                  return (
                    <tr key={f.id}>
                      <td>
                        <Link href={`/scholars/students/${en.student.id}`} className="hover:text-volt">
                          {en.student.full_name}
                        </Link>
                        <span className="block text-xs text-muted">{en.student.phone}</span>
                      </td>
                      <td className="text-xs">{en.batch.name}</td>
                      <td className="text-right tabular-nums">{rupees(f.amount)}</td>
                      <td className="text-xs">
                        {fmtDate(view === "paid" ? f.paid_on! : f.due_on)}
                        {view === "paid" ? ` · ${f.method}` : ""}
                      </td>
                      <td>
                        <Badge tone={overdue ? "red" : f.status === "PAID" ? "green" : "amber"}>{overdue ? "OVERDUE" : f.status}</Badge>
                      </td>
                      <td className="text-right text-xs">
                        {f.receipt_no ? (
                          <a className="text-volt hover:underline" href={`/api/scholars/receipt/${f.id}`}>
                            {f.receipt_no}
                          </a>
                        ) : (
                          <Link className="text-volt hover:underline" href={`/scholars/students/${en.student.id}`}>
                            Record payment →
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                },
              )}
              {!data?.length && (
                <tr>
                  <td colSpan={6} className="text-sm text-muted">
                    Nothing here.
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
