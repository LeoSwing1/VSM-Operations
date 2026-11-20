import Link from "next/link";
import { requirePerm, can, ROLE_LABEL, ROLES } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { computeForEmployee } from "@/lib/data/performance";
import { Badge, Card, Empty, Field, Flash, PageHeader, TableWrap, Tabs } from "@/components/ui";
import { fmtDate, localDate, monthBounds, shiftMonth } from "@/lib/engines/time";
import { DEFAULT_WEIGHTS, METRIC_KEYS, METRIC_LABELS } from "@/lib/engines/performance";
import { adjustSnapshot, approveSnapshot, createSnapshot, respondReviewRequest, savePolicy, submitReview } from "./actions";

export const metadata = { title: "Performance" };

export default async function Performance({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePerm("performance.view_all", "performance.view_team", "performance.configure");
  const sb = await supabaseServer();
  const tz = ctx.timezone;
  const month = /^\d{4}-\d{2}-01$/.test(sp.month ?? "") ? sp.month! : monthBounds(shiftMonth(localDate(new Date(), tz), -1)).start;
  const { start, end } = monthBounds(month);
  const tabs = [{ key: "team", label: "Team scores" }, { key: "requests", label: "Review requests" },
    ...(can(ctx, "performance.configure") ? [{ key: "policy", label: "Scoring policy" }] : [])];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : "team";
  const back = `/performance?month=${month}`;
  const reviewer = can(ctx, "performance.review") || can(ctx, "performance.configure");

  return (
    <>
      <PageHeader eyebrow="Performance & quality" title="Performance">
        <Link className="btn-ghost" href={`/performance?month=${shiftMonth(month, -1)}`}>← Prev</Link>
        <span className="btn pointer-events-none border border-line">{new Date(`${month}T12:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric" })}</span>
        <Link className="btn-ghost" href={`/performance?month=${shiftMonth(month, 1)}`}>Next →</Link>
      </PageHeader>
      <Flash sp={sp} />
      <Tabs tabs={tabs} active={tab} base={back} />
      <p className="mb-6 max-w-3xl text-sm text-muted">Scores are decision support, not decisions. Nothing here changes employment or pay automatically — incentives use only snapshots a reviewer has approved, and every adjustment needs a written reason.</p>

      {tab === "team" && <TeamTab sb={sb} ctx={ctx} start={start} end={end} back={back} reviewer={reviewer} />}
      {tab === "requests" && <RequestsTab sb={sb} />}
      {tab === "policy" && <PolicyTab sb={sb} />}
    </>
  );
}

type SB = Awaited<ReturnType<typeof supabaseServer>>;

async function TeamTab({ sb, ctx, start, end, back, reviewer }: { sb: SB; ctx: any; start: string; end: string; back: string; reviewer: boolean }) {
  const [{ data: people }, { data: snaps }] = await Promise.all([
    sb.from("employees").select("id, full_name, designation").neq("id", ctx.employee_id).neq("status", "EXITED").order("full_name"),
    sb.from("performance_snapshots").select("id, employee_id, computed_score, adjustment, final_score, category, coverage, status")
      .eq("period_start", start).eq("period_end", end).neq("status", "SUPERSEDED"),
  ]);
  if (!people?.length) return <Empty title="No team members in scope" />;
  const live = await Promise.all(people.map((p) => computeForEmployee(sb, p.id, start, end, ctx.timezone)));
  return (
    <div className="space-y-4">
      {people.map((p, i) => {
        const r = live[i]?.result;
        const snap = snaps?.find((s) => s.employee_id === p.id);
        return (
          <Card key={p.id}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <Link href={`/people/${p.id}?tab=performance`} className="font-display text-2xl hover:text-volt">{p.full_name}</Link>
                <p className="text-xs text-muted">{p.designation ?? "—"}</p>
              </div>
              <div className="text-right">
                <p className="display text-4xl tabular-nums">{snap?.final_score ?? r?.score ?? "—"}</p>
                <p className="text-xs text-muted">{snap ? `Snapshot · ${snap.status}` : "Live estimate"} · {(snap?.coverage ?? r?.coverage ?? 0)}% data coverage</p>
              </div>
            </div>
            {r && (
              <div className="mt-4 flex flex-wrap gap-2">{r.components.map((c) => (
                <span key={c.key} className="chip border-line normal-case tracking-normal" title={`${c.formula} — ${c.detail}`}>
                  {c.label}: {c.score ?? "no data"}</span>))}</div>
            )}
            {reviewer && (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                {(!snap || snap.status === "DRAFT") && (
                  <form action={createSnapshot}><input type="hidden" name="employee_id" value={p.id} /><input type="hidden" name="start" value={start} /><input type="hidden" name="end" value={end} />
                    <button className="btn-ghost">{snap ? "Recompute draft" : "Create snapshot"}</button></form>)}
                {snap?.status === "DRAFT" && snap.computed_score !== null && (
                  <form action={adjustSnapshot} className="flex flex-wrap gap-2"><input type="hidden" name="id" value={snap.id} /><input type="hidden" name="back" value={back} />
                    <input name="delta" type="number" step="0.5" min="-20" max="20" placeholder="±" aria-label="Adjustment" className="input w-20" />
                    <input name="reason" minLength={10} placeholder="Reason (required)" className="input w-56" />
                    <button className="btn-ghost">Adjust</button></form>)}
                {snap?.status === "DRAFT" && (
                  <form action={approveSnapshot}><input type="hidden" name="id" value={snap.id} /><input type="hidden" name="back" value={back} />
                    <button className="btn-primary">Approve snapshot</button></form>)}
                {snap?.status === "APPROVED" && <Badge>APPROVED</Badge>}
                <details className="w-full">
                  <summary className="cursor-pointer text-xs text-muted">Write manager review for this period</summary>
                  <form action={submitReview} className="mt-3 grid gap-3 sm:grid-cols-[100px_1fr_1fr_auto]">
                    <input type="hidden" name="employee_id" value={p.id} /><input type="hidden" name="start" value={start} /><input type="hidden" name="end" value={end} /><input type="hidden" name="back" value={back} />
                    <Field label="Rating 0–100"><input name="rating" type="number" min="0" max="100" required className="input" /></Field>
                    <Field label="Shared with employee"><textarea name="shared" rows={2} className="input" /></Field>
                    <Field label="Private notes (never shown to employee)"><textarea name="private" rows={2} className="input" /></Field>
                    <div className="flex items-end"><button className="btn-ghost">Save review</button></div>
                  </form>
                </details>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

async function RequestsTab({ sb }: { sb: SB }) {
  const { data } = await sb.from("performance_review_requests")
    .select("id, message, status, response, created_at, employee:employees!performance_review_requests_employee_id_fkey(full_name), snapshot:performance_snapshots(period_start, period_end, final_score)")
    .order("created_at", { ascending: false }).limit(50);
  if (!data?.length) return <Empty title="No review requests" hint="Employees can challenge a snapshot from their own analytics page." />;
  return <div className="grid gap-4 lg:grid-cols-2">{data.map((r: any) => (
    <Card key={r.id} title={`${r.employee?.full_name} · ${r.snapshot ? fmtDate(r.snapshot.period_start) : ""}`} action={<Badge>{r.status}</Badge>}>
      <p className="text-sm">{r.message}</p>
      <p className="mt-1 text-xs text-muted">Score in question: {r.snapshot?.final_score ?? "—"}</p>
      {r.status === "PENDING" ? (
        <form action={respondReviewRequest} className="mt-3 flex flex-wrap gap-2"><input type="hidden" name="id" value={r.id} />
          <input name="response" className="input flex-1" placeholder="Your response" />
          <button name="decision" value="approve" className="btn-primary">Accept</button><button name="decision" value="reject" className="btn-ghost">Decline</button></form>
      ) : r.response && <p className="mt-3 text-xs text-muted">Response: {r.response}</p>}
    </Card>))}</div>;
}

async function PolicyTab({ sb }: { sb: SB }) {
  const [{ data: policies }, { data: depts }] = await Promise.all([
    sb.from("performance_policies").select("*").eq("is_active", true).order("created_at"),
    sb.from("departments").select("id, name").order("name"),
  ]);
  const forms = [...(policies ?? []), { id: "", name: "New department/role policy", weights: DEFAULT_WEIGHTS, min_coverage: 60, department_id: null, role: null }];
  return <div className="grid gap-6 xl:grid-cols-2">{forms.map((p: any) => (
    <Card key={p.id || "new"} title={p.id ? p.name : "Add a policy"}>
      <form action={savePolicy} className="space-y-3">
        <input type="hidden" name="id" value={p.id} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name"><input name="name" defaultValue={p.name} className="input" /></Field>
          <Field label="Department"><select name="department_id" defaultValue={p.department_id ?? ""} className="input"><option value="">All</option>{(depts ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <Field label="Role"><select name="role" defaultValue={p.role ?? ""} className="input"><option value="">All</option>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
        </div>
        <TableWrap><table className="table"><thead><tr><th>Dimension</th><th className="w-28">Weight %</th></tr></thead><tbody>
          {METRIC_KEYS.map((k) => <tr key={k}><td>{METRIC_LABELS[k]}</td><td><input name={`w_${k}`} type="number" min="0" max="100" step="1" defaultValue={p.weights?.[k] ?? ""} className="input py-1" /></td></tr>)}
        </tbody></table></TableWrap>
        <Field label="Minimum data coverage to publish a score (%)"><input name="min_coverage" type="number" min="0" max="100" defaultValue={p.min_coverage} className="input w-32" /></Field>
        <p className="text-xs text-muted">Weights must total exactly 100. Dimensions without data are excluded (never scored as 100); if covered weight falls below the minimum, no score is published.</p>
        <button className="btn-primary">Save policy</button>
      </form>
    </Card>))}</div>;
}
