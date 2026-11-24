import { can, requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Field, Flash, PageHeader, Stat, TableWrap } from "@/components/ui";
import { fmtDate } from "@/lib/engines/time";
import { saveTraining, verifyTraining } from "../actions";
import { GrowthNav } from "../nav";

export const metadata = { title: "Training" };

const KINDS = {
  COURSE: "Course",
  WORKSHOP: "Workshop",
  CERTIFICATION: "Certification",
  INTERNAL: "Internal session",
  ON_THE_JOB: "On the job",
};

export default async function Training({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const hr = can(ctx, "training.manage");
  const [{ data: rows }, { data: people }, { data: team }] = await Promise.all([
    sb.from("training_records").select("*").order("created_at", { ascending: false }).limit(300),
    sb.from("employees").select("id,full_name").neq("status", "EXITED").order("full_name"),
    sb.rpc("my_team_ids"),
  ]);
  const name = new Map((people ?? []).map((p) => [p.id, p.full_name as string]));
  const canAssign = (people ?? []).filter(
    (p) => p.id === ctx.employee_id || hr || (Array.isArray(team) && (team as string[]).includes(p.id)),
  );
  const filter = sp.e && name.has(sp.e) ? sp.e : null;
  const list = (rows ?? []).filter((r) => !filter || r.employee_id === filter);
  const mine = (rows ?? []).filter((r) => r.employee_id === ctx.employee_id);
  const hoursThisYear = mine
    .filter((r) => r.status === "COMPLETED" && (r.completed_on ?? "").slice(0, 4) === new Date().getFullYear().toString())
    .reduce((s, r) => s + Number(r.hours ?? 0), 0);

  return (
    <>
      <PageHeader eyebrow="Performance & growth" title="Training" />
      <GrowthNav active="/growth/training" />
      <Flash sp={sp} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="My completed" value={mine.filter((r) => r.status === "COMPLETED").length} />
        <Stat label="My hours this year" value={hoursThisYear} />
        <Stat label="In progress / planned" value={mine.filter((r) => r.status === "IN_PROGRESS" || r.status === "PLANNED").length} />
      </div>

      <Card
        title="Record training"
        hint="Add your own, or assign to someone in your team — they get a notification. Managers verify completed training."
      >
        <form action={saveTraining} className="grid gap-3 sm:grid-cols-6">
          <Field label="Person" className="sm:col-span-2">
            <select name="employee_id" className="input" defaultValue={ctx.employee_id}>
              {canAssign.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Title" className="sm:col-span-2">
            <input name="title" required minLength={3} className="input" placeholder="e.g. Meta Blueprint: Media Buying" />
          </Field>
          <Field label="Provider">
            <input name="provider" className="input" placeholder="Google, Meta, VSM" />
          </Field>
          <Field label="Type">
            <select name="kind" className="input">
              {Object.entries(KINDS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select name="status" className="input" defaultValue="PLANNED">
              <option value="PLANNED">Planned</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </Field>
          <Field label="Started">
            <input name="started_on" type="date" className="input" />
          </Field>
          <Field label="Completed">
            <input name="completed_on" type="date" className="input" />
          </Field>
          <Field label="Hours">
            <input name="hours" type="number" min={0} step="0.5" className="input" />
          </Field>
          <Field label="Certificate link" className="sm:col-span-2">
            <input name="certificate_url" type="url" className="input" placeholder="https://…" />
          </Field>
          <div className="flex items-end">
            <button className="btn">Save</button>
          </div>
        </form>
      </Card>

      <Card
        className="mt-6"
        title="Records"
        action={
          canAssign.length > 1 ? (
            <form className="flex gap-2">
              <select name="e" defaultValue={filter ?? ""} className="input w-44" aria-label="Person">
                <option value="">Everyone I can see</option>
                {canAssign.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </select>
              <button className="btn-ghost">Filter</button>
            </form>
          ) : undefined
        }
      >
        {!list.length ? (
          <Empty title="No training recorded yet" />
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-2">Person</th>
                  <th>Training</th>
                  <th>Type</th>
                  <th>Dates</th>
                  <th>Hours</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2">{name.get(r.employee_id) ?? "—"}</td>
                    <td>
                      {r.certificate_url ? (
                        <a href={r.certificate_url} target="_blank" rel="noopener noreferrer" className="underline">
                          {r.title}
                        </a>
                      ) : (
                        r.title
                      )}
                      {r.provider && <span className="block text-xs text-muted">{r.provider}</span>}
                    </td>
                    <td className="text-xs">{KINDS[r.kind as keyof typeof KINDS]}</td>
                    <td className="text-xs text-muted">
                      {r.started_on ? fmtDate(r.started_on) : "—"} → {r.completed_on ? fmtDate(r.completed_on) : "—"}
                    </td>
                    <td className="tabular-nums">{r.hours ?? "–"}</td>
                    <td>
                      <Badge tone={r.status === "COMPLETED" ? "green" : r.status === "DROPPED" ? "grey" : "amber"}>{r.status}</Badge>
                      {r.verified_at && (
                        <span className="block text-xs text-muted">Verified by {name.get(r.verified_by) ?? "manager"}</span>
                      )}
                    </td>
                    <td>
                      {r.status === "COMPLETED" && !r.verified_at && r.employee_id !== ctx.employee_id && (
                        <form action={verifyTraining}>
                          <input type="hidden" name="id" value={r.id} />
                          <button className="btn-ghost text-xs">Verify</button>
                        </form>
                      )}
                      {r.employee_id === ctx.employee_id && !r.verified_at && r.status !== "COMPLETED" && (
                        <form action={saveTraining} className="flex gap-1">
                          {["id", "title", "provider", "kind", "started_on", "hours", "certificate_url"].map((k) =>
                            r[k] === null || r[k] === undefined ? null : <input key={k} type="hidden" name={k} value={String(r[k])} />,
                          )}
                          <input type="hidden" name="status" value="COMPLETED" />
                          <input type="date" name="completed_on" required className="input w-36" aria-label="Completed on" />
                          <button className="btn-ghost text-xs">Mark done</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
