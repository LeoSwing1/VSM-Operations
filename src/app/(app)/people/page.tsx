import Link from "next/link";
import { requirePerm, can, ROLE_LABEL, type Role } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Field, Flash, PageHeader, TableWrap } from "@/components/ui";
import { createDepartment, createEmployee } from "./actions";
import { EmployeeFields } from "./employee-form";
import { assignableRoles } from "@/lib/data/roles";

export const metadata = { title: "People" };

export default async function People({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePerm("people.view_all", "people.view_team");
  const sb = await supabaseServer();
  const manage = can(ctx, "people.manage");
  let query = sb.from("employees").select("id, employee_code, full_name, designation, role, status, user_id, department:departments(name), manager:employees!employees_manager_id_fkey(full_name)").order("full_name");
  if (sp.q) query = query.or(`full_name.ilike.%${sp.q.replace(/[%,()]/g, "")}%,employee_code.ilike.%${sp.q.replace(/[%,()]/g, "")}%`);
  if (sp.dept) query = query.eq("department_id", sp.dept);
  if (sp.status) query = query.eq("status", sp.status); else query = query.neq("status", "EXITED");
  const [{ data: people }, { data: depts }, { data: shifts }, { data: dir }, assignable] = await Promise.all([
    query, sb.from("departments").select("id, name").order("name"), sb.from("shifts").select("id, name"),
    sb.from("employee_directory").select("id, full_name").order("full_name"), assignableRoles(sb, ctx),
  ]);

  return (
    <>
      <PageHeader eyebrow="Employee 360" title="People">
        {manage && <Link href={sp.new ? "/people" : "/people?new=1"} className="btn-primary">{sp.new ? "Close" : "Add employee"}</Link>}
      </PageHeader>
      <Flash sp={sp} />

      {manage && sp.new && (
        <Card title="New employee" className="mb-6">
          <form action={createEmployee} className="space-y-4">
            <EmployeeFields departments={(depts ?? []) as any} managers={(dir ?? []).map((d) => ({ id: d.id, name: d.full_name }))}
              shifts={(shifts ?? []) as any} assignable={assignable} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="invite" defaultChecked /> Email a sign-in invitation now</label>
            <button className="btn-primary">Create employee</button>
          </form>
        </Card>
      )}

      <form className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="Search" className="min-w-[200px] flex-1"><input name="q" defaultValue={sp.q} className="input" placeholder="Name or employee ID" /></Field>
        <Field label="Department"><select name="dept" defaultValue={sp.dept ?? ""} className="input"><option value="">All</option>
          {(depts ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        <Field label="Status"><select name="status" defaultValue={sp.status ?? ""} className="input"><option value="">Current</option>
          {["ACTIVE", "PROBATION", "NOTICE", "ON_LEAVE", "EXITED"].map((s) => <option key={s}>{s}</option>)}</select></Field>
        <button className="btn-ghost">Filter</button>
      </form>

      <Card>
        {(people ?? []).length === 0 ? <Empty title="No one here yet" hint={manage ? "Add your first employee above." : "No employees in your scope match this filter."} /> : (
          <TableWrap>
            <table className="table min-w-[720px]">
              <thead><tr><th>ID</th><th>Name</th><th>Designation</th><th>Department</th><th>Manager</th><th>Role</th><th>Status</th></tr></thead>
              <tbody>
                {people!.map((p: any) => (
                  <tr key={p.id}>
                    <td className="font-mono text-xs">{p.employee_code}</td>
                    <td><Link href={`/people/${p.id}`} className="font-semibold hover:text-volt">{p.full_name}</Link>{!p.user_id && <span className="ml-2 text-[10px] text-ember">no login</span>}</td>
                    <td className="text-muted">{p.designation ?? "—"}</td>
                    <td>{p.department?.name ?? "—"}</td>
                    <td className="text-muted">{p.manager?.full_name ?? "—"}</td>
                    <td className="text-xs">{ROLE_LABEL[p.role as Role]}</td>
                    <td><Badge>{p.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {manage && (
        <Card title="Departments" className="mt-6">
          <div className="mb-4 flex flex-wrap gap-2">{(depts ?? []).map((d) => <span key={d.id} className="chip border-line">{d.name}</span>)}</div>
          <form action={createDepartment} className="flex flex-wrap gap-2">
            <input name="name" className="input max-w-xs" placeholder="e.g. Content Production" required />
            <button className="btn-ghost">Add department</button>
          </form>
        </Card>
      )}
    </>
  );
}
