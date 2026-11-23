import { redirect } from "next/navigation";
import { can, canAny, requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Field, Flash, PageHeader } from "@/components/ui";
import { saveCourse } from "../actions";
import { ScholarsNav, rupees } from "../nav";

export const metadata = { title: "Courses · VSM Scholars" };

export default async function Courses({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!canAny(ctx, ["scholars.view", "scholars.teach"])) redirect("/dashboard");
  const sb = await supabaseServer();
  const { data: courses } = await sb.from("scholar_courses").select("*").order("code");
  const admin = can(ctx, "scholars.admin");
  return (
    <>
      <PageHeader eyebrow="VSM Scholars" title="Courses" />
      <ScholarsNav active="/scholars/courses" />
      <Flash sp={sp} />
      <div className="grid gap-4 md:grid-cols-3">
        {(courses ?? []).map((c) => (
          <Card key={c.id} title={c.name} action={<span className="font-mono text-xs text-muted">{c.code}</span>}>
            <p className="text-sm text-muted">{c.description}</p>
            <p className="mt-3 text-sm">
              {c.duration_weeks ? `${c.duration_weeks} weeks · ` : ""}
              {c.fee != null ? rupees(c.fee) : <span className="text-ember">Fee not set</span>}
            </p>
            {admin && (
              <form action={saveCourse} className="mt-4 grid grid-cols-2 gap-2">
                <input type="hidden" name="code" value={c.code} />
                <input type="hidden" name="name" value={c.name} />
                <input type="hidden" name="description" value={c.description ?? ""} />
                <Field label="Weeks">
                  <input name="duration_weeks" type="number" min={1} max={104} defaultValue={c.duration_weeks ?? 12} className="input" />
                </Field>
                <Field label="Fee ₹">
                  <input name="fee" type="number" min={0} step="1" defaultValue={c.fee ?? ""} required className="input" />
                </Field>
                <div className="col-span-2">
                  <button className="btn-ghost text-xs">Save</button>
                </div>
              </form>
            )}
          </Card>
        ))}
      </div>
      {admin && (
        <Card title="Add a course" className="mt-6">
          <form action={saveCourse} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Code">
              <input name="code" required placeholder="SMM" className="input uppercase" />
            </Field>
            <Field label="Name">
              <input name="name" required className="input" />
            </Field>
            <Field label="Weeks">
              <input name="duration_weeks" type="number" min={1} max={104} defaultValue={8} className="input" />
            </Field>
            <Field label="Fee ₹">
              <input name="fee" type="number" min={0} step="1" required className="input" />
            </Field>
            <Field label="Description">
              <input name="description" className="input" />
            </Field>
            <div>
              <button className="btn-primary">Add course</button>
            </div>
          </form>
        </Card>
      )}
    </>
  );
}
