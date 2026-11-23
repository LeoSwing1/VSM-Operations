import Link from "next/link";
import { can, requireContext, ROLES, ROLE_LABEL, type Role } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Field, Flash, PageHeader } from "@/components/ui";
import { savePost } from "./actions";

export const metadata = { title: "Company posts" };
const TEAM = { seo: "SEO Team", editing: "Editing Team", developers: "Developers Team" } as const;

export default async function Posts({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const [{ data: posts }, { data: depts }, { data: people }] = await Promise.all([
    sb.from("designations").select("*, department:departments(name)").eq("is_active", true).order("sort"),
    sb.from("departments").select("id, name").order("name"),
    sb.from("employee_directory").select("id, designation"),
  ]);
  const holders = (t: string) => (people ?? []).filter((p: any) => (p.designation ?? "").toLowerCase() === t.toLowerCase()).length;
  const byDept = new Map<string, any[]>();
  for (const p of posts ?? []) {
    const k = (p as any).department?.name ?? "Other";
    byDept.set(k, [...(byDept.get(k) ?? []), p]);
  }
  const manage = can(ctx, "people.manage");
  return (
    <>
      <PageHeader eyebrow="People · company workflow" title="Posts & responsibilities">
        <Link href="/people" className="btn-ghost">
          ← People
        </Link>
      </PageHeader>
      <Flash sp={sp} />
      <p className="mb-6 max-w-3xl text-sm text-muted">
        Every post sets the department, default role, team and reporting line. When someone is given a post — for example{" "}
        <b>SEO Executive</b> — they are placed in the SEO department, join the SEO Team and its chat group automatically.
      </p>
      <div className="space-y-8">
        {[...byDept.entries()].map(([dept, list]) => (
          <section key={dept}>
            <h2 className="eyebrow mb-3">{dept}</h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {list.map((p: any) => (
                <Card key={p.id} title={p.title} action={<span className="text-xs text-muted">{holders(p.title)} people</span>}>
                  <div className="mb-3 flex flex-wrap gap-1">
                    <Badge tone="grey">{ROLE_LABEL[p.default_role as Role]}</Badge>
                    {p.team_key && (
                      <Badge tone="green">
                        {TEAM[p.team_key as keyof typeof TEAM]}
                        {p.team_role === "LEAD" ? " · lead" : ""}
                      </Badge>
                    )}
                    {p.reports_to && <Badge tone="amber">Reports to {p.reports_to}</Badge>}
                  </div>
                  {!!p.responsibilities?.length && (
                    <ul className="list-disc space-y-0.5 pl-4 text-sm">
                      {p.responsibilities.map((r: string) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                  {!!p.kpis?.length && <p className="mt-3 text-xs text-muted">KPIs: {p.kpis.join(" · ")}</p>}
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
      {manage && (
        <Card title="Add or update a post" className="mt-8">
          <form action={savePost} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Title">
              <input name="title" required className="input" placeholder="e.g. Senior SEO Executive" />
            </Field>
            <Field label="Department">
              <select name="department_id" className="input">
                <option value="">—</option>
                {(depts ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Default role">
              <select name="default_role" className="input" defaultValue="EMPLOYEE">
                {ROLES.filter((r) => r !== "SUPER_ADMIN").map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Team">
              <select name="team_key" className="input">
                <option value="">No team</option>
                {Object.entries(TEAM).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Team role">
              <select name="team_role" className="input">
                <option value="MEMBER">Member</option>
                <option value="LEAD">Lead</option>
              </select>
            </Field>
            <Field label="Reports to (post)">
              <input name="reports_to" className="input" placeholder="SEO Manager" />
            </Field>
            <Field label="Responsibilities (one per line)" className="sm:col-span-2 lg:col-span-3">
              <textarea name="responsibilities" rows={3} className="input" />
            </Field>
            <Field label="KPIs (one per line)" className="sm:col-span-2 lg:col-span-3">
              <textarea name="kpis" rows={2} className="input" />
            </Field>
            <div>
              <button className="btn-primary">Save post</button>
            </div>
          </form>
        </Card>
      )}
    </>
  );
}
