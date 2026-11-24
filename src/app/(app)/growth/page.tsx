import Link from "next/link";
import { can, requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Field, Flash, PageHeader } from "@/components/ui";
import { localDate } from "@/lib/engines/time";
import { fyQuarter, krProgress, objectiveProgress, shiftQuarter, suggestedConfidence, timeElapsed } from "@/lib/engines/growth";
import { addKeyResult, checkIn, createObjective, setObjectiveStatus } from "./actions";
import { CONF_TONE, GrowthNav, Progress } from "./nav";

export const metadata = { title: "OKRs" };

type KR = {
  id: string;
  objective_id: string;
  title: string;
  metric: string;
  start_value: number;
  target_value: number;
  current_value: number;
  unit: string | null;
  weight: number;
  confidence: keyof typeof CONF_TONE;
  owner_id: string | null;
  updated_at: string;
};
type Obj = {
  id: string;
  title: string;
  description: string | null;
  level: "COMPANY" | "TEAM" | "PERSONAL";
  team_id: string | null;
  owner_id: string;
  parent_id: string | null;
  status: string;
  period_start: string;
  period_end: string;
};

export default async function Okrs({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const today = localDate(new Date(), ctx.timezone);
  const q = /^\d{4}-\d{2}-01$/.test(sp.q ?? "") ? fyQuarter(sp.q!) : fyQuarter(today);
  const view = (["all", "mine"] as const).find((v) => v === sp.view) ?? "all";
  const back = `/growth?q=${q.start}&view=${view}`;

  const [{ data: objs }, { data: teams }, { data: people }] = await Promise.all([
    sb
      .from("okr_objectives")
      .select("id,title,description,level,team_id,owner_id,parent_id,status,period_start,period_end")
      .lte("period_start", q.end)
      .gte("period_end", q.start)
      .order("created_at"),
    sb.from("org_teams").select("id,name").order("name"),
    sb.from("employees").select("id,full_name").neq("status", "EXITED").order("full_name"),
  ]);
  const list = (objs ?? []) as Obj[];
  const ids = list.map((o) => o.id);
  const { data: krRows } = ids.length
    ? await sb.from("okr_key_results").select("*").in("objective_id", ids).order("weight", { ascending: false })
    : { data: [] };
  const krs = (krRows ?? []) as KR[];
  const name = new Map((people ?? []).map((p) => [p.id, p.full_name as string]));
  const teamName = new Map((teams ?? []).map((t) => [t.id, t.name as string]));
  const elapsed = timeElapsed(q.start, q.end, today);
  const mine = (o: Obj) => o.owner_id === ctx.employee_id || krs.some((k) => k.objective_id === o.id && k.owner_id === ctx.employee_id);
  const shown = view === "mine" ? list.filter(mine) : list;
  const byLevel = (l: Obj["level"]) => shown.filter((o) => o.level === l);
  const companyOk = can(ctx, "okr.manage");

  return (
    <>
      <PageHeader eyebrow="Performance & growth" title="OKRs">
        <Link className="btn-ghost" href={`/growth?q=${shiftQuarter(q.start, -1).start}&view=${view}`}>
          ← Prev
        </Link>
        <span className="btn pointer-events-none border border-line">{q.label}</span>
        <Link className="btn-ghost" href={`/growth?q=${shiftQuarter(q.start, 1).start}&view=${view}`}>
          Next →
        </Link>
      </PageHeader>
      <GrowthNav active="/growth" />
      <Flash sp={sp} />

      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm">
        <Link className={view === "all" ? "chip bg-ink text-paper" : "chip"} href={`/growth?q=${q.start}&view=all`}>
          Everything I can see
        </Link>
        <Link className={view === "mine" ? "chip bg-ink text-paper" : "chip"} href={`/growth?q=${q.start}&view=mine`}>
          Mine
        </Link>
        <span className="text-muted">
          {elapsed}% of the quarter gone · {q.start} → {q.end}
        </span>
      </div>

      {!shown.length && (
        <Empty
          title="No OKRs this quarter"
          hint="Start with 1–3 company objectives, then teams and people align their own objectives under them."
        />
      )}

      {(["COMPANY", "TEAM", "PERSONAL"] as const).map((level) =>
        byLevel(level).length ? (
          <section key={level} className="mb-8">
            <h2 className="eyebrow mb-3">{level === "COMPANY" ? "Company" : level === "TEAM" ? "Teams" : "Personal"}</h2>
            <div className="grid gap-4">
              {byLevel(level).map((o) => {
                const ks = krs.filter((k) => k.objective_id === o.id);
                const prog = objectiveProgress(ks);
                const parent = list.find((p) => p.id === o.parent_id);
                return (
                  <Card key={o.id}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-display text-2xl leading-tight">{o.title}</p>
                        <p className="mt-1 text-xs text-muted">
                          {o.level === "TEAM" && o.team_id ? `${teamName.get(o.team_id) ?? "Team"} · ` : ""}
                          Owner: {name.get(o.owner_id) ?? "—"}
                          {parent ? ` · supports “${parent.title}”` : ""}
                        </p>
                        {o.description && <p className="mt-2 max-w-2xl text-sm text-muted">{o.description}</p>}
                      </div>
                      <div className="flex items-center gap-3">
                        {o.status !== "ACTIVE" && <Badge>{o.status}</Badge>}
                        <Progress value={prog} label="Progress" />
                      </div>
                    </div>

                    {ks.length > 0 && (
                      <ul className="mt-5 divide-y divide-line border-t border-line">
                        {ks.map((k) => {
                          const p = krProgress(Number(k.start_value), Number(k.target_value), Number(k.current_value));
                          const hint = suggestedConfidence(p, elapsed);
                          const fmt = (v: number) =>
                            k.metric === "BOOLEAN"
                              ? Number(v) >= 1
                                ? "Done"
                                : "Not done"
                              : `${Number(v).toLocaleString("en-IN")}${k.unit ? " " + k.unit : ""}`;
                          return (
                            <li key={k.id} className="grid gap-3 py-3 lg:grid-cols-[1fr_auto]">
                              <div className="min-w-0">
                                <p className="text-sm">
                                  {k.title} <Badge tone={CONF_TONE[k.confidence]}>{k.confidence}</Badge>
                                </p>
                                <p className="mt-1 text-xs text-muted">
                                  {fmt(k.start_value)} → <strong className="text-ink">{fmt(k.current_value)}</strong> of{" "}
                                  {fmt(k.target_value)} · {p}% · weight {k.weight}
                                  {k.owner_id ? ` · ${name.get(k.owner_id) ?? ""}` : ""}
                                </p>
                              </div>
                              {o.status === "ACTIVE" && (
                                <form action={checkIn} className="flex flex-wrap items-end gap-2">
                                  <input type="hidden" name="kr" value={k.id} />
                                  <input type="hidden" name="back" value={back} />
                                  <input
                                    name="value"
                                    type="number"
                                    step="any"
                                    defaultValue={Number(k.current_value)}
                                    className="input w-24"
                                    aria-label={`New value for ${k.title}`}
                                    min={k.metric === "BOOLEAN" ? 0 : undefined}
                                    max={k.metric === "BOOLEAN" ? 1 : undefined}
                                  />
                                  <select name="confidence" defaultValue={hint} className="input w-32" aria-label="Confidence">
                                    <option value="ON_TRACK">On track</option>
                                    <option value="AT_RISK">At risk</option>
                                    <option value="OFF_TRACK">Off track</option>
                                  </select>
                                  <input name="note" placeholder="What changed?" className="input w-40" maxLength={1000} />
                                  <button className="btn-ghost">Check in</button>
                                </form>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    <details className="mt-4">
                      <summary className="cursor-pointer text-xs text-muted">Add key result · status</summary>
                      <form action={addKeyResult} className="mt-3 grid gap-3 sm:grid-cols-6">
                        <input type="hidden" name="objective_id" value={o.id} />
                        <input type="hidden" name="back" value={back} />
                        <Field label="Key result" className="sm:col-span-2">
                          <input
                            name="title"
                            required
                            minLength={3}
                            className="input"
                            placeholder="e.g. 12 clients ranked top-3 on Google"
                          />
                        </Field>
                        <Field label="Measured as">
                          <select name="metric" className="input">
                            <option value="NUMBER">Number</option>
                            <option value="PERCENT">Percent</option>
                            <option value="CURRENCY">Rupees</option>
                            <option value="BOOLEAN">Done / not done</option>
                          </select>
                        </Field>
                        <Field label="Start">
                          <input name="start_value" type="number" step="any" defaultValue={0} className="input" />
                        </Field>
                        <Field label="Target">
                          <input name="target_value" type="number" step="any" className="input" />
                        </Field>
                        <Field label="Weight">
                          <input name="weight" type="number" min={1} max={10} defaultValue={1} className="input" />
                        </Field>
                        <Field label="Unit" className="sm:col-span-2">
                          <input name="unit" className="input" placeholder="reels, leads, %" maxLength={20} />
                        </Field>
                        <Field label="Owner" className="sm:col-span-2">
                          <select name="owner_id" className="input" defaultValue="">
                            <option value="">Objective owner</option>
                            {(people ?? []).map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.full_name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <div className="flex items-end gap-2 sm:col-span-2">
                          <button className="btn">Add</button>
                        </div>
                      </form>
                      <form action={setObjectiveStatus} className="mt-3 flex gap-2">
                        <input type="hidden" name="id" value={o.id} />
                        <input type="hidden" name="back" value={back} />
                        {o.status !== "CLOSED" && (
                          <button name="status" value="CLOSED" className="btn-ghost">
                            Close objective
                          </button>
                        )}
                        {o.status !== "ACTIVE" && (
                          <button name="status" value="ACTIVE" className="btn-ghost">
                            Make active
                          </button>
                        )}
                      </form>
                    </details>
                  </Card>
                );
              })}
            </div>
          </section>
        ) : null,
      )}

      <Card title="New objective" hint="An objective is the outcome in words; key results are the 2–4 numbers that prove it.">
        <form action={createObjective} className="grid gap-3 sm:grid-cols-6">
          <input type="hidden" name="back" value={back} />
          <input type="hidden" name="period_start" value={q.start} />
          <input type="hidden" name="period_end" value={q.end} />
          <Field label="Objective" className="sm:col-span-3">
            <input
              name="title"
              required
              minLength={3}
              maxLength={200}
              className="input"
              placeholder="e.g. Make VSM the go-to SEO partner in Meerut"
            />
          </Field>
          <Field label="Level">
            <select name="level" className="input" defaultValue="PERSONAL">
              {companyOk && <option value="COMPANY">Company</option>}
              <option value="TEAM">Team</option>
              <option value="PERSONAL">Personal</option>
            </select>
          </Field>
          <Field label="Team (team OKRs)" className="sm:col-span-2">
            <select name="team_id" className="input" defaultValue="">
              <option value="">—</option>
              {(teams ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Owner" className="sm:col-span-2">
            <select name="owner_id" className="input" defaultValue={ctx.employee_id}>
              {(people ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Supports (optional)" className="sm:col-span-2">
            <select name="parent_id" className="input" defaultValue="">
              <option value="">—</option>
              {list
                .filter((o) => o.level !== "PERSONAL")
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Why it matters (optional)" className="sm:col-span-2">
            <input name="description" className="input" maxLength={2000} />
          </Field>
          <div className="sm:col-span-6">
            <button className="btn">Add objective for {q.label}</button>
            <p className="mt-2 text-xs text-muted">
              Personal OKRs are visible to you, your managers and HR. Team leads can add team OKRs; company OKRs need OKR rights.
            </p>
          </div>
        </form>
      </Card>
    </>
  );
}
