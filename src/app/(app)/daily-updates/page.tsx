import Link from "next/link";
import { requireContext, canAny } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Empty, Field, Flash, PageHeader } from "@/components/ui";
import { fmtDate, localDate } from "@/lib/engines/time";
import { commentUpdate, submitUpdate } from "./actions";

export const metadata = { title: "Daily updates" };

export default async function DailyUpdates({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const today = localDate(new Date(), ctx.timezone);
  const team = canAny(ctx, ["people.view_all", "people.view_team"]);
  const view = team && sp.view === "team" ? "team" : "mine";

  if (view === "team") {
    const since = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
    const { data } = await sb.from("daily_updates").select("id, work_date, completed, in_progress, blockers, tomorrow, minutes_spent, manager_comment, employee:employees!daily_updates_employee_id_fkey(full_name)")
      .neq("employee_id", ctx.employee_id).gte("work_date", since).order("work_date", { ascending: false });
    return (
      <>
        <PageHeader eyebrow="Work" title="Team updates"><Link href="/daily-updates" className="btn-ghost">My update</Link></PageHeader>
        <Flash sp={sp} />
        {!data?.length ? <Empty title="No team updates in the last 7 days" /> : <div className="grid gap-4 lg:grid-cols-2">{data.map((u: any) => (
          <Card key={u.id} title={`${u.employee?.full_name} · ${fmtDate(u.work_date)}`}>
            <p className="whitespace-pre-wrap text-sm">{u.completed}</p>
            {u.in_progress && <p className="mt-2 text-sm text-muted">In progress: {u.in_progress}</p>}
            {u.blockers && <p className="mt-2 text-sm text-ember">Blockers: {u.blockers}</p>}
            {u.tomorrow && <p className="mt-2 text-sm text-muted">Tomorrow: {u.tomorrow}</p>}
            {u.manager_comment ? <p className="mt-3 border-t border-line pt-3 text-xs text-volt">Your feedback: {u.manager_comment}</p> : (
              <form action={commentUpdate} className="mt-3 flex gap-2 border-t border-line pt-3">
                <input type="hidden" name="id" value={u.id} />
                <input name="comment" className="input" placeholder="Feedback or clarification request" required />
                <button className="btn-ghost">Send</button>
              </form>)}
          </Card>))}</div>}
      </>
    );
  }

  const { data: mine } = await sb.from("daily_updates").select("*").eq("employee_id", ctx.employee_id).order("work_date", { ascending: false }).limit(30);
  const t = mine?.find((u) => u.work_date === today);
  return (
    <>
      <PageHeader eyebrow="Work" title="Daily update">{team && <Link href="/daily-updates?view=team" className="btn-ghost">Team updates</Link>}</PageHeader>
      <Flash sp={sp} />
      <Card title={`Today · ${fmtDate(today)}`}>
        {t?.reviewed_by ? <p className="text-sm text-muted">Today&apos;s update has been reviewed and is locked.</p> : (
          <form action={submitUpdate} className="grid gap-3 md:grid-cols-2">
            <Field label="Completed today"><textarea name="completed" rows={4} required minLength={5} defaultValue={t?.completed} className="input" /></Field>
            <Field label="Work in progress"><textarea name="in_progress" rows={4} defaultValue={t?.in_progress ?? ""} className="input" /></Field>
            <Field label="Blockers"><textarea name="blockers" rows={2} defaultValue={t?.blockers ?? ""} className="input" /></Field>
            <Field label="Tomorrow's priorities"><textarea name="tomorrow" rows={2} defaultValue={t?.tomorrow ?? ""} className="input" /></Field>
            <Field label="Hours spent"><input type="number" name="hours" step="0.25" min="0" max="24" defaultValue={t?.minutes_spent ? t.minutes_spent / 60 : ""} className="input" /></Field>
            <div className="flex items-end"><button className="btn-primary">{t ? "Update" : "Submit"}</button></div>
          </form>)}
      </Card>
      <h2 className="eyebrow mb-3 mt-8">History</h2>
      {!(mine ?? []).filter((u) => u.work_date !== today).length ? <Empty title="No previous updates" /> : (
        <div className="space-y-3">{mine!.filter((u) => u.work_date !== today).map((u) => (
          <Card key={u.id} title={fmtDate(u.work_date)}>
            <p className="whitespace-pre-wrap text-sm">{u.completed}</p>
            {u.manager_comment && <p className="mt-2 text-xs text-volt">Manager: {u.manager_comment}</p>}
          </Card>))}</div>)}
    </>
  );
}
