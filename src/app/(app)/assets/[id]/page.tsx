import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { LiveSync } from "@/components/live-sync";
import { Badge, Card, Empty, Field, Flash, PageHeader, TableWrap, inr } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/engines/time";
import { ASSET_CATEGORIES, ASSET_CONDITIONS, RETURN_CONDITIONS, bookValue, categoryLabel, warrantyState } from "@/lib/engines/assets";
import { issueAsset, logMaintenance, reportAssetIssue, returnAsset, setStockStatus, updateAsset, updateMaintenance } from "../actions";

export const metadata = { title: "Asset" };

export default async function AssetDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireContext();
  const manage = can(ctx, "assets.manage");
  const sb = await supabaseServer();

  const { data: a } = await sb
    .from("assets")
    .select("*, holder:employees!current_holder_id(id, full_name, employee_code, designation)")
    .eq("id", id)
    .maybeSingle();
  if (!a) notFound(); // RLS: not visible to this person

  const [{ data: fin }, { data: history }, { data: tickets }, { data: people }] = await Promise.all([
    sb.from("asset_financials").select("*").eq("asset_id", id).maybeSingle(),
    sb
      .from("asset_assignments")
      .select(
        "*, employee:employees!employee_id(id, full_name), giver:employees!issued_by(full_name), taker:employees!returned_to(full_name)",
      )
      .eq("asset_id", id)
      .order("issued_at", { ascending: false }),
    sb
      .from("asset_maintenance")
      .select("*, reporter:employees!reported_by(full_name)")
      .eq("asset_id", id)
      .order("opened_at", { ascending: false }),
    manage && a.status === "IN_STOCK"
      ? sb.from("employees").select("id, full_name, employee_code").neq("status", "EXITED").order("full_name")
      : Promise.resolve({ data: [] as { id: string; full_name: string; employee_code: string | null }[] }),
  ]);

  const openRow = (history ?? []).find((h: any) => !h.returned_at);
  const w = warrantyState(a.warranty_until);
  const bv = fin ? bookValue(fin.purchase_cost, fin.purchase_date, fin.useful_life_months) : null;
  const here = `/assets/${id}`;
  const isHolder = a.current_holder_id === ctx.employee_id;

  return (
    <>
      <LiveSync tables={["assets", "asset_assignments"]} />
      <PageHeader eyebrow={`Assets · ${categoryLabel(a.category)}`} title={`${a.asset_tag} · ${a.name}`}>
        <Badge>{a.status}</Badge>
        {manage && (
          <Link href="/assets" className="btn-ghost">
            All assets
          </Link>
        )}
      </PageHeader>
      <Flash sp={sp} />

      <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
        <div className="space-y-6">
          <Card title="Details">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              {[
                ["Brand", a.brand],
                ["Model", a.model],
                ["Serial no.", a.serial_no],
                ["IMEI / SIM / ref", a.identifier],
                ["Condition", a.condition],
                ["Location", a.location],
                [
                  "Warranty",
                  a.warranty_until
                    ? `${fmtDate(a.warranty_until)}${w === "EXPIRED" ? " (expired)" : w === "EXPIRING" ? " (soon)" : ""}`
                    : null,
                ],
                ["Added", fmtDate(a.created_at.slice(0, 10))],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd>{v || "—"}</dd>
                </div>
              ))}
            </dl>
            {a.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-muted">{a.notes}</p>}
          </Card>

          <Card title="Currently with">
            {a.holder ? (
              <div className="text-sm">
                <Link href={`/people/${a.holder.id}`} className="font-medium underline">
                  {a.holder.full_name}
                </Link>{" "}
                <span className="text-muted">
                  {a.holder.employee_code} · {a.holder.designation ?? ""}
                </span>
                <p className="mt-1 text-xs text-muted">
                  Since {a.issued_at ? fmtDateTime(a.issued_at, ctx.timezone) : "—"}
                  {openRow?.expected_return ? ` · due back ${fmtDate(openRow.expected_return)}` : ""} ·{" "}
                  {openRow?.acknowledged_at
                    ? `receipt confirmed ${fmtDateTime(openRow.acknowledged_at, ctx.timezone)}`
                    : "receipt not confirmed yet"}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted">
                Nobody — {a.status === "IN_STOCK" ? "in stock" : a.status.toLowerCase().replace("_", " ")}.
              </p>
            )}

            {manage && a.status === "IN_STOCK" && (
              <form action={issueAsset} className="mt-4 grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="id" value={id} />
                <Field label="Issue to *">
                  <select name="employee_id" required className="input" defaultValue="">
                    <option value="" disabled>
                      Choose a person
                    </option>
                    {(people ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name} {p.employee_code ? `(${p.employee_code})` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Condition handed over">
                  <select name="condition" className="input" defaultValue={a.condition}>
                    {ASSET_CONDITIONS.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Return by (optional)">
                  <input name="expected_return" type="date" className="input" />
                </Field>
                <Field label="Note">
                  <input name="note" maxLength={1000} className="input" placeholder="Charger + bag included" />
                </Field>
                <div className="sm:col-span-2">
                  <button className="btn-primary">Issue</button>
                </div>
              </form>
            )}

            {manage && a.current_holder_id && (
              <form action={returnAsset} className="mt-4 grid gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-end">
                <input type="hidden" name="id" value={id} />
                <Field label="Came back">
                  <select name="condition" required className="input" defaultValue="">
                    <option value="" disabled>
                      Condition…
                    </option>
                    {RETURN_CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {c === "LOST" ? "Lost / not returned" : c}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Note (required if damaged or lost)">
                  <input name="note" maxLength={1000} className="input" />
                </Field>
                <button className="btn-ghost">Take back</button>
              </form>
            )}

            {manage && a.status === "IN_STOCK" && (
              <form action={setStockStatus} className="mt-4">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="status" value="RETIRED" />
                <button className="text-xs text-muted underline">Retire this asset (keeps its history)</button>
              </form>
            )}
            {manage && ["RETIRED", "LOST"].includes(a.status) && (
              <form action={setStockStatus} className="mt-4">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="status" value="IN_STOCK" />
                <button className="btn-ghost">{a.status === "LOST" ? "Found — back to stock" : "Bring back into stock"}</button>
              </form>
            )}
          </Card>

          <Card title="Repairs & servicing">
            {(isHolder || manage) && (
              <form action={reportAssetIssue} className="mb-4 flex flex-wrap gap-2">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="back" value={here} />
                <input
                  name="description"
                  required
                  minLength={3}
                  maxLength={2000}
                  className="input min-w-[220px] flex-1"
                  placeholder="Report a problem…"
                />
                <button className="btn-ghost">Report</button>
              </form>
            )}
            {!tickets?.length ? (
              <Empty title="No repairs logged" />
            ) : (
              <ul className="space-y-3">
                {tickets.map((m: any) => (
                  <li key={m.id} className="rounded-lg border border-line p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{m.kind}</Badge>
                      <Badge>{m.status}</Badge>
                      <span className="text-xs text-muted">
                        {fmtDateTime(m.opened_at, ctx.timezone)} · {m.reporter?.full_name ?? "—"}
                      </span>
                    </div>
                    <p className="mt-1">{m.description}</p>
                    {(m.resolution || m.cost != null || m.vendor || m.next_due) && (
                      <p className="mt-1 text-xs text-muted">
                        {[
                          m.resolution,
                          m.vendor,
                          m.cost != null && manage ? inr(m.cost) : null,
                          m.next_due && `next due ${fmtDate(m.next_due)}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                    {manage && ["OPEN", "IN_PROGRESS"].includes(m.status) && (
                      <form action={updateMaintenance} className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
                        <input type="hidden" name="maintenance_id" value={m.id} />
                        <input type="hidden" name="back" value={here} />
                        <input name="resolution" maxLength={2000} className="input" placeholder="What was done" />
                        <input name="vendor" maxLength={120} className="input w-32" placeholder="Vendor" />
                        <input name="cost" type="number" min="0" step="0.01" className="input w-28" placeholder="Cost ₹" />
                        <select name="status" className="input w-auto" defaultValue="DONE">
                          {m.status === "OPEN" && <option value="IN_PROGRESS">Sent for repair</option>}
                          <option value="DONE">Done</option>
                          <option value="CANCELLED">Cancel</option>
                        </select>
                        <button className="btn-ghost sm:col-span-4 sm:justify-self-start">Update</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {manage && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-muted">Log planned work (service, inspection, upgrade)</summary>
                <form action={logMaintenance} className="mt-3 grid gap-2 sm:grid-cols-2">
                  <input type="hidden" name="id" value={id} />
                  <Field label="Type">
                    <select name="kind" className="input" defaultValue="SERVICE">
                      <option value="SERVICE">Service</option>
                      <option value="INSPECTION">Inspection</option>
                      <option value="UPGRADE">Upgrade</option>
                      <option value="REPAIR">Repair</option>
                    </select>
                  </Field>
                  <Field label="Vendor">
                    <input name="vendor" maxLength={120} className="input" />
                  </Field>
                  <Field label="What *" className="sm:col-span-2">
                    <input name="description" required minLength={3} maxLength={2000} className="input" placeholder="Sensor cleaning" />
                  </Field>
                  <Field label="Next due">
                    <input name="next_due" type="date" className="input" />
                  </Field>
                  <div className="self-end">
                    <button className="btn-ghost">Log</button>
                  </div>
                </form>
              </details>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {fin && (
            <Card title="Purchase & value" hint="Straight-line estimate for management use — not the tax depreciation block.">
              {
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  {[
                    ["Purchased", fin.purchase_date ? fmtDate(fin.purchase_date) : null],
                    ["Cost", fin.purchase_cost != null ? inr(fin.purchase_cost) : null],
                    ["Vendor", fin.vendor],
                    ["Invoice", fin.invoice_ref],
                    ["Useful life", `${fin.useful_life_months} months`],
                    ["Book value today", bv != null ? inr(bv) : null],
                  ].map(([k, v]) => (
                    <div key={k as string}>
                      <dt className="text-xs text-muted">{k}</dt>
                      <dd>{v || "—"}</dd>
                    </div>
                  ))}
                </dl>
              }
            </Card>
          )}

          {manage && (
            <Card title="Edit">
              <form action={updateAsset} className="grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="id" value={id} />
                <Field label="Name *">
                  <input name="name" required defaultValue={a.name} maxLength={120} className="input" />
                </Field>
                <Field label="Category">
                  <select name="category" defaultValue={a.category} className="input">
                    {ASSET_CATEGORIES.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Tag">
                  <input name="asset_tag" defaultValue={a.asset_tag} maxLength={31} className="input uppercase" />
                </Field>
                <Field label="Condition">
                  <select name="condition" defaultValue={a.condition} className="input">
                    {ASSET_CONDITIONS.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Brand">
                  <input name="brand" defaultValue={a.brand ?? ""} maxLength={80} className="input" />
                </Field>
                <Field label="Model">
                  <input name="model" defaultValue={a.model ?? ""} maxLength={120} className="input" />
                </Field>
                <Field label="Serial no.">
                  <input name="serial_no" defaultValue={a.serial_no ?? ""} maxLength={120} className="input" />
                </Field>
                <Field label="IMEI / SIM / ref">
                  <input name="identifier" defaultValue={a.identifier ?? ""} maxLength={120} className="input" />
                </Field>
                <Field label="Location">
                  <input name="location" defaultValue={a.location ?? ""} maxLength={120} className="input" />
                </Field>
                <Field label="Warranty until">
                  <input name="warranty_until" type="date" defaultValue={a.warranty_until ?? ""} className="input" />
                </Field>
                <Field label="Purchase date">
                  <input name="purchase_date" type="date" defaultValue={fin?.purchase_date ?? ""} className="input" />
                </Field>
                <Field label="Cost (₹)">
                  <input name="purchase_cost" type="number" min="0" step="0.01" defaultValue={fin?.purchase_cost ?? ""} className="input" />
                </Field>
                <Field label="Vendor">
                  <input name="vendor" defaultValue={fin?.vendor ?? ""} maxLength={120} className="input" />
                </Field>
                <Field label="Invoice no.">
                  <input name="invoice_ref" defaultValue={fin?.invoice_ref ?? ""} maxLength={80} className="input" />
                </Field>
                <Field label="Useful life (months)">
                  <input
                    name="useful_life_months"
                    type="number"
                    min="1"
                    max="240"
                    defaultValue={fin?.useful_life_months ?? 36}
                    className="input"
                  />
                </Field>
                <Field label="Notes" className="sm:col-span-2">
                  <textarea name="notes" rows={2} defaultValue={a.notes ?? ""} maxLength={2000} className="input" />
                </Field>
                <div className="sm:col-span-2">
                  <button className="btn-primary">Save</button>
                </div>
              </form>
            </Card>
          )}

          <Card title="Issue history">
            {!history?.length ? (
              <Empty title="Never issued" />
            ) : (
              <TableWrap>
                <table className="table min-w-[520px]">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Out</th>
                      <th>Back</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h: any) => (
                      <tr key={h.id}>
                        <td>
                          <Link href={`/people/${h.employee?.id}`}>{h.employee?.full_name ?? "—"}</Link>
                          {h.issue_note && <p className="text-xs text-muted">{h.issue_note}</p>}
                        </td>
                        <td className="text-xs">
                          {fmtDateTime(h.issued_at, ctx.timezone)} · {h.condition_out}
                          {h.giver?.full_name ? ` · by ${h.giver.full_name}` : ""}
                          {h.acknowledged_at ? " · ✓ confirmed" : ""}
                        </td>
                        <td className="text-xs">
                          {h.returned_at ? (
                            <>
                              {fmtDateTime(h.returned_at, ctx.timezone)} · <Badge>{h.condition_in}</Badge>
                              {h.taker?.full_name ? ` · to ${h.taker.full_name}` : ""}
                              {h.return_note && <p className="text-muted">{h.return_note}</p>}
                            </>
                          ) : (
                            <Badge tone="blue">WITH THEM</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
