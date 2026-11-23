import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm, can } from "@/lib/auth";
import { confirmRazorpayPayout } from "../../statutory-actions";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Field, Flash, PageHeader, Stat, TableWrap, inr } from "@/components/ui";
import { fmtDate, localDate } from "@/lib/engines/time";
import { addAdjustment, calculateRun, markPaid, transitionRun } from "../../actions";

export const metadata = { title: "Payroll run" };

export default async function Run({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requirePerm("payroll.view_all", "payroll.approve");
  const sb = await supabaseServer();
  const { data: run } = await sb.from("payroll_runs").select("*").eq("id", id).maybeSingle();
  if (!run) notFound();
  const [{ data: entries }, { data: adjs }, { data: emps }] = await Promise.all([
    sb
      .from("payroll_entries")
      .select("*, employee:employees!payroll_entries_employee_id_fkey(full_name, employee_code)")
      .eq("run_id", id)
      .order("created_at"),
    sb.from("payroll_adjustments").select("id, employee_id, kind, label, amount, reason").eq("run_id", id),
    sb.from("employees").select("id, full_name").neq("status", "EXITED").neq("id", ctx.employee_id).order("full_name"),
  ]);
  await sb.rpc("log_salary_access", { p_entity: "payroll_run", p_entity_id: id, p_subject: null, p_purpose: "run detail" });
  const unpaid = new Map(
    (entries ?? [])
      .filter((e) => e.payment_status !== "PAID")
      .map((e) => [e.id, (e.employee as { full_name: string } | null)?.full_name ?? ""]),
  );
  const { data: rzp } = unpaid.size
    ? await sb
        .from("inbound_webhook_events")
        .select("id, external_id, payload, match_id")
        .eq("provider", "RAZORPAY")
        .eq("match_kind", "PAYROLL_ENTRY")
        .in("match_id", [...unpaid.keys()])
    : { data: [] };
  const payouts = (rzp ?? []).map((ev) => {
    const ent = (ev.payload as { payload?: { payout?: { entity?: { id?: string; utr?: string; amount?: number } } } })?.payload?.payout
      ?.entity;
    return {
      id: ev.id,
      who: unpaid.get(ev.match_id!) ?? "",
      ref: ent?.utr || ent?.id || ev.external_id,
      amount: ent?.amount != null ? inr(ent.amount / 100) : "—",
    };
  });
  const total = (k: string) => (entries ?? []).reduce((a, e: any) => a + Number(e[k]), 0);
  const draft = run.status === "DRAFT";
  const Btn = ({ to, label, tone = "btn-ghost", note }: { to: string; label: string; tone?: string; note?: boolean }) => (
    <form action={transitionRun} className="flex gap-2">
      <input type="hidden" name="run_id" value={id} />
      <input type="hidden" name="to" value={to} />
      {note && <input name="note" className="input w-56" placeholder="Note (required to reject)" />}
      <button className={tone}>{label}</button>
    </form>
  );
  const selfInRun = (entries ?? []).some((e) => e.employee_id === ctx.employee_id);

  return (
    <>
      <PageHeader eyebrow={`Payroll run · ${run.status}`} title={`${fmtDate(run.period_start)} – ${fmtDate(run.period_end)}`}>
        {can(ctx, "payroll.manage") && ["APPROVED", "PROCESSED"].includes(run.status) && (
          <a className="btn-primary" href={`/api/payroll/runs/${id}/bank-file`}>
            Bank transfer file
          </a>
        )}
        {can(ctx, "payroll.manage") && (
          <a className="btn-ghost" href="/payroll/statutory">
            Statutory
          </a>
        )}
        {can(ctx, "payroll.export") && (
          <>
            {(["csv", "xlsx", "pdf"] as const).map((format) => (
              <a key={format} className="btn-ghost" href={`/api/reports/payroll?run=${id}&format=${format}`}>
                {format.toUpperCase()}
              </a>
            ))}
          </>
        )}
      </PageHeader>
      <Flash sp={sp} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Employees" value={entries?.length ?? 0} />
        <Stat label="Gross" value={inr(total("gross_amount"))} />
        <Stat label="Deductions" value={inr(total("deductions_amount"))} />
        <Stat label="Net payable" value={inr(total("net_amount"))} tone="volt" />
      </div>

      {!!payouts?.length && (
        <Card
          title="RazorpayX payouts to confirm"
          className="mt-6"
          hint="Matched automatically by the Razorpay webhook. Nothing is marked paid until you confirm."
        >
          <ul className="divide-y divide-line text-sm">
            {payouts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {p.who} · <span className="font-mono text-xs">{p.ref}</span> · {p.amount}
                </span>
                {can(ctx, "payroll.pay") && run.status === "PROCESSED" ? (
                  <form action={confirmRazorpayPayout}>
                    <input type="hidden" name="run_id" value={id} />
                    <input type="hidden" name="event_id" value={p.id} />
                    <button className="btn-ghost text-xs">Confirm paid</button>
                  </form>
                ) : (
                  <span className="text-xs text-muted">Run must be PROCESSED · needs payroll.pay</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Workflow" className="mt-6">
        <div className="flex flex-wrap items-center gap-2">
          {draft && can(ctx, "payroll.manage") && (
            <>
              <form action={calculateRun}>
                <input type="hidden" name="run_id" value={id} />
                <button className="btn-primary">{entries?.length ? "Recalculate" : "Calculate entries"}</button>
              </form>
              {!!entries?.length && <Btn to="REVIEW" label="Submit for approval" />}
            </>
          )}
          {run.status === "REVIEW" && can(ctx, "payroll.manage") && <Btn to="DRAFT" label="Back to draft" />}
          {run.status === "REVIEW" &&
            can(ctx, "payroll.approve") &&
            !selfInRun &&
            ![run.created_by, run.submitted_by].includes(ctx.employee_id) && (
              <>
                <Btn to="APPROVED" label="Approve payroll" tone="btn-primary" />
                <Btn to="REJECTED" label="Reject" tone="btn-danger" note />
              </>
            )}
          {run.status === "REVIEW" &&
            (selfInRun || [run.created_by, run.submitted_by].includes(ctx.employee_id)) &&
            can(ctx, "payroll.approve") && (
              <p className="text-sm text-ember">You prepared this run or are paid in it, so another approver must approve it.</p>
            )}
          {run.status === "APPROVED" && can(ctx, "payroll.pay") && (
            <Btn to="PROCESSED" label="Mark processed (sent to bank)" tone="btn-primary" />
          )}
          {!["PROCESSED", "PAID", "CANCELLED"].includes(run.status) && can(ctx, "payroll.manage") && (
            <Btn to="CANCELLED" label="Cancel run" tone="btn-danger" />
          )}
        </div>
        {run.rejection_note && <p className="mt-3 text-sm text-danger">Rejected: {run.rejection_note}</p>}
        <p className="mt-3 text-xs text-muted">
          Approval is separated from preparation, and nobody can approve a run that includes their own salary. Approving locks all entries
          and notifies employees (emails contain a link only, no amounts).
        </p>
      </Card>

      <Card title="Entries & calculation breakdown" className="mt-6">
        {!entries?.length ? (
          <Empty title="No entries yet" hint={draft ? "Run the calculation to load eligible employees." : undefined} />
        ) : (
          <div className="space-y-3">
            {entries.map((e: any) => (
              <details key={e.id} className="rounded-xl border border-line p-4">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">
                    {e.employee?.full_name} <span className="font-mono text-[10px] text-muted">{e.employee?.employee_code}</span>
                  </span>
                  <span className="flex items-center gap-3 text-sm tabular-nums">
                    <span className="text-muted">
                      {e.payable_days}/{e.period_days} days
                    </span>
                    <span>Gross {inr(e.gross_amount)}</span>
                    <b>Net {inr(e.net_amount)}</b>
                    <Badge>{e.payment_status}</Badge>
                  </span>
                </summary>
                <TableWrap>
                  <table className="table mt-3 min-w-[520px]">
                    <tbody>
                      {(e.breakdown?.lines ?? []).map((l: any, i: number) => (
                        <tr key={i}>
                          <td>{l.label}</td>
                          <td className={l.kind === "DEDUCTION" ? "tabular-nums text-danger" : "tabular-nums"}>
                            {l.kind === "INFO" ? "" : (l.kind === "DEDUCTION" ? "− " : "") + inr(l.amount)}
                          </td>
                          <td className="text-xs text-muted">{l.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
                {(e.breakdown?.warnings ?? []).map((w: string) => (
                  <p key={w} className="mt-2 text-xs text-ember">
                    ⚠ {w}
                  </p>
                ))}
                {e.payment_status === "PAID" ? (
                  <p className="mt-3 text-xs text-volt">
                    Paid {e.paid_on} · {e.payment_method} · ref {e.payment_reference}
                  </p>
                ) : (
                  run.status === "PROCESSED" &&
                  can(ctx, "payroll.pay") &&
                  e.employee_id !== ctx.employee_id && (
                    <form action={markPaid} className="mt-3 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="run_id" value={id} />
                      <input type="hidden" name="entry_id" value={e.id} />
                      <Field label="UTR / reference">
                        <input name="reference" required minLength={4} className="input" />
                      </Field>
                      <Field label="Method">
                        <select name="method" className="input">
                          <option>BANK_TRANSFER</option>
                          <option>UPI</option>
                          <option>CHEQUE</option>
                          <option>CASH</option>
                        </select>
                      </Field>
                      <Field label="Paid on">
                        <input type="date" name="paid_on" defaultValue={localDate(new Date(), ctx.timezone)} className="input" required />
                      </Field>
                      <button className="btn-primary">Record payment</button>
                    </form>
                  )
                )}
              </details>
            ))}
          </div>
        )}
      </Card>

      {draft && can(ctx, "payroll.manage") && (
        <Card title="One-off adjustments" className="mt-6">
          {!!adjs?.length && (
            <ul className="mb-4 divide-y divide-line text-sm">
              {adjs.map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    {emps?.find((x) => x.id === a.employee_id)?.full_name} · {a.kind.toLowerCase()} · {a.label}
                  </span>
                  <span className="tabular-nums">
                    {inr(a.amount)} <span className="text-xs text-muted">({a.reason})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form action={addAdjustment} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <input type="hidden" name="run_id" value={id} />
            <Field label="Employee" className="lg:col-span-2">
              <select name="employee_id" className="input">
                {(emps ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Kind">
              <select name="kind" className="input">
                <option>BONUS</option>
                <option>REIMBURSEMENT</option>
                <option>DEDUCTION</option>
              </select>
            </Field>
            <Field label="Label">
              <input name="label" className="input" placeholder="Diwali bonus" />
            </Field>
            <Field label="Amount (₹)">
              <input name="amount" type="number" min="1" step="0.01" className="input" required />
            </Field>
            <Field label="Reason">
              <input name="reason" minLength={5} className="input" required />
            </Field>
            <div>
              <button className="btn-ghost">Add</button>
            </div>
          </form>
        </Card>
      )}
      <p className="mt-6 text-xs text-muted">
        <Link href="/payroll" className="hover:text-ink">
          ← All runs
        </Link>
      </p>
    </>
  );
}
