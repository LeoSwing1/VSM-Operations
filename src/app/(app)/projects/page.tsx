import Link from "next/link";
import { requireContext, can, canAny } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Field, Flash, PageHeader } from "@/components/ui";
import { createProjectWorkspace } from "./actions";
export const metadata = { title: "Projects & Delivery" };
export default async function Projects({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams,
    ctx = await requireContext(),
    sb = await supabaseServer();
  const [{ data: projects }, { data: clients }] = await Promise.all([
    sb
      .from("projects")
      .select(
        "id,name,description,status,priority,start_date,deadline,manager_id,client:clients(name),milestones:project_milestones(id,status),tasks(id,status),members:project_members(employee_id)",
      )
      .order("created_at", { ascending: false }),
    can(ctx, "projects.manage") ? sb.from("clients").select("id,name").order("name") : Promise.resolve({ data: [] }),
  ]);
  return (
    <>
      <PageHeader eyebrow="Delivery operations" title="Projects & delivery">
        {canAny(ctx, ["projects.time_approve", "projects.manage"]) && (
          <Link href="/projects/time" className="btn-ghost">
            Time approvals
          </Link>
        )}
        <Link href="/tasks" className="btn-ghost">
          Task board
        </Link>
      </PageHeader>
      <Flash sp={sp} />
      {can(ctx, "projects.manage") && (
        <details className="card mb-6 p-5">
          <summary className="eyebrow cursor-pointer">Create project workspace</summary>
          <form action={createProjectWorkspace} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Project name">
              <input name="name" required className="input" />
            </Field>
            <Field label="Client">
              <select name="client_id" className="input">
                <option value="">Internal</option>
                {(clients ?? []).map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <select name="priority" className="input">
                <option>MEDIUM</option>
                <option>LOW</option>
                <option>HIGH</option>
                <option>URGENT</option>
              </select>
            </Field>
            <Field label="Start date">
              <input name="start_date" type="date" className="input" />
            </Field>
            <Field label="Deadline">
              <input name="deadline" type="date" className="input" />
            </Field>
            <Field label="Description" className="sm:col-span-2 lg:col-span-3">
              <textarea name="description" className="input" rows={2} />
            </Field>
            <div>
              <button className="btn-primary">Create workspace</button>
            </div>
          </form>
        </details>
      )}
      {!projects?.length ? (
        <Empty title="No projects yet" hint="Create a project workspace to coordinate delivery, milestones, updates and time." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p: any) => {
            const total = p.tasks?.length ?? 0,
              done = p.tasks?.filter((t: any) => t.status === "COMPLETED").length ?? 0;
            return (
              <Link key={p.id} href={`/projects/${p.id}`} className="card block p-5 transition hover:-translate-y-0.5 hover:border-volt">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="eyebrow">{p.client?.name ?? "Internal project"}</p>
                    <h2 className="mt-1 text-lg font-semibold">{p.name}</h2>
                  </div>
                  <Badge>{p.status}</Badge>
                </div>
                <p className="mt-3 line-clamp-2 min-h-10 text-sm text-muted">
                  {p.description || "Project workspace and delivery overview."}
                </p>
                <div className="mt-4 flex justify-between text-xs text-muted">
                  <span>
                    {p.milestones?.filter((m: any) => m.status === "COMPLETED").length ?? 0}/{p.milestones?.length ?? 0} milestones
                  </span>
                  <span>
                    {done}/{total} tasks
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                  <div className="h-full bg-volt" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
                </div>
                <div className="mt-4 flex justify-between text-xs text-muted">
                  <span>{p.priority} priority</span>
                  <span>{p.deadline ? `Due ${p.deadline}` : "No deadline"}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
