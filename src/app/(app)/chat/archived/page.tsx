import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Empty, Flash, PageHeader } from "@/components/ui";
import { restoreChat } from "../actions";

export const metadata = { title: "Archived chats" };

export default async function ArchivedChats({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePerm("communication.view", "communication.moderate");
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("my_archived_chats");
  const rows = (data ?? []) as {
    id: string;
    name: string;
    channel_type: string;
    archived_at: string;
    other_name: string | null;
    messages: number;
    last_message_at: string | null;
    can_restore: boolean;
  }[];
  const when = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString("en-IN", {
          timeZone: ctx.timezone,
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "—";
  return (
    <>
      <PageHeader eyebrow="Team chat" title="Archived chats">
        <Link href="/chat" className="btn-ghost">
          Back to chats
        </Link>
      </PageHeader>
      <Flash sp={sp} />
      <p className="mb-5 max-w-2xl text-sm text-muted">
        Archived conversations are read-only. Their members can still open the full history and save files; the channel owner or a chat
        manager can restore one to bring it back.
      </p>
      {error && <p className="mb-4 text-sm text-danger">Could not load archived chats: {error.message}</p>}
      {!rows.length ? (
        <Empty title="No archived chats" hint="Chats you archive will appear here instead of disappearing." />
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel">
          {rows.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-ink/[0.06] text-sm">🗄</span>
              <Link href={`/chat/archived/${c.id}`} className="min-w-0 flex-1">
                <p className="truncate font-semibold hover:text-volt">
                  {c.channel_type === "DIRECT" ? (c.other_name ?? "Direct message") : c.name}
                </p>
                <p className="text-xs text-muted">
                  {c.messages} message{c.messages === 1 ? "" : "s"} · last {when(c.last_message_at)} · archived {when(c.archived_at)}
                </p>
              </Link>
              <Badge>{c.channel_type}</Badge>
              <Link href={`/chat/archived/${c.id}`} className="btn-ghost">
                Open
              </Link>
              {c.can_restore && (
                <form action={restoreChat}>
                  <input type="hidden" name="channel_id" value={c.id} />
                  <button className="btn-primary">Restore</button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
