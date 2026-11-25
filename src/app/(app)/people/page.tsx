import Link from "next/link";
import { requirePerm, can, ROLE_LABEL, type Role } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Field, Flash, PageHeader, TableWrap } from "@/components/ui";
import { createDepartment, createEmployee } from "./actions";
import { EmployeeFields } from "./employee-form";
import { addMode, assignableRoles } from "@/lib/data/roles";
import { firstSalaryDate, longDate, ordinal } from "@/lib/engines/salary-day";

export const metadata = { title: "People" };

export default async function People({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePerm("people.view_all", "people.view_team");
  const sb = await supabaseServer();
  const manage = can(ctx, "people.manage");
  const adding = addMode(ctx); // "all" (HR Manager/Admin), "juniors" (HR post), "team" (managers), or null
  let query = sb
    .from("employees")
    .select(
      "id, employee_code, full_name, designation, role, status, user_id, joining_date, salary_day, department:departments!department_id(name), manager:employees!manager_id(full_name)",
    )
    .order("full_name");
  if (sp.q) query = query.or(`full_name.ilike.%${sp.q.replace(/[%,()]/g, "")}%,employee_code.ilike.%${sp.q.replace(/[%,()]/g, "")}%`);
  if (sp.dept) query = query.eq("department_id", sp.dept);
  if (sp.status === "ALL") {
    /* everyone, including exited */
  } else if (sp.status) query = query.eq("status", sp.status);
  else query = query.neq("status", "EXITED");
  const [
    { data: people, error: listErr },
    { data: depts },
    { data: shifts },
    { data: dir },
    assignable,
    { data: posts },
    { data: nextCode },
  ] = await Promise.all([
    query,
    sb.from("departments").select("id, name").order("name"),
    sb.from("shifts").select("id, name"),
    sb.from("employee_directory").select("id, full_name").order("full_name"),
    assignableRoles(sb, ctx),
    sb.from("designations").select("title").eq("is_active", true).order("sort"),
    sb.rpc("next_employee_code", { p_org: ctx.org_id }),
  ]);
  // Teams this person may add someone into (RLS on org_team_members still decides).
  const { data: myTeams } = adding ? await sb.rpc("my_manageable_teams") : { data: [] as { id: string; name: string }[] };

  return (
    <>
      <PageHeader eyebrow="Employee 360" title="People">
        <Link href="/people/posts" className="btn-ghost">
          Posts & teams
        </Link>
        {adding && (
          <Link href={sp.new ? "/people" : "/people?new=1"} className="btn-primary">
            {sp.new ? "Close" : "Add employee"}
          </Link>
        )}
      </PageHeader>
      <Flash sp={sp} />
      {sp.dup && /^[0-9a-f-]{36}$/.test(sp.dup) && (
        <p className="-mt-3 mb-6 text-sm">
          <Link href={`/people/${sp.dup}`} className="btn-ghost">
            Open the existing profile →
          </Link>
        </p>
      )}
      {listErr && (
        <p role="alert" className="mb-6 rounded-xl border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
          The people list could not load: {listErr.message}
        </p>
      )}

      {adding && sp.new && (
        <Card
          title="New employee"
          className="mb-6"
          hint={
            adding === "team"
              ? "You can add executives, employees and interns to your own team. HR adds managers."
              : adding === "juniors"
                ? "You can add executives, employees and interns. The HR Manager adds managers."
                : undefined
          }
        >
          <form action={createEmployee} className="space-y-4">
            <EmployeeFields
              departments={(depts ?? []) as any}
              managers={(adding === "team" ? (dir ?? []).filter((d) => d.id === ctx.employee_id) : (dir ?? [])).map((d) => ({
                id: d.id,
                name: d.full_name,
              }))}
              shifts={(shifts ?? []) as any}
              assignable={assignable}
              posts={(posts ?? []).map((x) => x.title)}
              nextCode={typeof nextCode === "string" ? `Auto: ${nextCode}` : undefined}
              canSetSalary={can(ctx, "people.salary_day")}
            />
            {(myTeams ?? []).length > 0 && (
              <Field label="Add to team (optional)">
                <select name="team_id" className="input" defaultValue={(myTeams ?? []).length === 1 ? (myTeams ?? [])[0]!.id : ""}>
                  <option value="">—</option>
                  {(myTeams ?? []).map((t: { id: string; name: string }) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <fieldset className="space-y-1.5 rounded-xl border border-line p-3 text-sm">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">Welcome email</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="welcome" value="password" defaultChecked /> Send Employee ID, login email + a temporary password
                (changed at first sign-in)
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="welcome" value="link" /> Send details + a set-password link instead
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="welcome" value="none" /> Don&apos;t create a login yet
              </label>
              <p className="text-xs text-muted">
                The email includes their name, Employee ID, login email, post, department, team, manager and joining date. A KYC request is
                sent to their chat automatically.
              </p>
            </fieldset>
            <button className="btn-primary">Create employee</button>
          </form>
        </Card>
      )}

      <form className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="Search" className="min-w-[200px] flex-1">
          <input name="q" defaultValue={sp.q} className="input" placeholder="Name or employee ID" />
        </Field>
        <Field label="Department">
          <select name="dept" defaultValue={sp.dept ?? ""} className="input">
            <option value="">All</option>
            {(depts ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select name="status" defaultValue={sp.status ?? ""} className="input">
            <option value="">Current</option>
            <option value="ALL">All (incl. exited)</option>
            {["ACTIVE", "PROBATION", "NOTICE", "ON_LEAVE", "EXITED"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <button className="btn-ghost">Filter</button>
      </form>

      {(manage || adding) &&
        (() => {
          const now = Date.now();
          const joiners = (people ?? [])
            .filter((p: any) => p.joining_date && p.status !== "EXITED")
            .filter((p: any) => {
              const t = new Date(p.joining_date + "T00:00:00Z").getTime();
              return t >= now - 45 * 86_400_000 && t <= now + 90 * 86_400_000;
            })
            .sort((a: any, b: any) => (a.joining_date < b.joining_date ? 1 : -1))
            .slice(0, 12);
          if (!joiners.length) return null;
          return (
            <Card
              title="New joiners"
              hint="Joining in the next 90 days or in the last 45. Salary date = joining date + 7 days unless HR set another day."
              className="mb-6"
            >
              <TableWrap>
                <table className="table min-w-[620px]">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Joining date</th>
                      <th>Salary date</th>
                      <th>First salary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {joiners.map((p: any) => (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/people/${p.id}?tab=onboarding`} className="font-semibold hover:text-volt">
                            {p.full_name}
                          </Link>
                          <span className="ml-2 text-xs text-muted">{p.designation ?? ""}</span>
                        </td>
                        <td className="whitespace-nowrap">{longDate(p.joining_date)}</td>
                        <td className="whitespace-nowrap">{p.salary_day ? `${ordinal(p.salary_day)} of every month` : "—"}</td>
                        <td className="whitespace-nowrap font-semibold">
                          {p.salary_day ? longDate(firstSalaryDate(p.salary_day, p.joining_date)) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </Card>
          );
        })()}

      <Card>
        {(people ?? []).length === 0 ? (
          <Empty
            title="No one here yet"
            hint={
              manage
                ? "Nobody matches this filter. Try Status → All (incl. exited), or add your first employee above."
                : "No employees in your scope match this filter."
            }
          />
        ) : (
          <TableWrap>
            <table className="table min-w-[900px]">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Designation</th>
                  <th>Department</th>
                  <th>Manager</th>
                  <th>Role</th>
                  <th>Joined</th>
                  <th>Salary date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {people!.map((p: any) => (
                  <tr key={p.id}>
                    <td className="font-mono text-xs">{p.employee_code}</td>
                    <td>
                      <Link href={`/people/${p.id}`} className="font-semibold hover:text-volt">
                        {p.full_name}
                      </Link>
                      {!p.user_id && <span className="ml-2 text-[10px] text-ember">no login</span>}
                    </td>
                    <td className="text-muted">{p.designation ?? "—"}</td>
                    <td>{p.department?.name ?? "—"}</td>
                    <td className="text-muted">{p.manager?.full_name ?? "—"}</td>
                    <td className="text-xs">{ROLE_LABEL[p.role as Role]}</td>
                    <td className="whitespace-nowrap text-xs">{p.joining_date ? longDate(p.joining_date) : "—"}</td>
                    <td className="whitespace-nowrap text-xs">{p.salary_day ? `${ordinal(p.salary_day)} monthly` : "—"}</td>
                    <td>
                      <Badge>{p.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {manage && (
        <Card title="Departments" className="mt-6">
          <div className="mb-4 flex flex-wrap gap-2">
            {(depts ?? []).map((d) => (
              <span key={d.id} className="chip border-line">
                {d.name}
              </span>
            ))}
          </div>
          <form action={createDepartment} className="flex flex-wrap gap-2">
            <input name="name" className="input max-w-xs" placeholder="e.g. Content Production" required />
            <button className="btn-ghost">Add department</button>
          </form>
        </Card>
      )}
    </>
  );
}
