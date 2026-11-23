"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { addChatReaction, reportChatMessage, sendChatMessage } from "@/app/(app)/chat/actions";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { openChannel } from "@/lib/supabase/browser";

type Attachment = { id: string; file_name: string; url: string | null; mime_type: string; file_size: number };
type Message = {
  id: string;
  body: string;
  author_id: string;
  author_name: string;
  parent_message_id: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  attachments: Attachment[];
  reactions: { reaction: string; employee_id: string }[];
};
type ChannelMember = { employee_id: string; full_name: string; last_read_at: string | null };

export function ChatRoom({
  channelId,
  employeeId,
  employeeName,
  readOnly = false,
}: {
  channelId: string;
  employeeId: string;
  employeeName: string;
  readOnly?: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [onlineIds, setOnlineIds] = useState<string[]>([]);
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const lastRead = useRef("");
  const typingTimer = useRef<number | null>(null);
  const typingChannel = useRef<any>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/chat/${channelId}/messages`, { cache: "no-store" });
      if (!r.ok) throw new Error("Unable to refresh this conversation.");
      const j = await r.json();
      const next = (j.messages ?? []) as Message[];
      setMessages(next);
      setMembers((j.members ?? []) as ChannelMember[]);
      setError("");
      setLoading(false);
      const latest = next.at(-1)?.id ?? "empty";
      if (latest !== lastRead.current) {
        lastRead.current = latest;
        if (!readOnly) void fetch(`/api/chat/${channelId}/read`, { method: "POST" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection issue.");
      setLoading(false);
    }
  }, [channelId, readOnly]);

  useEffect(() => {
    void load();
    if (readOnly) {
      const fallback = window.setInterval(() => {
        if (document.visibilityState === "visible") void load();
      }, 15000);
      return () => window.clearInterval(fallback);
    }
    let live: RealtimeChannel | null = null;
    const stop = openChannel(
      `chat:${channelId}`,
      (channel) => {
        live = channel;
        typingChannel.current = channel;
        channel
          .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages", filter: `channel_id=eq.${channelId}` }, () => {
            void load();
          })
          .on("postgres_changes", { event: "*", schema: "public", table: "chat_reactions" }, () => {
            void load();
          })
          .on(
            "postgres_changes",
            { event: "UPDATE", schema: "public", table: "chat_channel_members", filter: `channel_id=eq.${channelId}` },
            () => {
              void load();
            },
          )
          .on("broadcast", { event: "typing" }, ({ payload }: { payload: { employee_id?: string; name?: string; typing?: boolean } }) => {
            if (!payload || payload.employee_id === employeeId) return;
            const name = String(payload.name || "A teammate");
            setTypingNames((current) => (payload.typing ? [...new Set([...current, name])] : current.filter((n) => n !== name)));
            if (payload.typing) window.setTimeout(() => setTypingNames((current) => current.filter((n) => n !== name)), 2500);
          })
          .on("presence", { event: "sync" }, () => {
            const state = channel.presenceState<{ employee_id: string }>();
            setOnlineIds([
              ...new Set(
                Object.values(state)
                  .flat()
                  .map((p) => p.employee_id),
              ),
            ]);
          });
      },
      {
        config: { private: true, presence: { key: employeeId }, broadcast: { self: false } },
        onStatus: async (status) => {
          if (status === "SUBSCRIBED" && live)
            await live.track({ employee_id: employeeId, full_name: employeeName, online_at: new Date().toISOString() });
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setError("Live updates paused — refreshing every 30 seconds.");
        },
      },
    );
    // Realtime is primary; this low-frequency fallback recovers missed events or a dropped socket.
    const fallback = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => {
      stop();
      window.clearInterval(fallback);
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
      typingChannel.current = null;
    };
  }, [channelId, employeeId, employeeName, load, readOnly]);

  const sendTyping = (value: string) => {
    setDraft(value);
    const channel = typingChannel.current;
    if (!channel || readOnly) return;
    if (value.trim())
      void channel.send({ type: "broadcast", event: "typing", payload: { employee_id: employeeId, name: employeeName, typing: true } });
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      void channel.send({ type: "broadcast", event: "typing", payload: { employee_id: employeeId, name: employeeName, typing: false } });
    }, 1200);
  };

  const parent = (id: string) => messages.find((m) => m.id === id);
  const onlineCount = onlineIds.length;
  return (
    <div className="flex min-h-[68vh] flex-col overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2 text-xs text-muted">
        <span>
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500" />
          Live connection · {onlineCount} online
        </span>
        {typingNames.length > 0 && (
          <span aria-live="polite">
            {typingNames.slice(0, 2).join(", ")}
            {typingNames.length > 2 ? ` +${typingNames.length - 2}` : ""} typing…
          </span>
        )}
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6" aria-live="polite">
        {loading && <p className="text-sm text-muted">Loading conversation…</p>}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {!loading && !messages.length && !error && (
          <div className="grid min-h-64 place-items-center text-center">
            <div>
              <p className="font-semibold">This conversation is ready</p>
              <p className="mt-1 text-sm text-muted">Send the first message to get things moving.</p>
            </div>
          </div>
        )}
        {messages.map((m) => {
          const seenBy = members.filter(
            (member) =>
              member.employee_id !== employeeId &&
              member.last_read_at &&
              new Date(member.last_read_at).getTime() >= new Date(m.created_at).getTime(),
          ).length;
          return (
            <div key={m.id} className={`flex w-full ${m.author_id === employeeId ? "justify-end" : "justify-start"}`}>
              <article className={`group w-fit max-w-[min(88%,44rem)] ${m.author_id === employeeId ? "items-end" : "items-start"}`}>
                <div className={`mb-1 flex items-baseline gap-2 ${m.author_id === employeeId ? "justify-end" : ""}`}>
                  <p className="text-xs font-semibold">{m.author_id === employeeId ? "You" : m.author_name}</p>
                  <time className="text-[10px] text-muted">
                    {new Date(m.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  </time>
                </div>
                <div
                  className={`rounded-2xl px-4 py-3 ${m.author_id === employeeId ? "rounded-br-md bg-ink text-white" : "rounded-bl-md border border-line bg-paper"}`}
                >
                  {m.parent_message_id && (
                    <div className="mb-2 rounded-lg border-l-2 border-volt bg-black/5 px-3 py-2 text-xs opacity-80">
                      Replying to {parent(m.parent_message_id)?.author_name ?? "an earlier message"}:{" "}
                      {parent(m.parent_message_id)?.body.slice(0, 120) ?? "Message"}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap break-words text-sm leading-6">{m.deleted_at ? "This message was removed." : m.body}</p>
                  {!!m.attachments.length && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {m.attachments.map((a) => (
                        <a
                          key={a.id}
                          href={a.url ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-current/20 px-3 py-2 text-xs hover:opacity-75"
                        >
                          ↗ {a.file_name} · {(a.file_size / 1024).toFixed(0)} KB
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                {m.author_id === employeeId && seenBy > 0 && <p className="mt-1 text-right text-[10px] text-muted">Seen by {seenBy}</p>}
                {!readOnly && (
                  <div className={`mt-1 flex flex-wrap items-center gap-2 ${m.author_id === employeeId ? "justify-end" : ""}`}>
                    <div className="flex items-center gap-1">
                      {["👍", "❤️", "😂", "🎉", "👀", "🙏"].map((e) => (
                        <form key={e} action={addChatReaction}>
                          <input type="hidden" name="channel_id" value={channelId} />
                          <input type="hidden" name="message_id" value={m.id} />
                          <input type="hidden" name="reaction" value={e} />
                          <button title={`React ${e}`} className="rounded-full px-1.5 py-0.5 text-[11px] hover:bg-paper">
                            {e}
                            {m.reactions.filter((r) => r.reaction === e).length > 0
                              ? ` ${m.reactions.filter((r) => r.reaction === e).length}`
                              : ""}
                          </button>
                        </form>
                      ))}
                    </div>
                    {m.author_id !== employeeId && !m.deleted_at && (
                      <details>
                        <summary className="cursor-pointer text-[10px] text-muted">Report</summary>
                        <form action={reportChatMessage} className="mt-2 flex max-w-xl flex-wrap gap-2">
                          <input type="hidden" name="channel_id" value={channelId} />
                          <input type="hidden" name="message_id" value={m.id} />
                          <select name="reason" required className="input max-w-[190px] py-2 text-xs">
                            <option value="">Reason</option>
                            <option value="HARASSMENT">Harassment</option>
                            <option value="SPAM">Spam</option>
                            <option value="CONFIDENTIAL_DATA">Confidential data</option>
                            <option value="INAPPROPRIATE">Inappropriate</option>
                            <option value="OTHER">Other</option>
                          </select>
                          <input
                            name="details"
                            maxLength={2000}
                            placeholder="Optional context"
                            className="input min-w-[160px] flex-1 py-2 text-xs"
                          />
                          <button className="btn-ghost px-3 py-2 text-xs">Submit report</button>
                        </form>
                      </details>
                    )}
                    <details>
                      <summary className="cursor-pointer text-[10px] text-muted">Reply</summary>
                      <form action={sendChatMessage} className="mt-2 flex max-w-xl gap-2">
                        <input type="hidden" name="channel_id" value={channelId} />
                        <input type="hidden" name="parent_message_id" value={m.id} />
                        <input name="body" required maxLength={10000} placeholder="Write a reply…" className="input py-2 text-sm" />
                        <button className="btn-ghost px-3 py-2 text-xs">Send</button>
                      </form>
                    </details>
                  </div>
                )}
              </article>
            </div>
          );
        })}
      </div>
      {!readOnly && (
        <form action={sendChatMessage} className="border-t border-line bg-panel p-3 sm:p-4">
          <input type="hidden" name="channel_id" value={channelId} />
          <div className="rounded-2xl border border-line bg-paper p-2">
            <textarea
              name="body"
              value={draft}
              onChange={(e) => sendTyping(e.target.value)}
              rows={2}
              maxLength={10000}
              placeholder="Write a message to your team…"
              className="input min-h-16 resize-y border-0 bg-transparent focus:ring-0"
            />
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <label className="cursor-pointer rounded-lg px-3 py-2 text-xs text-muted hover:bg-ink/[0.05]">
                ＋ Attach file <input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.zip" className="sr-only" />
              </label>
              <button className="btn-primary">Send message ↗</button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
