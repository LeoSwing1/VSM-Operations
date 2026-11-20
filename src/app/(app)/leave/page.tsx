import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Field, Flash, PageHeader, Stat, TableWrap } from "@/components/ui";
import { daysBetweenInclusive, fmtDate, localDate } from "@/lib/engines/time";
import { applyLeave, cancelLeave } from "./actions";

export const metadata = { title: "Leave" };

export default async function Leave({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const year = localDate(new Date(), ctx.timezone).slice(0, 4);
  const [{ data: types }, { data: reqs }] = await Promise.all([
    sb.from("leave_types").select("id, code, name, is_paid, annual_quota").order("code"),
    sb.from("leave_requests").select("id, leave_type_id, start_date, end_date, half_day, reason, status, decision_note, created_at").eq("employee_id", ctx.employee_id).order("start_date", { ascending: false }),
  ]);
  const used = (typeId: string) => (reqs ?? []).filter((r) => r.leave_type_id === typeId && r.status === "APPROVED" && r.start_date.startsWith(year))
    .reduce((n, r) => n + (r.half_day ? 0.5 : daysBetweenInclusive(r.start_date, r.end_date)), 0);
  const typeName = (id: string) => types?.find((t) => t.id === id)?.name ?? "—";

  return (
    <>
      <PageHeader eyebrow="Work" title="Leave" />
      <Flash sp={sp} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {(types ?? []).filter((t) => t.is_paid).map((t) => (
          <Stat key={t.id} label={`${t.name} · ${year}`} value={`${Number(t.annual_quota) - used(t.id)}`} hint={`${used(t.id)} used of ${t.annual_quota}`} />
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card title="Apply for leave">
          <form action={applyLeave} className="grid gap-3 sm:grid-cols-2">
            <Field label="Type" className="sm:col-span-2"><select name="leave_type_id" className="input" required>
              {(types ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_paid ? "" : " (unpaid)"}</option>)}</select></Field>
            <Field label="From"><input type="date" name="start_date" className="input" required /></Field>
            <Field label="To"><input type="date" name="end_date" className="input" /></Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="half_day" /> Half day</label>
            <Field label="Reason" className="sm:col-span-2"><textarea name="reason" rows={3} required minLength={3} className="input" /></Field>
            <div><button className="btn-primary">Submit request</button></div>
          </form>
        </Card>
        <Card title="My requests">
          {!reqs?.length ? <Empty title="No leave requests" /> : <TableWrap><table className="table min-w-[520px]">
            <thead><tr><th>Type</th><th>Dates</th><th>Status</th><th></th></tr></thead>
            <tbody>{reqs.map((r) => (
              <tr key={r.id}>
                <td>{typeName(r.leave_type_id)}{r.half_day ? " (½)" : ""}<p className="text-xs text-muted">{r.reason}</p></td>
                <td className="whitespace-nowrap text-xs">{fmtDate(r.start_date)}{r.end_date !== r.start_date ? ` → ${fmtDate(r.end_date)}` : ""}</td>
                <td><Badge>{r.status}</Badge>{r.decision_note && <p className="mt-1 text-xs text-muted">{r.decision_note}</p>}</td>
                <td>{r.status === "PENDING" && <form action={cancelLeave}><input type="hidden" name="id" value={r.id} /><button className="text-xs text-muted hover:text-danger">Cancel</button></form>}</td>
              </tr>))}</tbody>
          </table></TableWrap>}
        </Card>
      </div>
    </>
  );
}
