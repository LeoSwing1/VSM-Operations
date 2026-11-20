import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm, can } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Field, Flash, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/engines/time";
import { addActivity, convertLead, updateLead } from "../actions";

export const metadata = { title: "Lead" };

export default async function Lead({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requirePerm("crm.view_all", "crm.manage");
  const sb = await supabaseServer();
  const { data: l } = await sb.from("leads").select("*").eq("id", id).maybeSingle();
  if (!l) notFound();
  const [{ data: acts }, { data: dir }, { data: dup }] = await Promise.all([
    sb.from("lead_activities").select("id, kind, body, created_at, actor:employees!lead_activities_actor_id_fkey(full_name)").eq("lead_id", id).order("created_at", { ascending: false }),
    sb.from("employee_directory").select("id, full_name").order("full_name"),
    l.duplicate_of ? sb.from("leads").select("id, name, status, created_at").eq("id", l.duplicate_of).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const tz = ctx.timezone;
  const toLocal = (iso: string | null) => iso ? new Date(new Date(iso).getTime() + 330 * 60000).toISOString().slice(0, 16) : "";

  return (
    <>
      <PageHeader eyebrow={`${l.source.replace("_", " ")} · ${fmtDateTime(l.created_at, tz)}`} title={l.name}><Badge>{l.status}</Badge></PageHeader>
      <Flash sp={sp} />
      {dup && <p className="mb-6 rounded-xl border border-ember/50 bg-ember/10 px-4 py-3 text-sm text-ember">Same email/phone as <Link className="underline" href={`/leads/${dup.id}`}>{dup.name}</Link> ({dup.status}, {fmtDateTime(dup.created_at, tz)}).</p>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="space-y-6">
          <Card title="Details">
            <dl className="space-y-2 text-sm">
              {[["Company", l.company], ["Email", l.email && <a href={`mailto:${l.email}`} className="hover:text-volt">{l.email}</a>], ["Phone", l.phone && <a href={`tel:${l.phone}`} className="hover:text-volt">{l.phone}</a>],
                ["Service", l.service_interest], ["Page", l.source_detail], ["Message", l.description]].map(([k, v]) => (
                <div key={k as string}><dt className="text-xs text-muted">{k}</dt><dd className="whitespace-pre-wrap">{v || "—"}</dd></div>))}
            </dl>
          </Card>
          <Card title="Pipeline">
            <form action={updateLead} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="id" value={id} />
              <Field label="Status"><select name="status" defaultValue={l.status} className="input">{["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"].map((s) => <option key={s}>{s}</option>)}</select></Field>
              <Field label="Priority"><select name="priority" defaultValue={l.priority} className="input">{["LOW", "MEDIUM", "HIGH", "URGENT"].map((s) => <option key={s}>{s}</option>)}</select></Field>
              {can(ctx, "crm.assign") && <Field label="Owner"><select name="assigned_to" defaultValue={l.assigned_to ?? ""} className="input"><option value="">Unassigned</option>{(dir ?? []).map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}</select></Field>}
              <Field label="Next follow-up (IST)"><input type="datetime-local" name="follow_up" defaultValue={toLocal(l.next_follow_up_at)} className="input" /></Field>
              <Field label="Lost reason" className="sm:col-span-2"><input name="lost_reason" defaultValue={l.lost_reason ?? ""} className="input" /></Field>
              <div><button className="btn-primary">Save</button></div>
            </form>
            {can(ctx, "clients.manage") && !l.converted_client_id && (
              <form action={convertLead} className="mt-4 border-t border-line pt-4"><input type="hidden" name="id" value={id} /><button className="btn-ghost">Convert to client</button></form>)}
            {l.converted_client_id && <p className="mt-4 text-sm text-volt">Converted to client.</p>}
          </Card>
        </div>
        <Card title="Activity">
          <form action={addActivity} className="mb-5 flex flex-wrap gap-2">
            <input type="hidden" name="id" value={id} />
            <select name="kind" className="input w-28"><option>NOTE</option><option>CALL</option><option>EMAIL</option><option>MEETING</option></select>
            <input name="body" className="input min-w-[200px] flex-1" placeholder="What happened?" required />
            <button className="btn-ghost">Log</button>
          </form>
          <ol className="space-y-3">{(acts ?? []).map((a: any) => (
            <li key={a.id} className="border-l-2 border-line pl-3 text-sm">
              <p className="text-[11px] text-muted">{a.kind} · {a.actor?.full_name ?? "System"} · {fmtDateTime(a.created_at, tz)}</p>
              <p className="whitespace-pre-wrap">{a.body}</p>
            </li>))}</ol>
        </Card>
      </div>
    </>
  );
}
