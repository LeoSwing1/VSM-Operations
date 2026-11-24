"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { addChatReaction, postChatMessage, reportChatMessage, sendChatMessage } from "@/app/(app)/chat/actions";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { openChannel, supabaseBrowser } from "@/lib/supabase/browser";
import { CHAT_THEMES, themeByKey } from "./chat-themes";

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
type ChannelMember = { employee_id: string; full_name: string; last_read_at: string | null; last_delivered_at?: string | null };

export function ChatRoom({
  channelId,
  employeeId,
  employeeName,
  orgId,
  readOnly = false,
}: {
  channelId: string;
  employeeId: string;
  employeeName: string;
  orgId?: string;
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
    // 1) Messages, reactions and read receipts: a standard channel. Row-level security on the tables still decides
    //    what each person receives, and this keeps working even if private (presence) channels are refused.
    const stopData = openChannel(
      `chat-data:${channelId}`,
      (channel) =>
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
          ),
      {
        onStatus: (status) => {
          if (status === "SUBSCRIBED") setError("");
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setError("Live updates paused — refreshing every 30 seconds.");
        },
      },
    );
    // 2) Who's online + typing: a private channel only members can join. If it's refused, just hide those extras.
    let live: RealtimeChannel | null = null;
    const stop = openChannel(
      `chat:${channelId}`,
      (channel) => {
        live = channel;
        typingChannel.current = channel;
        channel
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
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") typingChannel.current = null; // presence/typing off; messages unaffected
        },
      },
    );
    // Realtime is primary; this low-frequency fallback recovers missed events or a dropped socket.
    const fallback = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => {
      stop();
      stopData();
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

  const [sending, setSending] = useState(false);
  const [fileName, setFileName] = useState("");
  const [themeKey, setThemeKey] = useState("volt");
  useEffect(() => {
    try {
      setThemeKey(localStorage.getItem("vsm-chat-theme") ?? "volt");
    } catch {
      /* storage unavailable: default theme */
    }
  }, []);
  const theme = themeByKey(themeKey);
  const pickTheme = (k: string) => {
    setThemeKey(k);
    try {
      localStorage.setItem("vsm-chat-theme", k);
    } catch {
      /* ignore */
    }
  };
  const formRef = useRef<HTMLFormElement>(null);
  // Instant send: show the message straight away, clear the box, then save; realtime tells everyone else.
  async function send(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    const form = formRef.current;
    if (!form || sending) return;
    const fd = new FormData(form);
    const file = fd.get("file");
    const hasFile = file instanceof File && file.size > 0;
    const text = String(fd.get("body") ?? "").trim();
    if (!text && !hasFile) return;
    const temp: Message = {
      id: `temp-${Date.now()}`,
      body: text || `Shared ${(file as File).name}`,
      author_id: employeeId,
      author_name: employeeName,
      parent_message_id: null,
      created_at: new Date().toISOString(),
      edited_at: null,
      deleted_at: null,
      attachments: [],
      reactions: [],
    };
    setMessages((m) => [...m, temp]);
    setDraft("");
    form.reset();
    setFileName("");
    setSending(true);
    setError("");
    if (hasFile && orgId) {
      // Straight to private storage (any type, up to 50 MB, original quality) — the server only records it.
      const f = file as File;
      if (f.size > 50 * 1024 * 1024) {
        setSending(false);
        setMessages((m) => m.filter((x) => x.id !== temp.id));
        setError("Files can be up to 50 MB.");
        return;
      }
      const path = `${orgId}/${channelId}/${employeeId}/${crypto.randomUUID()}-${f.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100)}`;
      const up = await supabaseBrowser()
        .storage.from("chat-files")
        .upload(path, f, { contentType: f.type || "application/octet-stream", upsert: false });
      if (up.error) {
        setSending(false);
        setMessages((m) => m.filter((x) => x.id !== temp.id));
        setDraft(text);
        setError(`Upload failed: ${up.error.message}`);
        return;
      }
      fd.delete("file");
      fd.set("attachment_path", path);
      fd.set("attachment_name", f.name);
      fd.set("attachment_mime", f.type || "application/octet-stream");
      fd.set("attachment_size", String(f.size));
    }
    const r = await postChatMessage(fd);
    setSending(false);
    if (!r.ok) {
      setMessages((m) => m.filter((x) => x.id !== temp.id));
      setDraft(text);
      setError(r.error ?? "Message not sent.");
      return;
    }
    void load();
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const parent = (id: string) => messages.find((m) => m.id === id);
  const lastMineId = [...messages].reverse().find((m) => m.author_id === employeeId && !m.id.startsWith("temp-"))?.id;
  const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const onlineCount = onlineIds.length;
  return (
    <div className="flex min-h-[68vh] flex-col overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2 text-xs text-muted">
        <span>
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500" />
          Live connection · {onlineCount} online
        </span>
        <span className="flex items-center gap-1.5" role="radiogroup" aria-label="Chat theme">
          {CHAT_THEMES.map((t) => (
            <button
              key={t.key}
              type="button"
              role="radio"
              aria-checked={t.key === theme.key}
              title={t.label}
              aria-label={`${t.label} theme`}
              onClick={() => pickTheme(t.key)}
              className={`h-4 w-4 rounded-full border ${t.key === theme.key ? "ring-2 ring-offset-1 ring-offset-panel ring-ink" : "border-line"}`}
              style={{ background: t.swatch }}
            />
          ))}
        </span>
        {typingNames.length > 0 && (
          <span aria-live="polite">
            {typingNames.slice(0, 2).join(", ")}
            {typingNames.length > 2 ? ` +${typingNames.length - 2}` : ""} typing…
          </span>
        )}
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6" aria-live="polite" style={{ background: theme.bg, color: theme.text }}>
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
          const at = new Date(m.created_at).getTime();
          const others = members.filter((member) => member.employee_id !== employeeId);
          const seen = others.filter((member) => member.last_read_at && new Date(member.last_read_at).getTime() >= at);
          const delivered = others.filter(
            (member) => seen.includes(member) || (member.last_delivered_at && new Date(member.last_delivered_at).getTime() >= at),
          );
          const mine = m.author_id === employeeId;
          const pendingSend = m.id.startsWith("temp-");
          const isLatestMine = mine && !pendingSend && lastMineId === m.id;
          return (
            <div key={m.id} className={`flex w-full ${m.author_id === employeeId ? "justify-end" : "justify-start"}`}>
              <article className={`group w-fit max-w-[min(88%,44rem)] ${m.author_id === employeeId ? "items-end" : "items-start"}`}>
                <div className={`mb-1 flex items-baseline gap-2 ${m.author_id === employeeId ? "justify-end" : ""}`}>
                  <p className="text-xs font-semibold">
                    {m.author_id === employeeId ? (
                      "You"
                    ) : (
                      <Link
                        href={`/people/${m.author_id}`}
                        className="hover:text-volt hover:underline"
                        title={`Open ${m.author_name}'s profile`}
                      >
                        {m.author_name}
                      </Link>
                    )}
                  </p>
                  <time className="text-[10px] opacity-70">
                    {new Date(m.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  </time>
                </div>
                <div
                  className={`rounded-2xl px-4 py-3 ${m.author_id === employeeId ? "rounded-br-md" : "rounded-bl-md border"}`}
                  style={
                    m.author_id === employeeId
                      ? { background: theme.mine.bg, color: theme.mine.fg }
                      : { background: theme.theirs.bg, color: theme.theirs.fg, borderColor: theme.theirs.border }
                  }
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
                      {m.attachments.map((a) => {
                        const kb =
                          a.file_size >= 1048576
                            ? `${(a.file_size / 1048576).toFixed(1)} MB`
                            : `${Math.max(1, Math.round(a.file_size / 1024))} KB`;
                        if (a.url && /^image\/(jpeg|png|webp|gif|avif|bmp)$/.test(a.mime_type))
                          return (
                            <a
                              key={a.id}
                              href={a.url}
                              target="_blank"
                              rel="noreferrer"
                              title={`Open ${a.file_name} in full quality`}
                              className="block"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element -- private signed URL, shown at original quality */}
                              <img src={a.url} alt={a.file_name} loading="lazy" className="max-h-80 max-w-full rounded-xl object-contain" />
                              <span className="mt-1 block text-[11px] opacity-70">
                                {a.file_name} · {kb}
                              </span>
                            </a>
                          );
                        if (a.url && /^video\//.test(a.mime_type))
                          return (
                            <div key={a.id} className="w-full">
                              <video src={a.url} controls preload="metadata" className="max-h-80 w-full rounded-xl" />
                              <a href={a.url} target="_blank" rel="noreferrer" className="mt-1 block text-[11px] underline opacity-70">
                                {a.file_name} · {kb}
                              </a>
                            </div>
                          );
                        if (a.url && /^audio\//.test(a.mime_type))
                          return (
                            <div key={a.id} className="w-full">
                              <audio src={a.url} controls preload="metadata" className="w-full" />
                              <span className="mt-1 block text-[11px] opacity-70">
                                {a.file_name} · {kb}
                              </span>
                            </div>
                          );
                        return (
                          <a
                            key={a.id}
                            href={a.url ?? "#"}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2 rounded-lg border border-current/20 px-3 py-2 text-xs hover:opacity-75"
                          >
                            <span aria-hidden>{a.mime_type === "application/pdf" ? "📄" : "📎"}</span>
                            <span>
                              {a.file_name}
                              <span className="block opacity-70">
                                {kb} · {a.mime_type === "application/pdf" ? "open" : "download"}
                              </span>
                            </span>
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
                {mine && (
                  <div className="mt-1 text-right text-[11px]">
                    {pendingSend ? (
                      <span className="opacity-70" title="Sending">
                        🕓 Sending…
                      </span>
                    ) : (
                      <span
                        className={others.length && seen.length === others.length ? "font-semibold text-sky-400" : "opacity-70"}
                        title={
                          !others.length
                            ? "Sent"
                            : seen.length === others.length
                              ? "Seen"
                              : delivered.length === others.length
                                ? "Delivered"
                                : "Sent"
                        }
                        aria-label={
                          !others.length
                            ? "Sent"
                            : seen.length === others.length
                              ? "Seen"
                              : delivered.length === others.length
                                ? "Delivered"
                                : "Sent"
                        }
                      >
                        {others.length && delivered.length === others.length ? "✓✓" : "✓"}
                      </span>
                    )}
                    {isLatestMine && seen.length > 0 && others.length === 1 && (
                      <span className="ml-1 opacity-80">Seen {timeOf(seen[0]!.last_read_at!)}</span>
                    )}
                    {isLatestMine && seen.length > 0 && others.length > 1 && (
                      <details className="inline-block text-left">
                        <summary className="ml-1 cursor-pointer list-none opacity-80">
                          Seen by {seen.length} of {others.length} ▾
                        </summary>
                        <ul className="mt-1 space-y-0.5 rounded-lg border border-line bg-panel p-2 text-[11px] text-ink">
                          {others.map((o) => (
                            <li key={o.employee_id} className="flex justify-between gap-4">
                              <span>{o.full_name}</span>
                              <span className="text-muted">
                                {seen.includes(o)
                                  ? `✓✓ Seen ${timeOf(o.last_read_at!)}`
                                  : delivered.includes(o)
                                    ? "✓✓ Delivered"
                                    : "✓ Not yet"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                )}
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
        <form ref={formRef} onSubmit={send} className="border-t border-line bg-panel p-3 sm:p-4">
          <input type="hidden" name="channel_id" value={channelId} />
          <div className="rounded-2xl border border-line bg-paper p-2">
            <textarea
              name="body"
              value={draft}
              onChange={(e) => sendTyping(e.target.value)}
              onKeyDown={onKey}
              rows={2}
              maxLength={10000}
              placeholder="Write a message… (Enter to send, Shift+Enter for a new line)"
              className="input min-h-16 resize-y border-0 bg-transparent focus:ring-0"
            />
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <label className="cursor-pointer rounded-lg px-3 py-2 text-xs text-muted hover:bg-ink/[0.05]">
                ＋ {fileName ? `📎 ${fileName.slice(0, 40)}` : "Attach any file (up to 50 MB)"}{" "}
                <input name="file" type="file" className="sr-only" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} />
              </label>
              <button className="btn-primary" disabled={sending}>
                {sending ? "Sending…" : "Send ↗"}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
