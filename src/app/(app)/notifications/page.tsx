import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Empty, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/engines/time";
import clsx from "clsx";

export const metadata = { title: "Notifications" };

async function markAll() {
  "use server";
  const ctx = await requireContext();
  const sb = await supabaseServer();
  await sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("recipient_id", ctx.employee_id).is("read_at", null);
  revalidatePath("/", "layout");
}
async function markOne(fd: FormData) {
  "use server";
  await requireContext();
  const sb = await supabaseServer();
  await sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", String(fd.get("id")));
  revalidatePath("/", "layout");
}

export default async function Notifications({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();
  let q = sb.from("notifications").select("id, category, title, body, link, read_at, created_at").order("created_at", { ascending: false }).limit(100);
  if (sp.unread === "1") q = q.is("read_at", null);
  if (sp.category) q = q.eq("category", sp.category);
  const { data } = await q;
  const cats = ["TASKS", "LEAVE", "PAYROLL", "CRM", "ATTENDANCE"];
  return (
    <>
      <PageHeader eyebrow="Inbox" title="Notifications">
        <form action={markAll}><button className="btn-ghost">Mark all read</button></form>
      </PageHeader>
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/notifications" className={!sp.category && !sp.unread ? "btn-primary" : "btn-ghost"}>All</Link>
        <Link href="/notifications?unread=1" className={sp.unread ? "btn-primary" : "btn-ghost"}>Unread</Link>
        {cats.map((c) => <Link key={c} href={`/notifications?category=${c}`} className={sp.category === c ? "btn-primary" : "btn-ghost"}>{c.toLowerCase()}</Link>)}
      </div>
      <Card>
        {!data?.length ? <Empty title="You're all caught up" /> : <ul className="divide-y divide-line">{data.map((n) => (
          <li key={n.id} className={clsx("flex flex-wrap items-start justify-between gap-3 py-3", !n.read_at && "font-semibold")}>
            <div className="min-w-0">
              <p className="text-sm">{!n.read_at && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-volt" aria-label="unread" />}
                {n.link ? <Link href={n.link} className="hover:text-volt">{n.title}</Link> : n.title}</p>
              {n.body && <p className="mt-0.5 text-xs font-normal text-muted">{n.body}</p>}
              <p className="mt-0.5 text-[11px] font-normal text-muted">{n.category} · {fmtDateTime(n.created_at, ctx.timezone)}</p>
            </div>
            {!n.read_at && <form action={markOne}><input type="hidden" name="id" value={n.id} /><button className="text-xs font-normal text-muted hover:text-ink">Mark read</button></form>}
          </li>))}</ul>}
      </Card>
    </>
  );
}
