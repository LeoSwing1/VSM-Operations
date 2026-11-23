import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Card, Empty, Flash, PageHeader, TableWrap } from "@/components/ui";
import { moderateMessage, reviewChatReportAction } from "../../chat/actions";
export const metadata = { title: "Chat moderation" };
export default async function ChatModeration({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams,
    ctx = await requirePerm("communication.moderate"),
    sb = await supabaseServer();
  const [{ data: reports }, { data: events }] = await Promise.all([
    sb
      .from("chat_message_reports")
      .select("id,channel_id,message_id,reporter_id,reason,details,status,created_at,resolution")
      .in("status", ["OPEN", "REVIEWING"])
      .order("created_at", { ascending: false })
      .limit(100),
    sb
      .from("chat_moderation_events")
      .select("id,action,channel_id,message_id,target_employee_id,details,created_at")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  const ids = [...new Set((reports ?? []).map((r: any) => r.message_id))];
  const hiddenIds = [
    ...new Set((events ?? []).filter((e: any) => e.action === "MESSAGE_HIDE" && e.message_id).map((e: any) => e.message_id)),
  ];
  const { data: hiddenMessages } = hiddenIds.length
    ? await sb.from("chat_messages").select("id,body,author_id,channel_id,deleted_at").in("id", hiddenIds)
    : { data: [] };
  const { data: messages } = ids.length
    ? await sb.from("chat_messages").select("id,body,author_id,channel_id,created_at,deleted_at").in("id", ids)
    : { data: [] };
  const peopleIds = [
    ...new Set([
      ...(reports ?? []).map((r: any) => r.reporter_id),
      ...(messages ?? []).map((m: any) => m.author_id),
      ...(hiddenMessages ?? []).map((m: any) => m.author_id),
    ]),
  ];
  const { data: people } = peopleIds.length ? await sb.from("employee_directory").select("id,full_name").in("id", peopleIds) : { data: [] };
  const name = (id: string) => people?.find((p: any) => p.id === id)?.full_name ?? "Former team member";
  return (
    <>
      <PageHeader eyebrow="Communication controls" title="Chat moderation">
        <Link href="/chat" className="btn-ghost">
          Open team chat
        </Link>
        <Badge>{reports?.length ?? 0} open reports</Badge>
      </PageHeader>
      <Flash sp={sp} />
      <Card title="Reported messages">
        <p className="mb-4 text-sm text-muted">
          Only users with communication.moderate can view this queue. Actions are recorded in the moderation audit trail.
        </p>
        {!reports?.length ? (
          <Empty title="No open reports" hint="New message reports will appear here." />
        ) : (
          <div className="space-y-4">
            {reports.map((r: any) => {
              const m = messages?.find((x: any) => x.id === r.message_id);
              return (
                <article key={r.id} className="rounded-xl border border-line p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="amber">{r.status}</Badge>
                      <Badge>{r.reason.replaceAll("_", " ")}</Badge>
                      <span className="text-xs text-muted">
                        Reported by {name(r.reporter_id)} · {new Date(r.created_at).toLocaleString("en-IN")}
                      </span>
                    </div>
                    <Link className="text-xs text-volt" href={`/chat/${r.channel_id}`}>
                      Open conversation →
                    </Link>
                  </div>
                  <blockquote className="my-3 rounded-lg bg-paper p-3 text-sm">
                    {m?.deleted_at ? "Message already hidden" : (m?.body ?? "Message is no longer available")}
                    <p className="mt-2 text-xs text-muted">Author: {m ? name(m.author_id) : "Unknown"}</p>
                  </blockquote>
                  {r.details && <p className="mb-3 text-sm text-muted">Reporter notes: {r.details}</p>}
                  <div className="flex flex-wrap gap-2">
                    <form action={reviewChatReportAction} className="flex flex-wrap gap-2">
                      <input type="hidden" name="report_id" value={r.id} />
                      <input type="hidden" name="status" value="REVIEWING" />
                      <input name="resolution" placeholder="Review note (optional)" className="input max-w-xs" />
                      <button className="btn-ghost">Mark reviewing</button>
                    </form>
                    <form action={reviewChatReportAction}>
                      <input type="hidden" name="report_id" value={r.id} />
                      <input type="hidden" name="status" value="DISMISSED" />
                      <input type="hidden" name="resolution" value="Reviewed; no action required" />
                      <button className="btn-ghost">Dismiss</button>
                    </form>
                    {m && !m.deleted_at && (
                      <form action={moderateMessage} className="flex flex-wrap gap-2">
                        <input type="hidden" name="message_id" value={m.id} />
                        <input type="hidden" name="channel_id" value={r.channel_id} />
                        <input type="hidden" name="action" value="HIDE" />
                        <input name="reason" placeholder="Moderation reason" required className="input max-w-xs" />
                        <button className="btn-danger">Hide message</button>
                      </form>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Card>
      <Card title="Recent moderation activity">
        <TableWrap>
          <table className="table min-w-[600px]">
            <thead>
              <tr>
                <th>Action</th>
                <th>Channel / message</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {(events ?? []).map((e: any) => (
                <tr key={e.id}>
                  <td>
                    <Badge>{e.action.replaceAll("_", " ")}</Badge>
                  </td>
                  <td className="font-mono text-xs">
                    {e.channel_id ?? "—"}
                    <br />
                    {e.message_id ?? e.target_employee_id ?? ""}
                  </td>
                  <td className="text-xs text-muted">
                    {new Date(e.created_at).toLocaleString("en-IN")}
                    {e.action === "MESSAGE_HIDE" && hiddenMessages?.some((m: any) => m.id === e.message_id && m.deleted_at) ? (
                      <form action={moderateMessage} className="mt-1">
                        <input type="hidden" name="message_id" value={e.message_id} />
                        <input type="hidden" name="channel_id" value={e.channel_id} />
                        <input type="hidden" name="action" value="RESTORE" />
                        <input type="hidden" name="reason" value="Restored after moderation review" />
                        <button className="text-volt underline">Restore message</button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        {!events?.length && <Empty title="No moderation actions recorded yet" />}
      </Card>
    </>
  );
}
