import Link from "next/link";
import { can, requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Field, Flash, PageHeader, TableWrap, Tabs } from "@/components/ui";
import { localDate, monthBounds, shiftMonth } from "@/lib/engines/time";
import { KPI_SOURCES, kpiStatus } from "@/lib/engines/growth";
import { refreshKpis, saveKpiDefinition, saveKpiValue, verifyKpi } from "../actions";
import { GrowthNav } from "../nav";

export const metadata = { title: "KPIs" };

type Def = {
  id: string;
  designation_id: string | null;
  name: string;
  unit: string | null;
  direction: "HIGHER" | "LOWER";
  target: number | null;
  source: string;
  weight: number;
  is_active: boolean;
};

export default async function Kpis({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const month = /^\d{4}-\d{2}-01$/.test(sp.month ?? "") ? sp.month! : monthBounds(localDate(new Date(), ctx.timezone)).start;
  const manager = can(ctx, "kpi.manage");

  // People whose KPIs I can see: RLS on kpi_values decides; the picker lists myself + my team (or everyone for KPI managers).
  const { data: team } = await sb.rpc("my_team_ids");
  const { data: people } = await sb.from("employees").select("id,full_name,designation").neq("status", "EXITED").order("full_name");
  const visible = (people ?? []).filter(
    (p) => p.id === ctx.employee_id || manager || can(ctx, "performance.view_all") || (Array.isArray(team) && team.includes(p.id)),
  );
  const who = visible.find((p) => p.id === sp.e) ?? visible.find((p) => p.id === ctx.employee_id) ?? visible[0];
  const tabs = [{ key: "values", label: "Values" }, ...(manager ? [{ key: "setup", label: "KPI setup" }] : [])];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : "values";
  const base = `/growth/kpis?month=${month}${who ? `&e=${who.id}` : ""}`;

  const [{ data: defs }, { data: posts }] = await Promise.all([
    sb.from("kpi_definitions").select("*").order("name"),
    sb.from("designations").select("id,title").eq("is_active", true).order("title"),
  ]);
  const postId = (posts ?? []).find((d) => who && d.title.toLowerCase() === (who.designation ?? "").toLowerCase())?.id;
  const mineDefs = ((defs ?? []) as Def[]).filter((d) => d.is_active && (d.designation_id === null || d.designation_id === postId));
  const { data: vals } = who ? await sb.from("kpi_values").select("*").eq("employee_id", who.id).eq("period_month", month) : { data: [] };
  const byKpi = new Map((vals ?? []).map((v) => [v.kpi_id, v]));
  const postName = new Map((posts ?? []).map((p) => [p.id, p.title as string]));
  const canEnter = who && (who.id === ctx.employee_id || manager || (Array.isArray(team) && team.includes(who.id)));

  return (
    <>
      <PageHeader eyebrow="Performance & growth" title="KPIs">
        <Link className="btn-ghost" href={`/growth/kpis?month=${shiftMonth(month, -1)}${who ? `&e=${who.id}` : ""}`}>
          ← Prev
        </Link>
        <span className="btn pointer-events-none border border-line">
          {new Date(`${month}T12:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric" })}
        </span>
        <Link className="btn-ghost" href={`/growth/kpis?month=${shiftMonth(month, 1)}${who ? `&e=${who.id}` : ""}`}>
          Next →
        </Link>
      </PageHeader>
      <GrowthNav active="/growth/kpis" />
      <Flash sp={sp} />
      <Tabs tabs={tabs} active={tab} base={base} />

      {tab === "values" && (
        <Card
          title={who ? `${who.full_name}${who.designation ? " · " + who.designation : ""}` : "KPIs"}
          hint="Automatic KPIs come from tasks, attendance, CRM and Scholars and refresh every night. Manual ones are entered here and verified by the manager."
          action={
            <div className="flex flex-wrap gap-2">
              {visible.length > 1 && (
                <form className="flex gap-2">
                  <input type="hidden" name="month" value={month} />
                  <select name="e" defaultValue={who?.id} className="input w-48" aria-label="Person">
                    {visible.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                  </select>
                  <button className="btn-ghost">Show</button>
                </form>
              )}
              {manager && (
                <form action={refreshKpis}>
                  <input type="hidden" name="month" value={month} />
                  <input type="hidden" name="back" value={base} />
                  <button className="btn-ghost">Recalculate</button>
                </form>
              )}
            </div>
          }
        >
          {!mineDefs.length ? (
            <Empty title="No KPIs for this post yet" hint="A KPI manager can add them under KPI setup." />
          ) : (
            <TableWrap>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="py-2">KPI</th>
                    <th>Value</th>
                    <th>Target</th>
                    <th>Status</th>
                    <th>Source</th>
                    <th className="w-[22rem]" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {mineDefs.map((d) => {
                    const v = byKpi.get(d.id);
                    const st = kpiStatus(v ? Number(v.value) : null, d.target === null ? null : Number(d.target), d.direction);
                    return (
                      <tr key={d.id}>
                        <td className="py-3">
                          {d.name}
                          <span className="block text-xs text-muted">
                            {d.direction === "LOWER" ? "Lower is better" : "Higher is better"}
                          </span>
                        </td>
                        <td className="tabular-nums">
                          {v ? `${Number(v.value).toLocaleString("en-IN")}${d.unit ? " " + d.unit : ""}` : "–"}
                        </td>
                        <td className="tabular-nums">
                          {d.target === null ? "–" : `${Number(d.target).toLocaleString("en-IN")}${d.unit ? " " + d.unit : ""}`}
                        </td>
                        <td>
                          <Badge tone={st === "MET" ? "green" : st === "BELOW" ? "red" : "grey"}>{st.replace("_", " ")}</Badge>
                        </td>
                        <td className="text-xs text-muted">
                          {d.source === "MANUAL"
                            ? v?.verified_at
                              ? "Manual · verified"
                              : v
                                ? "Manual · not verified"
                                : "Manual"
                            : "Automatic"}
                        </td>
                        <td>
                          {d.source === "MANUAL" && canEnter && !v?.verified_at && (
                            <form action={saveKpiValue} className="flex gap-2">
                              <input type="hidden" name="kpi_id" value={d.id} />
                              <input type="hidden" name="employee_id" value={who!.id} />
                              <input type="hidden" name="month" value={month} />
                              <input type="hidden" name="back" value={base} />
                              <input
                                name="value"
                                type="number"
                                step="any"
                                required
                                defaultValue={v ? Number(v.value) : undefined}
                                className="input w-24"
                                aria-label={`Value for ${d.name}`}
                              />
                              <input
                                name="note"
                                placeholder="Note / proof link"
                                defaultValue={v?.note ?? ""}
                                className="input w-36"
                                maxLength={500}
                              />
                              <button className="btn-ghost">Save</button>
                            </form>
                          )}
                          {d.source === "MANUAL" && v && !v.verified_at && who!.id !== ctx.employee_id && canEnter && (
                            <form action={verifyKpi} className="mt-2">
                              <input type="hidden" name="id" value={v.id} />
                              <input type="hidden" name="back" value={base} />
                              <button className="btn-ghost text-xs">Verify</button>
                            </form>
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
      )}

      {tab === "setup" && manager && (
        <div className="grid gap-6">
          <Card
            title="Add a KPI"
            hint="Tie it to a post (or leave blank for everyone). Pick an automatic source where one fits — no manual entry needed."
          >
            <form action={saveKpiDefinition} className="grid gap-3 sm:grid-cols-6">
              <Field label="Name" className="sm:col-span-2">
                <input name="name" required className="input" placeholder="e.g. Reels delivered" />
              </Field>
              <Field label="Post">
                <select name="designation_id" className="input" defaultValue="">
                  <option value="">Everyone</option>
                  {(posts ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Source" className="sm:col-span-2">
                <select name="source" className="input" defaultValue="MANUAL">
                  {Object.entries(KPI_SOURCES).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Better when">
                <select name="direction" className="input">
                  <option value="HIGHER">Higher</option>
                  <option value="LOWER">Lower</option>
                </select>
              </Field>
              <Field label="Monthly target">
                <input name="target" type="number" step="any" className="input" />
              </Field>
              <Field label="Unit">
                <input name="unit" className="input" maxLength={20} placeholder="reels, %" />
              </Field>
              <Field label="Weight">
                <input name="weight" type="number" min={1} max={10} defaultValue={1} className="input" />
              </Field>
              <div className="flex items-end">
                <button className="btn">Add KPI</button>
              </div>
            </form>
          </Card>
          <Card title="All KPIs" hint="Targets are monthly. Set a target so the status shows Met / Below.">
            <TableWrap>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="py-2">KPI</th>
                    <th>Post</th>
                    <th>Source</th>
                    <th>Target · unit · better</th>
                    <th>Active</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {((defs ?? []) as Def[]).map((d) => (
                    <tr key={d.id}>
                      <td colSpan={6} className="py-2">
                        <form
                          action={saveKpiDefinition}
                          className="grid items-center gap-2 sm:grid-cols-[1.4fr_1fr_1.2fr_0.6fr_0.5fr_0.6fr_0.4fr_auto]"
                        >
                          <input type="hidden" name="id" value={d.id} />
                          <input name="name" defaultValue={d.name} className="input" aria-label="Name" />
                          <select name="designation_id" defaultValue={d.designation_id ?? ""} className="input" aria-label="Post">
                            <option value="">Everyone</option>
                            {(posts ?? []).map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.title}
                              </option>
                            ))}
                          </select>
                          <select name="source" defaultValue={d.source} className="input" aria-label="Source">
                            {Object.entries(KPI_SOURCES).map(([k, l]) => (
                              <option key={k} value={k}>
                                {l}
                              </option>
                            ))}
                          </select>
                          <input
                            name="target"
                            type="number"
                            step="any"
                            defaultValue={d.target ?? ""}
                            className="input"
                            aria-label="Target"
                          />
                          <input name="unit" defaultValue={d.unit ?? ""} className="input" aria-label="Unit" />
                          <select name="direction" defaultValue={d.direction} className="input" aria-label="Better when">
                            <option value="HIGHER">Higher</option>
                            <option value="LOWER">Lower</option>
                          </select>
                          <label className="flex items-center gap-1 text-xs">
                            <input type="checkbox" name="is_active" defaultChecked={d.is_active} /> on
                          </label>
                          <input type="hidden" name="weight" value={d.weight} />
                          <button className="btn-ghost">Save</button>
                        </form>
                        <span className="sr-only">{d.designation_id ? postName.get(d.designation_id) : "Everyone"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        </div>
      )}
    </>
  );
}
