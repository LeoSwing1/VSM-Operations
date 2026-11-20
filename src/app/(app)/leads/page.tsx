import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Field, Flash, PageHeader, Stat, TableWrap } from "@/components/ui";
import { fmtDateTime } from "@/lib/engines/time";
import { createLead } from "./actions";

export const metadata = { title: "CRM · Leads" };
const PIPE = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"];

export default async function Leads({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePerm("crm.view_all", "crm.manage");
  const sb = await supabaseServer();
  let q = sb.from("leads").select("id, name, company, email, phone, service_interest, source, status, priority, next_follow_up_at, duplicate_of, created_at, assignee:employees!leads_assigned_to_fkey(full_name)")
    .order("created_at", { ascending: false }).limit(300);
  if (sp.status) q = q.eq("status", sp.status);
  if (sp.q) { const s = sp.q.replace(/[%,()]/g, ""); q = q.or(`name.ilike.%${s}%,company.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`); }
  if (sp.due === "1") q = q.lte("next_follow_up_at", new Date().toISOString()).not("status", "in", "(WON,LOST)");
  const [{ data: leads }, { data: all }] = await Promise.all([q, sb.from("leads").select("status, source").is("duplicate_of", null)]);
  const count = (s: string) => (all ?? []).filter((l) => l.status === s).length;
  const closed = count("WON") + count("LOST");

  return (
    <>
      <PageHeader eyebrow="CRM" title="Leads">
        <Link href="/leads?due=1" className={sp.due ? "btn-primary" : "btn-ghost"}>Follow-ups due</Link>
      </PageHeader>
      <Flash sp={sp} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Open pipeline" value={(all ?? []).length - closed} />
        <Stat label="New (uncontacted)" value={count("NEW")} tone={count("NEW") ? "ember" : undefined} href="/leads?status=NEW" />
        <Stat label="Won" value={count("WON")} tone="volt" href="/leads?status=WON" />
        <Stat label="Win rate (closed)" value={closed ? `${Math.round((count("WON") / closed) * 100)}%` : "—"} />
      </div>
      <div className="my-6 flex flex-wrap gap-2">
        <Link href="/leads" className={!sp.status ? "btn-primary" : "btn-ghost"}>All</Link>
        {PIPE.map((s) => <Link key={s} href={`/leads?status=${s}`} className={sp.status === s ? "btn-primary" : "btn-ghost"}>{s.toLowerCase()} · {count(s)}</Link>)}
      </div>
      <details className="card mb-6 p-5"><summary className="eyebrow cursor-pointer">Add lead manually</summary>
        <form action={createLead} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Name"><input name="name" required className="input" /></Field>
          <Field label="Company"><input name="company" className="input" /></Field>
          <Field label="Email"><input name="email" type="email" className="input" /></Field>
          <Field label="Phone"><input name="phone" className="input" /></Field>
          <Field label="Service interest"><input name="service" className="input" placeholder="SEO, Social media, Website…" /></Field>
          <Field label="Source"><select name="source" className="input"><option value="REFERRAL">Referral</option><option value="CAMPAIGN">Campaign</option><option value="PROJECT_ENQUIRY">Project enquiry</option><option value="MANUAL">Manual</option><option value="OTHER">Other</option></select></Field>
          <Field label="Source detail"><input name="source_detail" className="input" placeholder="Referred by…" /></Field>
          <Field label="Notes" className="lg:col-span-4"><textarea name="description" rows={2} className="input" /></Field>
          <div><button className="btn-primary">Create lead</button></div>
        </form></details>
      <form className="mb-4"><input name="q" defaultValue={sp.q} className="input max-w-sm" placeholder="Search name, company, email, phone" /></form>
      <Card>
        {!leads?.length ? <Empty title="No leads" hint="Website enquiries land here automatically once the site form posts to /api/public/enquiry." /> : (
          <TableWrap><table className="table min-w-[860px]">
            <thead><tr><th>Lead</th><th>Service</th><th>Source</th><th>Owner</th><th>Status</th><th>Follow-up</th><th>Received</th></tr></thead>
            <tbody>{leads.map((l: any) => (
              <tr key={l.id}>
                <td><Link href={`/leads/${l.id}`} className="font-semibold hover:text-volt">{l.name}</Link>{l.duplicate_of && <span className="ml-2 text-[10px] text-ember">possible duplicate</span>}<p className="text-xs text-muted">{l.company ?? l.email ?? l.phone}</p></td>
                <td className="text-sm">{l.service_interest ?? "—"}</td><td className="text-xs">{l.source.replace("_", " ")}</td>
                <td className="text-sm text-muted">{l.assignee?.full_name ?? <span className="text-ember">Unassigned</span>}</td>
                <td><Badge>{l.status}</Badge></td>
                <td className={`text-xs ${l.next_follow_up_at && l.next_follow_up_at < new Date().toISOString() ? "text-danger" : ""}`}>{l.next_follow_up_at ? fmtDateTime(l.next_follow_up_at, ctx.timezone) : "—"}</td>
                <td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(l.created_at, ctx.timezone)}</td>
              </tr>))}</tbody>
          </table></TableWrap>)}
      </Card>
    </>
  );
}
