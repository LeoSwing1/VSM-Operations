import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Field, PageHeader, Stat, TableWrap } from "@/components/ui";
import { fmtDateTime, localDate } from "@/lib/engines/time";
import { AREAS, areaFilter, areaOf, describeEvent, sourceLabel } from "@/lib/audit-labels";

export const metadata = { title: "Audit log" };
const PAGE = 100;
const isDay = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** IST day bounds → UTC ISO strings. */
const dayStart = (d: string) => new Date(`${d}T00:00:00+05:30`).toISOString();
const dayEnd = (d: string) => new Date(new Date(`${d}T00:00:00+05:30`).getTime() + 86_400_000).toISOString();

export default async function Audit({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePerm("audit.view");
  const sb = await supabaseServer();
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const area = AREAS.find((a) => a.key === sp.area);
  const who = sp.who && /^[0-9a-f-]{36}$/.test(sp.who) ? sp.who : sp.who === "system" || sp.who === "integration" ? sp.who : "";
  const from = isDay(sp.from) ? sp.from! : "";
  const to = isDay(sp.to) ? sp.to! : "";
  const q = (sp.q ?? "")
    .replace(/[%_,()*]/g, " ")
    .trim()
    .slice(0, 60);

  let query = sb
    .from("audit_events")
    .select("id, action, entity, entity_id, metadata, created_at, actor_employee_id, actor:employees!actor_employee_id(id, full_name)", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(page * PAGE, page * PAGE + PAGE - 1);
  if (area) query = query.or(areaFilter(area));
  if (who === "system") query = query.is("actor_employee_id", null).or("metadata->>source.is.null,metadata->>source.neq.integration");
  else if (who === "integration") query = query.eq("metadata->>source", "integration");
  else if (who) query = query.eq("actor_employee_id", who);
  if (from) query = query.gte("created_at", dayStart(from));
  if (to) query = query.lt("created_at", dayEnd(to));
  if (q) query = query.or(`action.ilike.%${q}%,entity.ilike.%${q}%,entity_id.ilike.%${q}%`);

  const today = localDate(new Date(), ctx.timezone);
  const [{ data, count, error }, { data: people }, todayCount, signins, failed] = await Promise.all([
    query,
    sb.from("employee_directory").select("id, full_name").order("full_name"),
    sb.from("audit_events").select("id", { count: "exact", head: true }).gte("created_at", dayStart(today)),
    sb.from("audit_events").select("id", { count: "exact", head: true }).eq("action", "auth.sign_in").gte("created_at", dayStart(today)),
    sb
      .from("audit_events")
      .select("id", { count: "exact", head: true })
      .eq("action", "auth.sign_in_failed")
      .gte("created_at", dayStart(today)),
  ]);

  const params = (patch: Record<string, string | number>) => {
    const p = new URLSearchParams();
    const base: Record<string, string> = { area: area?.key ?? "", who, from, to, q };
    for (const [k, v] of Object.entries({ ...base, ...patch })) if (v !== "" && v !== 0) p.set(k, String(v));
    return p.toString();
  };

  return (
    <>
      <PageHeader eyebrow="Admin · every action on the platform · read-only" title="Audit log">
        <a href={`/api/audit/export?${params({})}`} className="btn-ghost">
          Download CSV
        </a>
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Events today" value={todayCount.count ?? 0} />
        <Stat label="Sign-ins today" value={signins.count ?? 0} href={`?${params({ area: "auth" })}`} />
        <Stat
          label="Failed sign-ins today"
          value={failed.count ?? 0}
          tone={(failed.count ?? 0) > 0 ? "ember" : undefined}
          href={`?${params({ area: "auth" })}`}
        />
        <Stat label="Matching filters" value={count ?? 0} />
      </div>

      <form className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_150px_150px_1fr_auto] lg:items-end">
        <Field label="Area">
          <select name="area" defaultValue={area?.key ?? ""} className="input">
            <option value="">Everything</option>
            {AREAS.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Done by">
          <select name="who" defaultValue={who} className="input">
            <option value="">Anyone</option>
            <option value="integration">Integrations & cron jobs</option>
            <option value="system">System (automatic)</option>
            {(people ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <input type="date" name="from" defaultValue={from} className="input" />
        </Field>
        <Field label="To">
          <input type="date" name="to" defaultValue={to} className="input" />
        </Field>
        <Field label="Search">
          <input name="q" defaultValue={q} className="input" placeholder="payroll, leads, an ID…" />
        </Field>
        <div className="flex gap-2">
          <button className="btn-primary">Filter</button>
          <Link href="/settings/audit-logs" className="btn-ghost">
            Clear
          </Link>
        </div>
      </form>

      <Card>
        {error ? (
          <p className="text-sm text-danger">The log could not load: {error.message}</p>
        ) : !data?.length ? (
          <Empty title="No activity matches" hint="Try a wider date range or clear the filters." />
        ) : (
          <TableWrap>
            <table className="table min-w-[860px]">
              <thead>
                <tr>
                  <th>When (IST)</th>
                  <th>Who</th>
                  <th>What happened</th>
                  <th>Area</th>
                  <th>Record</th>
                </tr>
              </thead>
              <tbody>
                {data.map((a: any) => {
                  const src = sourceLabel(a.metadata, !!a.actor_employee_id);
                  const ar = areaOf(a.action, a.entity);
                  return (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap text-xs">{fmtDateTime(a.created_at, ctx.timezone)}</td>
                      <td className="text-sm">
                        {a.actor ? (
                          <Link href={`?${params({ who: a.actor.id, page: 0 })}`} className="hover:text-volt">
                            {a.actor.full_name}
                          </Link>
                        ) : (
                          <Badge tone={src === "Integration" ? "blue" : undefined}>{src.toUpperCase()}</Badge>
                        )}
                      </td>
                      <td className="text-sm">
                        {describeEvent(a.action, a.entity, a.metadata)}
                        {a.metadata?.ip && <span className="text-xs text-muted"> · IP {String(a.metadata.ip)}</span>}
                      </td>
                      <td className="text-xs text-muted">{ar?.label ?? "Other"}</td>
                      <td className="font-mono text-[10px] text-muted" title={`${a.action} · ${JSON.stringify(a.metadata)}`}>
                        {a.entity}
                        {a.entity_id ? ` · ${String(a.entity_id).slice(0, 8)}` : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        <div className="mt-4 flex justify-between text-sm">
          {page > 0 ? (
            <Link href={`?${params({ page: page - 1 })}`} className="hover:text-volt">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          {(count ?? 0) > (page + 1) * PAGE && (
            <Link href={`?${params({ page: page + 1 })}`} className="hover:text-volt">
              Older →
            </Link>
          )}
        </div>
      </Card>
      <p className="mt-4 text-xs text-muted">
        The log records who did what and when — never message text, documents or salary figures. Entries cannot be edited or deleted.
      </p>
    </>
  );
}
