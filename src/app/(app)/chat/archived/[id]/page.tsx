import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { Flash, PageHeader } from "@/components/ui";
import { formatSize } from "@/lib/chat-upload";
import { restoreChat } from "../../actions";

export const metadata = { title: "Archived chat" };

type Att = { id: string; file_name: string; mime_type: string; file_size: number; storage_path: string };
type Row = {
  id: string;
  body: string | null;
  author_name: string | null;
  author_id: string;
  created_at: string;
  deleted: boolean;
  attachments: Att[];
};

export default async function ArchivedChat({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requirePerm("communication.view", "communication.moderate");
  const sb = await supabaseServer();
  const [{ data: list }, { data: history, error }] = await Promise.all([
    sb.rpc("my_archived_chats"),
    sb.rpc("archived_chat_history", { p_channel: id }),
  ]);
  const meta = (
    (list ?? []) as {
      id: string;
      name: string;
      channel_type: string;
      other_name: string | null;
      archived_at: string;
      can_restore: boolean;
    }[]
  ).find((c) => c.id === id);
  if (error || !meta) notFound(); // the database decided this person may not read it
  const rows = (history ?? []) as Row[];

  // Storage rules only serve files of live chats, so sign links here — after the database confirmed access above.
  const admin = supabaseAdmin();
  const signed = new Map<string, { view: string | null; save: string | null }>();
  await Promise.all(
    rows
      .flatMap((r) => r.attachments)
      .map(async (a) => {
        const inline = /^(image\/(jpeg|png|webp|gif|avif|bmp)|video\/(mp4|webm|quicktime|ogg)|audio\/|application\/pdf$)/.test(a.mime_type);
        const [v, d] = await Promise.all([
          inline ? admin.storage.from("chat-files").createSignedUrl(a.storage_path, 3600) : Promise.resolve(null),
          admin.storage.from("chat-files").createSignedUrl(a.storage_path, 3600, { download: a.file_name }),
        ]);
        signed.set(a.id, { view: v?.data?.signedUrl ?? null, save: d.data?.signedUrl ?? null });
      }),
  );
  const title = meta.channel_type === "DIRECT" ? (meta.other_name ?? "Direct message") : meta.name;
  const t = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", { timeZone: ctx.timezone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  return (
    <>
      <PageHeader eyebrow="Archived · read-only" title={title}>
        <Link href="/chat/archived" className="btn-ghost">
          All archived
        </Link>
        {meta.can_restore && (
          <form action={restoreChat}>
            <input type="hidden" name="channel_id" value={id} />
            <button className="btn-primary">Restore chat</button>
          </form>
        )}
      </PageHeader>
      <Flash sp={sp} />
      <div className="flex h-[calc(100dvh-13rem)] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-line bg-panel">
        <p className="shrink-0 border-b border-line px-4 py-2 text-xs text-muted">
          Archived {t(meta.archived_at)} · {rows.length} message{rows.length === 1 ? "" : "s"} shown (newest 500) · nobody can post here
        </p>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 sm:p-6">
          {!rows.length && <p className="text-sm text-muted">This conversation had no messages.</p>}
          {rows.map((m) => {
            const mine = m.author_id === ctx.employee_id;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <article
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${mine ? "bg-volt text-[#0b0b0c]" : "border border-line bg-paper"}`}
                >
                  <p className="text-[11px] font-semibold opacity-70">
                    {mine ? "You" : (m.author_name ?? "Team member")} · {t(m.created_at)}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm">{m.deleted ? "This message was removed." : m.body}</p>
                  {m.attachments.map((a) => {
                    const s = signed.get(a.id);
                    const img = /^image\//.test(a.mime_type) && s?.view;
                    return (
                      <div key={a.id} className="mt-2">
                        {img && (
                          <a href={s!.view!} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element -- original file via signed URL */}
                            <img src={s!.view!} alt={a.file_name} loading="lazy" className="max-h-72 rounded-xl object-contain" />
                          </a>
                        )}
                        {/^video\//.test(a.mime_type) && s?.view && (
                          <video src={s.view} controls preload="metadata" className="max-h-72 w-full rounded-xl bg-black" />
                        )}
                        <p className="mt-1 flex items-center gap-2 text-[11px]">
                          <span className="truncate opacity-70">
                            {a.file_name} · {formatSize(a.file_size)}
                          </span>
                          {s?.save && (
                            <a
                              href={s.save}
                              download={a.file_name}
                              className="rounded-full border border-current/25 px-2 py-0.5 font-semibold hover:opacity-75"
                            >
                              ⬇ Save
                            </a>
                          )}
                        </p>
                      </div>
                    );
                  })}
                </article>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
