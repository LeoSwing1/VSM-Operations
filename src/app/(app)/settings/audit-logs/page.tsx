import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Empty, Field, PageHeader, TableWrap } from "@/components/ui";
import { fmtDateTime } from "@/lib/engines/time";

export const metadata = { title: "Audit log" };
const PAGE = 50;

export default async function Audit({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePerm("audit.view");
  const sb = await supabaseServer();
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  let q = sb.from("audit_events").select("id, action, entity, entity_id, metadata, created_at, actor:employees!audit_events_actor_employee_id_fkey(full_name)", { count: "exact" })
    .order("created_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
  if (sp.action) q = q.ilike("action", `${sp.action.replace(/[%_]/g, "")}%`);
  const { data, count } = await q;
  const qs = (p: number) => `?page=${p}${sp.action ? `&action=${encodeURIComponent(sp.action)}` : ""}`;
  return (
    <>
      <PageHeader eyebrow={`${count ?? 0} events · immutable`} title="Audit log" />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="Action starts with"><input name="action" defaultValue={sp.action} className="input" placeholder="salary. / payroll. / employee." /></Field>
        <button className="btn-ghost">Filter</button>
      </form>
      <Card>
        {!data?.length ? <Empty title="No events" /> : <TableWrap><table className="table min-w-[760px]">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
          <tbody>{data.map((a: any) => (
            <tr key={a.id}><td className="whitespace-nowrap text-xs">{fmtDateTime(a.created_at, ctx.timezone)}</td><td className="text-sm">{a.actor?.full_name ?? "System"}</td>
              <td className="font-mono text-xs">{a.action}</td><td className="text-xs text-muted">{a.entity}{a.entity_id ? ` · ${String(a.entity_id).slice(0, 8)}` : ""}</td>
              <td className="max-w-md truncate font-mono text-[10px] text-muted" title={JSON.stringify(a.metadata)}>{JSON.stringify(a.metadata)}</td></tr>))}</tbody>
        </table></TableWrap>}
        <div className="mt-4 flex justify-between text-sm">
          {page > 0 ? <Link href={qs(page - 1)} className="hover:text-volt">← Newer</Link> : <span />}
          {(count ?? 0) > (page + 1) * PAGE && <Link href={qs(page + 1)} className="hover:text-volt">Older →</Link>}
        </div>
      </Card>
    </>
  );
}
