import Link from "next/link";
import { requirePerm, can, canAny } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Bars, Card, Empty, PageHeader, Stat, inr } from "@/components/ui";
import { localDate, zonedInstant } from "@/lib/engines/time";

export const metadata = { title: "Executive overview" };
export const dynamic = "force-dynamic";

function validDate(value: string | undefined, fallback: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : fallback;
}
function monthStart(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default async function ExecutivePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePerm("executive.view");
  const sp = await searchParams;
  const today = localDate(new Date(), ctx.timezone);
  const start = validDate(sp.from, monthStart(new Date(`${today}T12:00:00`)));
  const end = validDate(sp.to, today);
  const validRange = start <= end;
  const from = validRange ? start : monthStart(new Date(`${today}T12:00:00`));
  const to = validRange ? end : today;
  const fromIso = zonedInstant(from, "00:00", ctx.timezone).toISOString();
  const toIso = zonedInstant(to, "23:59:59", ctx.timezone).toISOString();
  const sb = await supabaseServer();
  const finance = can(ctx, "finance.view");
  const people = can(ctx, "people.view_all");
  const crm = canAny(ctx, ["crm.view_all", "crm.manage"]);

  const [employees, departments, projects, tasks, invoices, receipts, expenses, newLeads, overdueTasks] = await Promise.all([
    people ? sb.from("employees").select("id,status,department_id").neq("status", "EXITED") : Promise.resolve({ data: null }),
    people ? sb.from("departments").select("id,name") : Promise.resolve({ data: null }),
    can(ctx, "projects.view_all")
      ? sb.from("projects").select("id,name,status,deadline,priority").neq("status", "CANCELLED")
      : Promise.resolve({ data: null }),
    can(ctx, "tasks.view_all")
      ? sb.from("tasks").select("id,status,created_at,completed_at").gte("created_at", fromIso).lte("created_at", toIso)
      : Promise.resolve({ data: null }),
    finance
      ? sb
          .from("client_invoices")
          .select("id,status,total_amount,issue_date,due_date")
          .gte("issue_date", from)
          .lte("issue_date", to)
          .neq("status", "VOID")
      : Promise.resolve({ data: null }),
    finance
      ? sb.from("invoice_payments").select("amount,paid_on").gte("paid_on", from).lte("paid_on", to)
      : Promise.resolve({ data: null }),
    finance
      ? sb.from("finance_expenses").select("amount,paid_on").eq("status", "PAID").gte("paid_on", from).lte("paid_on", to)
      : Promise.resolve({ data: null }),
    crm
      ? sb.from("leads").select("id,status,created_at").gte("created_at", fromIso).lte("created_at", toIso).is("duplicate_of", null)
      : Promise.resolve({ data: null }),
    can(ctx, "tasks.view_all")
      ? sb
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .not("status", "in", "(COMPLETED,CANCELLED)")
          .lt("deadline", new Date().toISOString())
      : Promise.resolve({ count: null }),
  ]);

  const activePeople = employees.data?.length ?? null;
  const activeProjects = projects.data?.filter((p) => p.status === "ACTIVE").length ?? null;
  const completedProjects = projects.data?.filter((p) => p.status === "COMPLETED").length ?? null;
  const taskRows = tasks.data ?? [];
  const doneTasks = taskRows.filter((t) => t.status === "COMPLETED").length;
  const revenue = (receipts.data ?? []).reduce((sum, x) => sum + Number(x.amount), 0);
  const spend = (expenses.data ?? []).reduce((sum, x) => sum + Number(x.amount), 0);
  const invoiced = (invoices.data ?? []).reduce((sum, x) => sum + Number(x.total_amount), 0);
  const deptBars = (departments.data ?? []).map((d) => ({
    label: d.name,
    value: (employees.data ?? []).filter((e) => e.department_id === d.id).length,
  }));
  const leadRows = newLeads.data ?? [];
  const overdueCount = overdueTasks.count ?? 0;

  return (
    <>
      <PageHeader eyebrow="Leadership workspace · organisation-wide view" title="Executive overview">
        <Link href={`/executive/export?from=${from}&to=${to}`} className="btn btn-secondary">
          Export CSV ↓
        </Link>
      </PageHeader>
      <form className="card mb-6 flex flex-wrap items-end gap-3 p-4" method="get">
        <label className="field">
          <span className="label">From</span>
          <input className="input" type="date" name="from" defaultValue={from} />
        </label>
        <label className="field">
          <span className="label">To</span>
          <input className="input" type="date" name="to" defaultValue={to} />
        </label>
        <button className="btn btn-primary" type="submit">
          Apply period
        </button>
        {!validRange && <p className="text-sm text-danger">The end date must be on or after the start date.</p>}
        <p className="ml-auto text-xs text-muted">
          Reporting period: {from} – {to}
        </p>
      </form>

      <h2 className="eyebrow mb-3">Organisation health</h2>
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Active people"
          value={activePeople ?? "—"}
          hint={people ? "Current workforce" : "People access required"}
          href={people ? "/people" : undefined}
        />
        <Stat
          label="Active projects"
          value={activeProjects ?? "—"}
          hint={projects.data ? `${completedProjects} completed overall` : "Project access required"}
          href={projects.data ? "/projects" : undefined}
        />
        <Stat
          label="Tasks created"
          value={tasks.data?.length ?? "—"}
          hint={tasks.data ? `${doneTasks} completed in period` : "Task access required"}
          href={tasks.data ? "/tasks" : undefined}
        />
        <Stat
          label="Overdue open tasks"
          value={can(ctx, "tasks.view_all") ? overdueCount : "—"}
          tone={overdueCount ? "danger" : undefined}
          href={can(ctx, "tasks.view_all") ? "/tasks?view=overdue" : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {people && (
          <Card title="Workforce by department">
            {deptBars.length ? <Bars data={deptBars} label="Active workforce by department" /> : <Empty title="No department data" />}
          </Card>
        )}
        {projects.data && (
          <Card title="Delivery portfolio">
            <div className="grid grid-cols-3 gap-3">
              {(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED"] as const).map((s) => (
                <div key={s}>
                  <p className="display text-3xl">{projects.data?.filter((p) => p.status === s).length ?? 0}</p>
                  <p className="text-xs text-muted">{s.replaceAll("_", " ")}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 space-y-2">
              {projects.data
                .filter((p) => p.status === "ACTIVE" || p.status === "ON_HOLD")
                .slice(0, 6)
                .map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 border-t border-line pt-2 text-sm">
                    <span className="truncate">{p.name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted">{p.deadline ?? "No deadline"}</span>
                      <Badge>{p.status}</Badge>
                    </span>
                  </div>
                ))}
            </div>
          </Card>
        )}
        {finance && (
          <Card title="Financial performance · cash basis">
            <p className="text-xs text-muted">
              Based on payments recorded within the selected period. Payroll is intentionally excluded from this view.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="eyebrow">Client receipts</p>
                <p className="display mt-2 text-3xl text-volt">{inr(revenue)}</p>
              </div>
              <div>
                <p className="eyebrow">Paid expenses</p>
                <p className="display mt-2 text-3xl">{inr(spend)}</p>
              </div>
              <div>
                <p className="eyebrow">Net cash movement*</p>
                <p className="display mt-2 text-3xl">{inr(revenue - spend)}</p>
              </div>
              <div>
                <p className="eyebrow">Invoices issued</p>
                <p className="display mt-2 text-3xl">{inr(invoiced)}</p>
              </div>
            </div>
            <p className="mt-4 text-[11px] text-muted">
              *Client receipts less recorded employee/company expense payments. Excludes payroll, vendor payments not recorded as expenses,
              tax liabilities and bank fees.
            </p>
            <Link href="/finance/reports" className="mt-4 inline-block text-sm underline">
              Open finance reports →
            </Link>
          </Card>
        )}
        {crm && (
          <Card title="CRM pipeline · period">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="display text-3xl">{leadRows.length}</p>
                <p className="text-xs text-muted">New leads</p>
              </div>
              <div>
                <p className="display text-3xl">
                  {leadRows.filter((l) => ["QUALIFIED", "PROPOSAL", "NEGOTIATION"].includes(l.status)).length}
                </p>
                <p className="text-xs text-muted">Qualified+</p>
              </div>
              <div>
                <p className="display text-3xl text-volt">{leadRows.filter((l) => l.status === "WON").length}</p>
                <p className="text-xs text-muted">Won</p>
              </div>
            </div>
            <Link href="/leads" className="mt-4 inline-block text-sm underline">
              Open CRM →
            </Link>
          </Card>
        )}
      </div>
      <p className="mt-8 text-xs text-muted">
        Access is permission-scoped. Each section is queried independently under your organisation's database policies; financial figures
        require Finance access.
      </p>
    </>
  );
}
