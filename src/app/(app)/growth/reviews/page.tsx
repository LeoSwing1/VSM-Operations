import Link from "next/link";
import { can, requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Field, Flash, PageHeader, TableWrap, Tabs } from "@/components/ui";
import { fmtDate, localDate } from "@/lib/engines/time";
import { REVIEW_RELATIONS, fyQuarter } from "@/lib/engines/growth";
import { closeCycle, createCycle, openCycle, submitReviewForm } from "../actions";
import { GrowthNav } from "../nav";

export const metadata = { title: "360° reviews" };

type Question = { key: string; label: string };
type Summary = {
  cycle: string;
  status: string;
  questions: Question[];
  by_relation: Record<string, Record<string, number>>;
  responses: number;
  expected: number;
  comments: { relation: string; strengths: string; improvements: string | null; by: string | null }[];
};

export default async function Reviews({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const hr = can(ctx, "reviews.manage");
  const tabs = [
    { key: "forms", label: "My forms" },
    { key: "results", label: "Results" },
    ...(hr ? [{ key: "manage", label: "Manage cycles" }] : []),
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : "forms";

  const [{ data: cycles }, { data: forms }, { data: people }, { data: team }] = await Promise.all([
    sb.from("review_cycles").select("*").order("created_at", { ascending: false }),
    sb
      .from("review_assignments")
      .select("id,cycle_id,subject_id,relation,status,submitted_at")
      .eq("reviewer_id", ctx.employee_id)
      .order("status", { ascending: true }),
    sb.from("employees").select("id,full_name,designation").neq("status", "EXITED").order("full_name"),
    sb.rpc("my_team_ids"),
  ]);
  const name = new Map((people ?? []).map((p) => [p.id, p.full_name as string]));
  const cyc = new Map((cycles ?? []).map((c) => [c.id, c]));
  const pending = (forms ?? []).filter((f) => f.status === "PENDING" && cyc.get(f.cycle_id)?.status === "OPEN");
  const form = sp.form ? (forms ?? []).find((f) => f.id === sp.form) : undefined;

  // Results: my own (after close) + my team + everyone for HR.
  const resultCycle = (cycles ?? []).find((c) => c.id === sp.c) ?? (cycles ?? []).find((c) => c.status !== "DRAFT");
  const subjects = (people ?? []).filter(
    (p) => p.id === ctx.employee_id || hr || (Array.isArray(team) && (team as string[]).includes(p.id)),
  );
  const subject = subjects.find((p) => p.id === sp.s) ?? subjects.find((p) => p.id === ctx.employee_id);
  let summary: Summary | null = null;
  let summaryErr: string | null = null;
  if (tab === "results" && resultCycle && subject) {
    const { data, error } = await sb.rpc("review_summary", { p_cycle: resultCycle.id, p_subject: subject.id });
    if (error) summaryErr = error.message;
    else summary = data as Summary;
  }
  const q = fyQuarter(localDate(new Date(), ctx.timezone));

  return (
    <>
      <PageHeader eyebrow="Performance & growth" title="360° reviews" />
      <GrowthNav active="/growth/reviews" />
      <Flash sp={sp} />
      <Tabs tabs={tabs} active={tab} base="/growth/reviews" />

      {tab === "forms" && form && cyc.get(form.cycle_id) && (
        <Card
          title={`${REVIEW_RELATIONS[form.relation]} · ${form.relation === "SELF" ? "About you" : name.get(form.subject_id)}`}
          hint={
            form.relation === "PEER" || form.relation === "REPORT"
              ? cyc.get(form.cycle_id).anonymous_peers
                ? "Anonymous: they see averages and comments, never your name. Comments show only when at least 2 people respond."
                : "Not anonymous in this cycle."
              : "Rate each area from 1 (needs a lot of work) to 5 (outstanding)."
          }
        >
          {form.status === "SUBMITTED" ? (
            <p className="text-sm text-muted">Submitted {form.submitted_at ? fmtDate(form.submitted_at.slice(0, 10)) : ""}. Thank you.</p>
          ) : (
            <form action={submitReviewForm} className="grid gap-5">
              <input type="hidden" name="id" value={form.id} />
              {(cyc.get(form.cycle_id).questions as Question[]).map((qq) => (
                <fieldset key={qq.key}>
                  <legend className="label">{qq.label}</legend>
                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <label key={n} className="chip cursor-pointer has-[:checked]:bg-ink has-[:checked]:text-paper">
                        <input type="radio" name={`q_${qq.key}`} value={n} required className="sr-only" />
                        {n}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <Field label="What do they do really well? (required)">
                <textarea name="strengths" required minLength={3} maxLength={3000} rows={3} className="input" />
              </Field>
              <Field label="One thing that would make the biggest difference">
                <textarea name="improvements" maxLength={3000} rows={3} className="input" />
              </Field>
              <div>
                <button className="btn">Submit review</button>
              </div>
            </form>
          )}
        </Card>
      )}

      {tab === "forms" && !form && (
        <Card title="Waiting for you" hint={pending.length ? `${pending.length} to fill` : undefined}>
          {!(forms ?? []).length ? (
            <Empty title="No review forms" hint="When HR opens a 360° cycle, your forms appear here." />
          ) : (
            <ul className="divide-y divide-line">
              {(forms ?? []).map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span>
                    {f.relation === "SELF" ? "Self review" : name.get(f.subject_id)}{" "}
                    <span className="text-muted">
                      · {REVIEW_RELATIONS[f.relation]} · {cyc.get(f.cycle_id)?.name}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={f.status === "SUBMITTED" ? "green" : "amber"}>{f.status}</Badge>
                    {f.status === "PENDING" && cyc.get(f.cycle_id)?.status === "OPEN" && (
                      <Link className="btn-ghost" href={`/growth/reviews?form=${f.id}`}>
                        Fill
                      </Link>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "results" && (
        <Card
          title={summary ? `${subject?.full_name} · ${summary.cycle}` : "Results"}
          action={
            <form className="flex flex-wrap gap-2">
              <input type="hidden" name="tab" value="results" />
              <select name="c" defaultValue={resultCycle?.id} className="input w-44" aria-label="Cycle">
                {(cycles ?? [])
                  .filter((c) => c.status !== "DRAFT")
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
              {subjects.length > 1 && (
                <select name="s" defaultValue={subject?.id} className="input w-44" aria-label="Person">
                  {subjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                    </option>
                  ))}
                </select>
              )}
              <button className="btn-ghost">Show</button>
            </form>
          }
        >
          {!resultCycle ? (
            <Empty title="No review cycles yet" />
          ) : summaryErr ? (
            <p className="text-sm text-muted">{summaryErr.replace(/^./, (c) => c.toUpperCase())}</p>
          ) : summary ? (
            <div className="grid gap-6">
              <p className="text-sm text-muted">
                {summary.responses} of {summary.expected} responses · cycle {summary.status.toLowerCase()}
              </p>
              <TableWrap>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr>
                      <th className="py-2">Area</th>
                      {Object.keys(summary.by_relation).map((r) => (
                        <th key={r}>{REVIEW_RELATIONS[r] ?? r}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {summary.questions.map((qq) => (
                      <tr key={qq.key}>
                        <td className="py-2">{qq.label}</td>
                        {Object.entries(summary!.by_relation).map(([r, v]) => (
                          <td key={r} className="tabular-nums">
                            {v[qq.key] ?? "–"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <div className="grid gap-3">
                {summary.comments.map((c, i) => (
                  <blockquote key={i} className="rounded-xl border border-line p-4 text-sm">
                    <p className="eyebrow mb-2">
                      {REVIEW_RELATIONS[c.relation]}
                      {c.by ? ` · ${c.by}` : ""}
                    </p>
                    <p>
                      <strong>Strengths:</strong> {c.strengths}
                    </p>
                    {c.improvements && (
                      <p className="mt-1">
                        <strong>To grow:</strong> {c.improvements}
                      </p>
                    )}
                  </blockquote>
                ))}
                {!summary.comments.length && <p className="text-sm text-muted">No comments to show yet.</p>}
              </div>
            </div>
          ) : null}
        </Card>
      )}

      {tab === "manage" && hr && (
        <div className="grid gap-6">
          <Card
            title="New 360° cycle"
            hint="Opening a cycle creates self, manager, direct-report and peer forms (peers from the same team) for everyone."
          >
            <form action={createCycle} className="grid gap-3 sm:grid-cols-6">
              <Field label="Name" className="sm:col-span-2">
                <input name="name" required className="input" defaultValue={`${q.label} 360°`} />
              </Field>
              <Field label="Covers from">
                <input name="period_start" type="date" required defaultValue={q.start} className="input" />
              </Field>
              <Field label="to">
                <input name="period_end" type="date" required defaultValue={q.end} className="input" />
              </Field>
              <Field label="Due by">
                <input name="due_on" type="date" className="input" />
              </Field>
              <Field label="Peers per person">
                <input name="peers_per_person" type="number" min={0} max={6} defaultValue={2} className="input" />
              </Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-3">
                <input type="checkbox" name="anonymous_peers" defaultChecked /> Peer and upward feedback is anonymous
              </label>
              <div className="sm:col-span-3">
                <button className="btn">Create draft</button>
              </div>
            </form>
          </Card>
          <Card title="Cycles">
            {!(cycles ?? []).length ? (
              <Empty title="No cycles yet" />
            ) : (
              <ul className="divide-y divide-line">
                {(cycles ?? []).map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                    <span>
                      {c.name}{" "}
                      <span className="text-muted">
                        · {fmtDate(c.period_start)} – {fmtDate(c.period_end)}
                        {c.due_on ? ` · due ${fmtDate(c.due_on)}` : ""}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge tone={c.status === "OPEN" ? "green" : c.status === "DRAFT" ? "amber" : "grey"}>{c.status}</Badge>
                      {c.status === "DRAFT" && (
                        <form action={openCycle}>
                          <input type="hidden" name="id" value={c.id} />
                          <button className="btn-ghost">Open & send forms</button>
                        </form>
                      )}
                      {c.status === "OPEN" && (
                        <form action={closeCycle}>
                          <input type="hidden" name="id" value={c.id} />
                          <button className="btn-ghost">Close & release results</button>
                        </form>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
