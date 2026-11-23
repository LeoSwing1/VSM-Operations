import { requireContext, canAny } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Field, Flash, PageHeader, TableWrap } from "@/components/ui";
import { assessQuality, createChecklist } from "./actions";
export const metadata = { title: "Quality management" };
export default async function Quality({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams,
    ctx = await requireContext(),
    sb = await supabaseServer();
  const [{ data: assessments }, { data: people }, { data: tasks }, { data: projects }, { data: checklists }] = await Promise.all([
    sb
      .from("quality_assessments")
      .select(
        "id,employee_id,reviewer_id,score,outcome,findings,assessed_at,employee:employees!quality_assessments_employee_id_fkey(full_name),evidence:quality_evidence(id,file_name,storage_path,size_bytes,mime_type)",
      )
      .order("assessed_at", { ascending: false })
      .limit(200),
    sb.from("employee_directory").select("id,full_name").order("full_name"),
    sb.from("tasks").select("id,title").order("created_at", { ascending: false }).limit(200),
    sb.from("projects").select("id,name").order("name"),
    sb.from("quality_checklists").select("id,name,criteria").eq("is_active", true).order("name"),
  ]);
  const canReview = canAny(ctx, ["quality.review", "tasks.review"]),
    visible = (assessments ?? []).filter(
      (a: any) =>
        a.employee_id === ctx.employee_id || a.reviewer_id === ctx.employee_id || canAny(ctx, ["quality.view_all", "quality.view_team"]),
    );
  const evidenceLinks = new Map<string, string>();
  await Promise.all(
    visible.flatMap((a: any) =>
      (a.evidence ?? []).map(async (f: any) => {
        const { data } = await sb.storage.from("quality-evidence").createSignedUrl(f.storage_path, 300);
        if (data?.signedUrl) evidenceLinks.set(f.id, data.signedUrl);
      }),
    ),
  );
  return (
    <>
      <PageHeader eyebrow="Delivery standards" title="Quality management">
        <a className="btn-ghost" href="/api/reports/quality?format=csv">
          CSV
        </a>
        <a className="btn-ghost" href="/api/reports/quality?format=xlsx">
          Excel
        </a>
        <a className="btn-ghost" href="/api/reports/quality?format=pdf">
          PDF
        </a>
        <a className="btn-ghost" href="/tasks">
          Tasks & reviews →
        </a>
      </PageHeader>
      <Flash sp={sp} />
      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        {canReview && (
          <Card title="New quality assessment" hint="Assess work independently; self-assessment is blocked.">
            <form action={assessQuality} className="grid gap-3">
              <Field label="Employee">
                <select name="employee_id" className="input" required>
                  {(people ?? [])
                    .filter((p) => p.id !== ctx.employee_id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Task">
                <select name="task_id" className="input">
                  <option value="">Select task or project</option>
                  {(tasks ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Project">
                <select name="project_id" className="input">
                  <option value="">No project</option>
                  {(projects ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Checklist">
                <select name="checklist_id" className="input">
                  <option value="">No checklist</option>
                  {(checklists ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Score (0–100)">
                <input name="score" type="number" min="0" max="100" step="0.5" className="input" required />
              </Field>
              <Field label="Outcome">
                <select name="outcome" className="input">
                  <option>PASS</option>
                  <option>REWORK</option>
                  <option>FAIL</option>
                </select>
              </Field>
              <Field label="Findings / improvement notes">
                <textarea name="findings" className="input" rows={3} />
              </Field>
              <Field label="Evidence attachments (up to 8 files, 15 MB each)">
                <input name="evidence" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.docx,.xlsx" className="input" />
              </Field>
              <button className="btn-primary">Record assessment</button>
            </form>
          </Card>
        )}
        {canAny(ctx, ["quality.manage"]) && (
          <Card title="Quality checklist builder">
            <form action={createChecklist} className="grid gap-2">
              <Field label="Checklist name">
                <input name="name" className="input" required />
              </Field>
              <Field label="Description">
                <input name="description" className="input" />
              </Field>
              <Field label="Criteria (one per line)">
                <textarea name="criteria" className="input" rows={4} placeholder="Accuracy\nCompleteness\nBrand compliance" required />
              </Field>
              <button className="btn-ghost">Save checklist</button>
            </form>
          </Card>
        )}
        <Card title="Quality register" hint="Review scores, outcomes and improvement notes.">
          {!visible.length ? (
            <Empty title="No quality assessments" />
          ) : (
            <TableWrap>
              <table className="table min-w-[700px]">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Score</th>
                    <th>Outcome</th>
                    <th>Reviewer</th>
                    <th>Findings</th>
                    <th>Evidence</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((a: any) => (
                    <tr key={a.id}>
                      <td>{a.employee?.full_name ?? "—"}</td>
                      <td className="font-semibold">{a.score}</td>
                      <td>
                        <Badge>{a.outcome}</Badge>
                      </td>
                      <td>{people?.find((p) => p.id === a.reviewer_id)?.full_name ?? "—"}</td>
                      <td className="max-w-[240px] truncate">{a.findings || "—"}</td>
                      <td>
                        {(a.evidence ?? []).length ? (
                          <div className="flex flex-col gap-1">
                            {a.evidence.map((f: any) =>
                              evidenceLinks.get(f.id) ? (
                                <a
                                  key={f.id}
                                  className="text-volt underline"
                                  href={evidenceLinks.get(f.id)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {f.file_name}
                                </a>
                              ) : (
                                <span key={f.id}>{f.file_name} (unavailable)</span>
                              ),
                            )}
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{new Date(a.assessed_at).toLocaleDateString("en-IN", { timeZone: ctx.timezone })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}
