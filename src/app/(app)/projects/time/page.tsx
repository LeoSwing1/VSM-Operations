import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Field, Flash, PageHeader, TableWrap } from "@/components/ui";
import { decideProjectTime } from "../actions";
import { DecisionButtons } from "@/components/decision-buttons";
export const metadata = { title: "Project time approvals" };
export default async function ProjectTime({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await requirePerm("projects.time_approve", "projects.manage");
  const sb = await supabaseServer();
  const [{ data }, { data: directory }] = await Promise.all([
    sb
      .from("project_time_entries")
      .select("id,work_date,hours,notes,status,billable,employee_id,project:projects(id,name)")
      .order("created_at", { ascending: false })
      .limit(250),
    sb.from("employee_directory").select("id,full_name"),
  ]);
  const pending = (data ?? []).filter((x: any) => x.status === "SUBMITTED");
  return (
    <>
      <PageHeader eyebrow="Delivery operations" title="Time approvals">
        <Link href="/projects" className="btn-ghost">
          Projects
        </Link>
      </PageHeader>
      <Flash sp={sp} />
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Card>
          <p className="eyebrow">Awaiting review</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{pending.length}</p>
        </Card>
        <Card>
          <p className="eyebrow">Submitted hours</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {pending.reduce((n: number, x: any) => n + Number(x.hours), 0).toFixed(2)}h
          </p>
        </Card>
      </div>
      {!data?.length ? (
        <Empty title="No time entries" hint="Submitted project hours will appear here." />
      ) : (
        <Card>
          <TableWrap>
            <table className="table min-w-[760px]">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Project</th>
                  <th>Date</th>
                  <th>Hours</th>
                  <th>Notes</th>
                  <th>Status</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {data.map((t: any) => (
                  <tr key={t.id}>
                    <td>{directory?.find((e: any) => e.id === t.employee_id)?.full_name ?? "—"}</td>
                    <td>{t.project?.name ?? "—"}</td>
                    <td>{t.work_date}</td>
                    <td className="tabular-nums">{Number(t.hours).toFixed(2)}</td>
                    <td className="max-w-56 truncate">{t.notes}</td>
                    <td>
                      <Badge>{t.status}</Badge>
                    </td>
                    <td>
                      {t.status === "SUBMITTED" ? (
                        <form action={decideProjectTime} className="flex flex-wrap gap-1">
                          <input type="hidden" name="id" value={t.id} />
                          <DecisionButtons
                            small
                            choices={[
                              { value: "approve", label: "Approve", className: "btn-primary" },
                              { value: "reject", label: "Reject", className: "btn-ghost" },
                            ]}
                          />
                        </form>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}
    </>
  );
}
