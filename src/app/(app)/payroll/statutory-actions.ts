"use server";
import { z } from "zod";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, str } from "@/lib/actions";

const BACK = "/payroll/statutory";
const n = (fd: FormData, k: string) => Number(str(fd, k));

export async function saveStatutorySettings(fd: FormData) {
  const ctx = await requirePerm("payroll.manage");
  const nums = {
    pf_employee_rate: n(fd, "pf_employee_rate"),
    pf_employer_rate: n(fd, "pf_employer_rate"),
    pf_wage_ceiling: n(fd, "pf_wage_ceiling"),
    esi_employee_rate: n(fd, "esi_employee_rate"),
    esi_employer_rate: n(fd, "esi_employer_rate"),
    esi_wage_limit: n(fd, "esi_wage_limit"),
    standard_deduction: n(fd, "standard_deduction"),
    rebate_limit: n(fd, "rebate_limit"),
    cess_rate: n(fd, "cess_rate"),
  };
  if (Object.values(nums).some((v) => !Number.isFinite(v) || v < 0)) flash(BACK, "err", "All amounts and rates must be numbers ≥ 0.");
  let ptSlabs: unknown = [];
  const ptRaw = str(fd, "pt_slabs").trim();
  if (ptRaw) {
    // "10000=0, 15000=150, *=200"  → upto amount pairs; * = no upper limit
    try {
      ptSlabs = ptRaw
        .split(/[,\n]/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
          const [u, a] = p.split("=").map((x) => x.trim());
          const amount = Number(a);
          if (!Number.isFinite(amount) || amount < 0) throw new Error();
          return { upto: u === "*" ? null : Number(u), amount };
        });
    } catch {
      flash(BACK, "err", "Professional tax slabs: use the form 10000=0, 15000=150, *=200");
    }
  }
  const sb = await supabaseServer();
  const { error } = await sb.from("payroll_statutory_settings").upsert({
    org_id: ctx.org_id,
    ...nums,
    pt_slabs: ptSlabs,
    pt_state: str(fd, "pt_state") || "UP",
    pf_enabled: fd.get("pf_enabled") === "on",
    pf_restrict_to_ceiling: fd.get("pf_restrict_to_ceiling") === "on",
    esi_enabled: fd.get("esi_enabled") === "on",
    pt_enabled: fd.get("pt_enabled") === "on",
    tds_enabled: fd.get("tds_enabled") === "on",
    updated_by: ctx.employee_id,
    updated_at: new Date().toISOString(),
  });
  if (error) flash(BACK, "err", dbMessage(error));
  await sb.rpc("log_audit", {
    p_action: "payroll.statutory_settings_saved",
    p_entity: "organization",
    p_entity_id: ctx.org_id,
    p_metadata: nums,
  });
  flash(BACK, "ok", "Statutory settings saved. Recalculate draft runs to apply them.");
}

const Details = z.object({
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN looks wrong (ABCDE1234F)")
    .or(z.literal("")),
  uan: z
    .string()
    .trim()
    .regex(/^\d{12}$/, "UAN is 12 digits")
    .or(z.literal("")),
  esic_ip: z
    .string()
    .trim()
    .regex(/^\d{10}$/, "ESIC IP number is 10 digits")
    .or(z.literal("")),
  bank_account_no: z
    .string()
    .trim()
    .regex(/^\d{9,18}$/, "Account number: 9–18 digits")
    .or(z.literal("")),
  bank_ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC looks wrong (HDFC0001234)")
    .or(z.literal("")),
  bank_account_holder: z.string().trim().max(120),
  bank_name: z.string().trim().max(80),
  tax_regime: z.enum(["NEW", "OLD"]),
  tds_monthly_override: z.string().trim(),
});

/** Blank sensitive fields keep the stored value (they are never sent back to the browser in full). */
export async function saveEmployeeStatutory(fd: FormData) {
  const ctx = await requirePerm("payroll.manage");
  const employeeId = z.string().uuid().parse(str(fd, "employee_id"));
  const p = Details.safeParse(
    Object.fromEntries(
      [
        "pan",
        "uan",
        "esic_ip",
        "bank_account_no",
        "bank_ifsc",
        "bank_account_holder",
        "bank_name",
        "tax_regime",
        "tds_monthly_override",
      ].map((k) => [k, str(fd, k) || (k === "tax_regime" ? "NEW" : "")]),
    ),
  );
  if (!p.success) flash(`${BACK}?emp=${employeeId}`, "err", p.error.issues[0]?.message ?? "Check the form.");
  const keep = <T>(v: T) => (v === "" ? undefined : v);
  const tds = p.data.tds_monthly_override === "" ? null : Number(p.data.tds_monthly_override);
  if (tds !== null && (!Number.isFinite(tds) || tds < 0))
    flash(`${BACK}?emp=${employeeId}`, "err", "TDS override must be a number ≥ 0 (or blank).");
  const sb = await supabaseServer();
  const { error } = await sb.from("employee_statutory").upsert({
    employee_id: employeeId,
    org_id: ctx.org_id,
    pan: keep(p.data.pan),
    uan: keep(p.data.uan),
    esic_ip: keep(p.data.esic_ip),
    bank_account_no: keep(p.data.bank_account_no),
    bank_ifsc: keep(p.data.bank_ifsc),
    bank_account_holder: p.data.bank_account_holder || undefined,
    bank_name: p.data.bank_name || undefined,
    tax_regime: p.data.tax_regime,
    tds_monthly_override: tds,
    pf_opted_out: fd.get("pf_opted_out") === "on",
    esi_exempt: fd.get("esi_exempt") === "on",
    updated_by: ctx.employee_id,
    updated_at: new Date().toISOString(),
  });
  if (error) flash(`${BACK}?emp=${employeeId}`, "err", dbMessage(error));
  flash(BACK, "ok", "Statutory and bank details saved.");
}

/** RazorpayX payout matched by the webhook → a payroll admin confirms it here. The UTR becomes the payment reference. */
export async function confirmRazorpayPayout(fd: FormData) {
  await requirePerm("payroll.pay");
  const runId = str(fd, "run_id"),
    back = `/payroll/runs/${runId}`;
  const sb = await supabaseServer();
  const { data: ev } = await sb
    .from("inbound_webhook_events")
    .select("id, external_id, payload, match_id, received_at")
    .eq("id", str(fd, "event_id"))
    .eq("provider", "RAZORPAY")
    .eq("match_kind", "PAYROLL_ENTRY")
    .maybeSingle();
  if (!ev?.match_id) flash(back, "err", "That payout event isn't matched to a payroll entry.");
  const pay = (ev.payload as { payload?: { payout?: { entity?: { id?: string; utr?: string } } } })?.payload?.payout?.entity;
  const ref = pay?.utr || pay?.id || ev.external_id;
  const { error } = await sb.rpc("mark_entry_paid", {
    p_entry: ev.match_id,
    p_reference: ref,
    p_method: "BANK_TRANSFER",
    p_paid_on: String(ev.received_at).slice(0, 10),
  });
  if (error) flash(back, "err", dbMessage(error));
  flash(back, "ok", `Payment confirmed with reference ${ref}.`);
}
