import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Field, Flash, PageHeader } from "@/components/ui";
import { DEFAULT_STATUTORY } from "@/lib/engines/statutory";
import { saveEmployeeStatutory, saveStatutorySettings } from "../statutory-actions";

export const metadata = { title: "Statutory · Payroll" };
const mask = (v: string | null | undefined, keep = 4) => (v ? `${"•".repeat(Math.max(0, v.length - keep))}${v.slice(-keep)}` : "—");

export default async function Statutory({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePerm("payroll.manage");
  const sb = await supabaseServer();
  const [{ data: s }, { data: emps }, { data: det }] = await Promise.all([
    sb.from("payroll_statutory_settings").select("*").eq("org_id", ctx.org_id).maybeSingle(),
    sb.from("employees").select("id, full_name, employee_code").neq("status", "EXITED").neq("id", ctx.employee_id).order("full_name"),
    sb.from("employee_statutory").select("*"),
  ]);
  const v = { ...DEFAULT_STATUTORY, ...(s ?? {}) } as Record<string, unknown>;
  const by = new Map((det ?? []).map((d) => [d.employee_id, d]));
  const fy = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const pt = Array.isArray(v.pt_slabs)
    ? (v.pt_slabs as { upto: number | null; amount: number }[]).map((x) => `${x.upto ?? "*"}=${x.amount}`).join(", ")
    : "";
  const num = (k: string, label: string, step = "0.01") => (
    <Field label={label}>
      <input name={k} type="number" step={step} min={0} defaultValue={String(v[k] ?? "")} className="input" />
    </Field>
  );
  const chk = (k: string, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={k} defaultChecked={!!v[k]} /> {label}
    </label>
  );
  const active = sp.emp;
  return (
    <>
      <PageHeader eyebrow="Payroll · India" title="Statutory & bank details">
        <Link href="/payroll" className="btn-ghost">
          ← Payroll
        </Link>
        <a href={`/api/payroll/form16?fy=${fy}`} className="btn-ghost">
          Form 16 data FY {fy}-{String(fy + 1).slice(2)}
        </a>
        <a href={`/api/payroll/form16?fy=${fy - 1}`} className="btn-ghost">
          FY {fy - 1}-{String(fy).slice(2)}
        </a>
      </PageHeader>
      <Flash sp={sp} />
      <p className="mb-6 max-w-3xl text-sm text-muted">
        Defaults follow the rules in force in November 2026: EPF wage ceiling ₹25,000 (from 17 Sep 2026), ESI up to ₹21,000 gross at 0.75% /
        3.25%, new tax regime FY 2026-27 with ₹75,000 standard deduction and nil tax up to ₹12 lakh taxable. Uttar Pradesh has no
        professional tax. Have your CA confirm before the first live run — every number here is editable.
      </p>
      <Card title="Company rules">
        <form action={saveStatutorySettings} className="grid gap-6 lg:grid-cols-4">
          <fieldset className="space-y-2">
            <legend className="eyebrow mb-1">Provident Fund</legend>
            {chk("pf_enabled", "Deduct PF")}
            {chk("pf_restrict_to_ceiling", "Cap PF wages at the ceiling")}
            {num("pf_employee_rate", "Employee %")}
            {num("pf_employer_rate", "Employer %")}
            {num("pf_wage_ceiling", "Wage ceiling ₹/month", "1")}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="eyebrow mb-1">ESI</legend>
            {chk("esi_enabled", "Deduct ESI")}
            {num("esi_employee_rate", "Employee %")}
            {num("esi_employer_rate", "Employer %")}
            {num("esi_wage_limit", "Gross limit ₹/month", "1")}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="eyebrow mb-1">Income tax (TDS)</legend>
            {chk("tds_enabled", "Deduct TDS (new regime)")}
            {num("standard_deduction", "Standard deduction ₹", "1")}
            {num("rebate_limit", "87A rebate up to ₹ taxable", "1")}
            {num("cess_rate", "Cess %")}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="eyebrow mb-1">Professional tax</legend>
            {chk("pt_enabled", "Deduct PT")}
            <Field label="State">
              <input name="pt_state" defaultValue={String(v.pt_state ?? "UP")} className="input" />
            </Field>
            <Field label="Slabs (gross upto=₹)">
              <input name="pt_slabs" defaultValue={pt} placeholder="10000=0, 15000=150, *=200" className="input" />
            </Field>
          </fieldset>
          <div className="lg:col-span-4">
            <button className="btn-primary">Save rules</button>
          </div>
        </form>
      </Card>

      <Card
        title="Employees"
        className="mt-6"
        hint="PAN, UAN, ESIC and bank details. Stored numbers are never shown in full — leave a field blank to keep it."
      >
        <div className="divide-y divide-line">
          {(emps ?? []).map((e) => {
            const d = by.get(e.id);
            const complete = !!(d?.pan && d?.bank_account_no && d?.bank_ifsc);
            return (
              <details key={e.id} open={active === e.id} className="py-2">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    <b>{e.full_name}</b> <span className="font-mono text-xs text-muted">{e.employee_code}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    PAN {mask(d?.pan, 3)} · A/c {mask(d?.bank_account_no)} · {d?.tax_regime ?? "NEW"}
                    <Badge tone={complete ? "green" : "amber"}>{complete ? "READY" : "MISSING"}</Badge>
                  </span>
                </summary>
                <form action={saveEmployeeStatutory} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <input type="hidden" name="employee_id" value={e.id} />
                  <Field label={`PAN ${d?.pan ? `(${mask(d.pan, 3)})` : ""}`}>
                    <input name="pan" className="input uppercase" placeholder="ABCDE1234F" autoComplete="off" />
                  </Field>
                  <Field label={`UAN ${d?.uan ? `(${mask(d.uan)})` : ""}`}>
                    <input name="uan" inputMode="numeric" className="input" autoComplete="off" />
                  </Field>
                  <Field label={`ESIC IP no. ${d?.esic_ip ? `(${mask(d.esic_ip)})` : ""}`}>
                    <input name="esic_ip" inputMode="numeric" className="input" autoComplete="off" />
                  </Field>
                  <Field label="Tax regime">
                    <select name="tax_regime" defaultValue={d?.tax_regime ?? "NEW"} className="input">
                      <option value="NEW">New (default)</option>
                      <option value="OLD">Old (set TDS manually)</option>
                    </select>
                  </Field>
                  <Field label="Account holder">
                    <input name="bank_account_holder" defaultValue={d?.bank_account_holder ?? ""} className="input" />
                  </Field>
                  <Field label={`Account no. ${d?.bank_account_no ? `(${mask(d.bank_account_no)})` : ""}`}>
                    <input name="bank_account_no" inputMode="numeric" className="input" autoComplete="off" />
                  </Field>
                  <Field label={`IFSC ${d?.bank_ifsc ? `(${d.bank_ifsc})` : ""}`}>
                    <input name="bank_ifsc" className="input uppercase" placeholder="HDFC0001234" autoComplete="off" />
                  </Field>
                  <Field label="Bank">
                    <input name="bank_name" defaultValue={d?.bank_name ?? ""} className="input" />
                  </Field>
                  <Field label="Monthly TDS override ₹ (blank = calculate)">
                    <input
                      name="tds_monthly_override"
                      type="number"
                      min={0}
                      step="1"
                      defaultValue={d?.tds_monthly_override ?? ""}
                      className="input"
                    />
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="pf_opted_out" defaultChecked={!!d?.pf_opted_out} /> PF opted out
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="esi_exempt" defaultChecked={!!d?.esi_exempt} /> ESI exempt
                  </label>
                  <div className="flex items-end">
                    <button className="btn-primary">Save</button>
                  </div>
                </form>
              </details>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted">
          Your own details must be entered by another payroll admin. Every change is audited (numbers are never written to the log).
        </p>
      </Card>
    </>
  );
}
