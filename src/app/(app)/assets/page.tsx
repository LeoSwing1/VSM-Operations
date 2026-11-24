import Link from "next/link";
import { can, requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { LiveSync } from "@/components/live-sync";
import { Badge, Card, Empty, Field, Flash, PageHeader, Stat, TableWrap } from "@/components/ui";
import { fmtDate } from "@/lib/engines/time";
import { ASSET_CATEGORIES, ASSET_CONDITIONS, ASSET_STATUSES, categoryLabel, isOverdue, warrantyState } from "@/lib/engines/assets";
import { createAsset } from "./actions";

export const metadata = { title: "Assets & inventory" };

export default async function AssetsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePerm("assets.view", "assets.manage");
  const manage = can(ctx, "assets.manage");
  const sb = await supabaseServer();

  const status = ASSET_STATUSES.includes(sp.status as never) ? sp.status! : "";
  const category = ASSET_CATEGORIES.some((c) => c.key === sp.category) ? sp.category! : "";
  const q = (sp.q ?? "").trim().slice(0, 60);

  let query = sb
    .from("assets")
    .select(
      "id, asset_tag, name, category, brand, model, serial_no, status, condition, warranty_until, holder:employees!current_holder_id(id, full_name)",
    )
    .order("asset_tag");
  if (status) query = query.eq("status", status);
  if (category) query = query.eq("category", category);
  if (q) {
    const like = `%${q.replace(/[%_,()]/g, " ")}%`;
    query = query.or(
      `name.ilike.${like},asset_tag.ilike.${like},serial_no.ilike.${like},brand.ilike.${like},model.ilike.${like},identifier.ilike.${like}`,
    );
  }

  const [{ data: rows, error }, { data: all }, { data: open }, { data: tickets }] = await Promise.all([
    query.limit(500),
    sb.from("assets").select("status, warranty_until"),
    sb
      .from("asset_assignments")
      .select(
        "id, asset_id, expected_return, acknowledged_at, issued_at, employee:employees!employee_id(full_name), asset:assets!asset_id(asset_tag, name)",
      )
      .is("returned_at", null),
    sb.from("asset_maintenance").select("id").in("status", ["OPEN", "IN_PROGRESS"]),
  ]);

  const count = (s: string) => (all ?? []).filter((a) => a.status === s).length;
  const expiring = (all ?? []).filter((a) => a.status !== "RETIRED" && warrantyState(a.warranty_until) === "EXPIRING").length;
  const overdue = (open ?? []).filter((o) => isOverdue(o.expected_return));
  const unconfirmed = (open ?? []).filter((o) => !o.acknowledged_at && Date.now() - new Date(o.issued_at).getTime() > 2 * 86_400_000);
  const filterHref = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ ...(status && { status }), ...(category && { category }), ...(q && { q }), ...patch });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/assets${p.size ? `?${p}` : ""}`;
  };

  return (
    <>
      <LiveSync tables={["assets", "asset_assignments"]} />
      <PageHeader eyebrow="Organisation" title="Assets & inventory">
        {manage && (
          <Link href="/assets?add=1#add" className="btn-primary">
            Add asset
          </Link>
        )}
        <a href="/api/assets/export" className="btn-ghost">
          Download CSV
        </a>
      </PageHeader>
      <Flash sp={sp} />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Total" value={(all ?? []).length} href="/assets" />
        <Stat label="Issued" value={count("ISSUED")} href={filterHref({ status: "ISSUED" })} tone="signal" />
        <Stat label="In stock" value={count("IN_STOCK")} href={filterHref({ status: "IN_STOCK" })} tone="volt" />
        <Stat
          label="In repair"
          value={count("IN_REPAIR")}
          hint={`${tickets?.length ?? 0} open tickets`}
          href={filterHref({ status: "IN_REPAIR" })}
          tone="ember"
        />
        <Stat label="Overdue returns" value={overdue.length} tone={overdue.length ? "danger" : undefined} />
        <Stat label="Warranty ≤ 30 days" value={expiring} tone={expiring ? "ember" : undefined} />
      </div>

      {(overdue.length > 0 || unconfirmed.length > 0) && (
        <Card title="Needs attention" className="mb-6">
          <ul className="space-y-1 text-sm">
            {overdue.map((o: any) => (
              <li key={o.id}>
                <Link className="underline" href={`/assets/${o.asset_id}`}>
                  {o.asset?.asset_tag} {o.asset?.name}
                </Link>{" "}
                — due back from <b>{o.employee?.full_name}</b> on {fmtDate(o.expected_return)}
              </li>
            ))}
            {unconfirmed.map((o: any) => (
              <li key={o.id} className="text-muted">
                <Link className="underline" href={`/assets/${o.asset_id}`}>
                  {o.asset?.asset_tag} {o.asset?.name}
                </Link>{" "}
                — {o.employee?.full_name} hasn&apos;t confirmed receipt yet
              </li>
            ))}
          </ul>
        </Card>
      )}

      {manage && sp.add && (
        <Card
          title="Add asset"
          hint="Leave the tag empty to get the next AST number. Purchase details are visible only to asset managers and finance."
          className="mb-6"
        >
          <form id="add" action={createAsset} className="grid gap-3 md:grid-cols-3">
            <Field label="Name *">
              <input name="name" required minLength={2} maxLength={120} className="input" placeholder="MacBook Air M3 13in" />
            </Field>
            <Field label="Category *">
              <select name="category" className="input" defaultValue="LAPTOP">
                {ASSET_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tag">
              <input name="asset_tag" maxLength={31} className="input uppercase" placeholder="Auto" />
            </Field>
            <Field label="Brand">
              <input name="brand" maxLength={80} className="input" />
            </Field>
            <Field label="Model">
              <input name="model" maxLength={120} className="input" />
            </Field>
            <Field label="Serial number">
              <input name="serial_no" maxLength={120} className="input" />
            </Field>
            <Field label="IMEI / SIM no. / licence ref">
              <input name="identifier" maxLength={120} className="input" />
            </Field>
            <Field label="Condition">
              <select name="condition" className="input" defaultValue="NEW">
                {ASSET_CONDITIONS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Location">
              <input name="location" maxLength={120} className="input" placeholder="Meerut office" />
            </Field>
            <Field label="Warranty until">
              <input name="warranty_until" type="date" className="input" />
            </Field>
            <Field label="Purchase date">
              <input name="purchase_date" type="date" className="input" />
            </Field>
            <Field label="Cost (₹, incl. GST)">
              <input name="purchase_cost" type="number" min="0" step="0.01" className="input" />
            </Field>
            <Field label="Vendor">
              <input name="vendor" maxLength={120} className="input" />
            </Field>
            <Field label="Invoice no.">
              <input name="invoice_ref" maxLength={80} className="input" />
            </Field>
            <Field label="Useful life (months)">
              <input name="useful_life_months" type="number" min="1" max="240" defaultValue={36} className="input" />
            </Field>
            <Field label="Notes" className="md:col-span-3">
              <textarea name="notes" rows={2} maxLength={2000} className="input" />
            </Field>
            <div className="flex gap-2 md:col-span-3">
              <button className="btn-primary">Save asset</button>
              <Link href="/assets" className="btn-ghost">
                Cancel
              </Link>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <form className="mb-4 flex flex-wrap gap-2" action="/assets">
          <input name="q" defaultValue={q} className="input min-w-[200px] flex-1" placeholder="Search name, tag, serial, IMEI…" />
          <select name="category" defaultValue={category} className="input w-auto">
            <option value="">All categories</option>
            {ASSET_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={status} className="input w-auto">
            <option value="">All statuses</option>
            {ASSET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
          <button className="btn-ghost">Filter</button>
        </form>
        {error ? (
          <p className="text-sm text-danger">The register could not load: {error.message}</p>
        ) : !rows?.length ? (
          <Empty
            title="No assets yet"
            hint={manage ? "Add laptops, cameras, phones and SIMs to start issuing them." : "Nothing matches."}
          />
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Tag</th>
                  <th>Asset</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>With</th>
                  <th>Warranty</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a: any) => {
                  const w = warrantyState(a.warranty_until);
                  return (
                    <tr key={a.id}>
                      <td className="font-mono text-xs">
                        <Link href={`/assets/${a.id}`} className="underline">
                          {a.asset_tag}
                        </Link>
                      </td>
                      <td>
                        <Link href={`/assets/${a.id}`} className="font-medium">
                          {a.name}
                        </Link>
                        <p className="text-xs text-muted">
                          {[a.brand, a.model, a.serial_no && `S/N ${a.serial_no}`].filter(Boolean).join(" · ")}
                        </p>
                      </td>
                      <td>{categoryLabel(a.category)}</td>
                      <td>
                        <Badge>{a.status}</Badge>
                        {a.condition === "DAMAGED" && <Badge tone="red">DAMAGED</Badge>}
                      </td>
                      <td>{a.holder ? <Link href={`/people/${a.holder.id}`}>{a.holder.full_name}</Link> : "—"}</td>
                      <td className="text-xs">
                        {a.warranty_until ? (
                          <span className={w === "EXPIRED" ? "text-muted line-through" : w === "EXPIRING" ? "text-ember" : ""}>
                            {fmtDate(a.warranty_until)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
