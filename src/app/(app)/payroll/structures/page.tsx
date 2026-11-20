import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Empty, Field, Flash, PageHeader, TableWrap, inr } from "@/components/ui";
import { fmtDate } from "@/lib/engines/time";
import { saveIncentivePolicy, saveStructure } from "../actions";

export const metadata = { title: "Salary structures" };

export default async function Structures({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePerm("salary.manage");
  const sb = await supabaseServer();
  const [{ data: emps }, { data: structs }, { data: policies }] = await Promise.all([
    sb.from("employees").select("id, full_name, employee_code").neq("status", "EXITED").order("full_name"),
    sb.from("salary_structures").select("*").order("effective_from", { ascending: false }),
    sb.from("incentive_policies").select("*").order("created_at"),
  ]);
  await sb.rpc("log_salary_access", { p_entity: "salary_structures", p_entity_id: "list", p_subject: null, p_purpose: "structures admin" });
  const current = (id: string) => (structs ?? []).find((s) => s.employee_id === id && !s.effective_to);
  const blankPolicy = { id: "", name: "New incentive policy", slabs: [], cap_amount: null, prorate: true };

  return (
    <>
      <PageHeader eyebrow="Confidential" title="Salary structures" />
      <Flash sp={sp} />
      <Card title="Current structures">
        {!emps?.length ? <Empty title="No employees" /> : <TableWrap><table className="table min-w-[760px]">
          <thead><tr><th>Employee</th><th>Since</th><th>Type</th><th>Base</th><th>Allowances</th><th>Target incentive</th><th>Versions</th></tr></thead>
          <tbody>{emps.map((e) => { const s = current(e.id); return (
            <tr key={e.id}><td>{e.full_name}<span className="ml-2 font-mono text-[10px] text-muted">{e.employee_code}</span></td>
              <td className="text-xs">{s ? fmtDate(s.effective_from) : "—"}</td><td className="text-xs">{s?.pay_type.replaceAll("_", " ") ?? <span className="text-ember">none</span>}</td>
              <td className="tabular-nums">{s ? inr(s.base_monthly) : "—"}</td><td className="tabular-nums">{s ? inr((s.allowances as any[]).reduce((a, x) => a + Number(x.amount), 0)) : "—"}</td>
              <td className="tabular-nums">{s ? inr(s.target_incentive) : "—"}</td><td className="tabular-nums">{(structs ?? []).filter((x) => x.employee_id === e.id).length}</td></tr>); })}</tbody>
        </table></TableWrap>}
      </Card>

      <Card title="Add or revise a structure" className="mt-6">
        <form action={saveStructure} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Employee"><select name="employee_id" className="input" required>{(emps ?? []).filter((e) => e.id !== ctx.employee_id).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></Field>
          <Field label="Effective from"><input type="date" name="effective_from" className="input" required /></Field>
          <Field label="Pay type"><select name="pay_type" className="input"><option value="FIXED">Fixed</option><option value="FIXED_PLUS_VARIABLE">Fixed + variable</option><option value="INCENTIVE_ONLY">Incentive only</option></select></Field>
          <Field label="Monthly base (₹)"><input type="number" name="base_monthly" min="0" step="0.01" className="input" /></Field>
          <Field label="Target incentive / month (₹)"><input type="number" name="target_incentive" min="0" step="0.01" className="input" /></Field>
          <Field label="Incentive policy"><select name="incentive_policy_id" className="input"><option value="">—</option>{(policies ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Attendance incentive (₹)"><input type="number" name="attendance_incentive" min="0" step="0.01" className="input" /></Field>
          <Field label="Notes"><input name="notes" className="input" /></Field>
          <Field label="Fixed allowances — one per line, “Name: amount”" className="sm:col-span-2"><textarea name="allowances" rows={3} className="input font-mono text-xs" placeholder={"Travel: 2000\nPhone: 500"} /></Field>
          <Field label="Approved recurring deductions — “Name: amount”" className="sm:col-span-2"><textarea name="deductions" rows={3} className="input font-mono text-xs" placeholder={"Advance recovery: 1000"} /></Field>
          <p className="text-xs text-muted sm:col-span-2 lg:col-span-4">Statutory items (PF, ESI, Professional Tax, TDS) are not calculated automatically. Add them here as approved deductions only after your CA / payroll professional confirms the amounts. You can&apos;t edit your own structure.</p>
          <div><button className="btn-primary">Save structure</button></div>
        </form>
      </Card>

      <h2 className="eyebrow mb-3 mt-8">Incentive policies — configurable, the defaults are an example only</h2>
      <div className="grid gap-6 lg:grid-cols-2">{[...(policies ?? []), blankPolicy].map((p: any) => {
        const slabs = [...(p.slabs ?? [])].sort((a: any, b: any) => b.min - a.min);
        return (
          <Card key={p.id || "new"} title={p.name}>
            <form action={saveIncentivePolicy} className="space-y-3">
              <input type="hidden" name="id" value={p.id} />
              <Field label="Name"><input name="name" defaultValue={p.name} className="input" /></Field>
              <table className="table"><thead><tr><th>Score at least</th><th>Pays % of target</th></tr></thead><tbody>
                {Array.from({ length: 6 }, (_, i) => <tr key={i}>
                  <td><input name={`min_${i}`} type="number" min="0" max="100" defaultValue={slabs[i]?.min ?? ""} className="input py-1" /></td>
                  <td><input name={`pct_${i}`} type="number" min="0" max="200" defaultValue={slabs[i]?.pct ?? ""} className="input py-1" /></td></tr>)}
              </tbody></table>
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Cap per month (₹, optional)"><input name="cap_amount" type="number" min="0" defaultValue={p.cap_amount ?? ""} className="input w-40" /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="prorate" defaultChecked={p.prorate} /> Prorate for partial months</label>
              </div>
              <p className="text-xs text-muted">Scores below the lowest slab earn no incentive. Incentives are only paid from approved performance snapshots.</p>
              <button className="btn-ghost">Save policy</button>
            </form>
          </Card>);
      })}</div>
    </>
  );
}
