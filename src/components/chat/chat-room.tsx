"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { addChatReaction, postChatMessage, reportChatMessage, sendChatMessage } from "@/app/(app)/chat/actions";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { openChannel, supabaseBrowser } from "@/lib/supabase/browser";
import { CHAT_THEMES, themeByKey } from "./chat-themes";
import { MAX_CHAT_FILE, chatFilePath, formatSize, previewKind, uploadWithProgress, type PreviewKind } from "@/lib/chat-upload";

/** A file being uploaded from this browser: shown in the composer, then inside the sent bubble until it lands. */
type LocalUpload = {
  file: File;
  name: string;
  size: number;
  mime: string;
  kind: PreviewKind;
  url: string | null; // object URL for an instant preview (images, video, audio)
  path: string;
  progress: number;
  status: "uploading" | "done" | "error";
  error?: string;
  promise: Promise<void>;
  abort: () => void;
};

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
  const [pending, setPending] = useState<LocalUpload | null>(null);
  const [inflight, setInflight] = useState<Record<string, LocalUpload>>({});
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
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

  // ---- Scrolling: only the message list scrolls; stay pinned to the newest message unless the reader scrolled up.
  const listRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [unseenBelow, setUnseenBelow] = useState(false);
  const toBottom = (smooth = true) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    pinned.current = true;
    setUnseenBelow(false);
  };
  const onListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (pinned.current) setUnseenBelow(false);
  };
  const lastId = messages[messages.length - 1]?.id;
  const firstLoad = useRef(true);
  useEffect(() => {
    if (!lastId) return;
    const mine = messages[messages.length - 1]?.author_id === employeeId;
    if (firstLoad.current) {
      firstLoad.current = false;
      requestAnimationFrame(() => toBottom(false));
    } else if (pinned.current || mine) requestAnimationFrame(() => toBottom(true));
    else setUnseenBelow(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a new last message arrives
  }, [lastId]);
  const keepPinned = () => {
    if (pinned.current) toBottom(false);
  };

  // ---- Attachments: upload starts as soon as a file is chosen, pasted or dropped.
  async function startUpload(file: File) {
    setError("");
    if (!orgId) return setError("Attachments are not available here.");
    if (file.size === 0) return setError("That file is empty.");
    if (file.size > MAX_CHAT_FILE) return setError(`"${file.name}" is ${formatSize(file.size)} — files can be up to 50 MB.`);
    if (pending) discardPending();
    const sb = supabaseBrowser();
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return setError("Your session expired — refresh the page and try again.");
    const mime = file.type || "application/octet-stream";
    const kind = previewKind(mime, file.name);
    const path = chatFilePath(orgId, channelId, employeeId, file.name, crypto.randomUUID());
    const up = uploadWithProgress({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      accessToken: token,
      bucket: "chat-files",
      path,
      file,
      onProgress: (pct) => update(path, { progress: pct }),
    });
    const item: LocalUpload = {
      file,
      name: file.name,
      size: file.size,
      mime,
      kind,
      url: kind === "image" || kind === "video" || kind === "audio" ? URL.createObjectURL(file) : null,
      path,
      progress: 0,
      status: "uploading",
      promise: up.promise,
      abort: up.abort,
    };
    up.promise.then(
      () => update(path, { status: "done", progress: 100 }),
      (e: Error) => update(path, e.message === "cancelled" ? {} : { status: "error", error: e.message }),
    );
    setPending(item);
  }
  // Progress lives in whichever place the upload currently is: the composer or a sent bubble.
  function update(path: string, patch: Partial<LocalUpload>) {
    setPending((p) => (p && p.path === path ? { ...p, ...patch } : p));
    setInflight((all) => {
      const key = Object.keys(all).find((k) => all[k]!.path === path);
      return key ? { ...all, [key]: { ...all[key]!, ...patch } } : all;
    });
  }
  function discardPending() {
    if (!pending) return;
    if (pending.status === "uploading") pending.abort();
    else if (pending.status === "done") void supabaseBrowser().storage.from("chat-files").remove([pending.path]);
    if (pending.url) URL.revokeObjectURL(pending.url);
    setPending(null);
    if (fileInput.current) fileInput.current.value = "";
  }
  const retryPending = () => {
    if (pending) void startUpload(pending.file);
  };

  // Instant send: the message (and the file preview with its progress) shows straight away; it is saved as
  // soon as the upload finishes; realtime tells everyone else.
  async function send(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    const form = formRef.current;
    if (!form || sending) return;
    const fd = new FormData(form);
    fd.delete("file");
    const text = String(fd.get("body") ?? "").trim();
    const att = pending;
    if (att?.status === "error") return setError(`"${att.name}" didn't upload — retry or remove it first.`);
    if (!text && !att) return;
    const temp: Message = {
      id: `temp-${Date.now()}`,
      body: text || `Shared ${att!.name}`,
      author_id: employeeId,
      author_name: employeeName,
      parent_message_id: null,
      created_at: new Date().toISOString(),
      edited_at: null,
      deleted_at: null,
      attachments: [],
      reactions: [],
    };
    if (att) setInflight((all) => ({ ...all, [temp.id]: att }));
    setPending(null);
    if (fileInput.current) fileInput.current.value = "";
    setMessages((m) => [...m, temp]);
    setDraft("");
    form.reset();
    setSending(true);
    setError("");
    const fail = (msg: string) => {
      setSending(false);
      setMessages((m) => m.filter((x) => x.id !== temp.id));
      setInflight(({ [temp.id]: back, ...rest }) => {
        if (back) setPending({ ...back });
        return rest;
      });
      setDraft(text);
      setError(msg);
    };
    if (att) {
      try {
        await att.promise;
      } catch (err) {
        return fail(`Upload failed: ${(err as Error).message}`);
      }
      fd.set("attachment_path", att.path);
      fd.set("attachment_name", att.name);
      fd.set("attachment_mime", att.mime);
      fd.set("attachment_size", String(att.size));
    }
    const r = await postChatMessage(fd);
    setSending(false);
    if (!r.ok) return fail(r.error ?? "Message not sent.");
    await load();
    setInflight(({ [temp.id]: done, ...rest }) => {
      if (done?.url) setTimeout(() => URL.revokeObjectURL(done.url!), 30_000);
      return rest;
    });
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
    <div
      className="relative flex h-[calc(100dvh-13rem)] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-line bg-panel lg:h-[calc(100dvh-15rem)]"
      onDragOver={(e) => {
        if (readOnly || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        if (readOnly) return;
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void startUpload(f);
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-2xl border-2 border-dashed border-volt bg-paper/80 text-sm font-semibold">
          Drop the file to attach it
        </div>
      )}
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
      <div
        ref={listRef}
        onScroll={onListScroll}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-6"
        aria-live="polite"
        style={{ background: theme.bg, color: theme.text }}
      >
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
                  {inflight[m.id] && <UploadPreview u={inflight[m.id]!} inBubble />}
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
                              <img
                                src={a.url}
                                alt={a.file_name}
                                loading="lazy"
                                onLoad={keepPinned}
                                className="max-h-80 max-w-full rounded-xl object-contain"
                              />
                              <span className="mt-1 block text-[11px] opacity-70">
                                {a.file_name} · {kb}
                              </span>
                            </a>
                          );
                        if (a.url && /^video\//.test(a.mime_type))
                          return (
                            <div key={a.id} className="w-full">
                              <video
                                src={a.url}
                                controls
                                preload="metadata"
                                onLoadedMetadata={keepPinned}
                                className="max-h-80 w-full rounded-xl"
                              />
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
      {unseenBelow && (
        <button
          type="button"
          onClick={() => toBottom()}
          className="absolute bottom-36 left-1/2 z-10 -translate-x-1/2 rounded-full bg-volt px-4 py-1.5 text-xs font-semibold text-[#0b0b0c] shadow-lg"
        >
          ↓ New messages
        </button>
      )}
      {!readOnly && (
        <form ref={formRef} onSubmit={send} className="shrink-0 border-t border-line bg-panel p-3 sm:p-4">
          <input type="hidden" name="channel_id" value={channelId} />
          <div className="rounded-2xl border border-line bg-paper p-2">
            {pending && (
              <div className="mb-2">
                <UploadPreview u={pending} onRemove={discardPending} onRetry={retryPending} />
              </div>
            )}
            <textarea
              name="body"
              value={draft}
              onChange={(e) => sendTyping(e.target.value)}
              onKeyDown={onKey}
              onPaste={(e) => {
                const f = e.clipboardData.files?.[0];
                if (f) {
                  e.preventDefault();
                  void startUpload(f);
                }
              }}
              rows={2}
              maxLength={10000}
              placeholder={pending ? "Add a message (optional)…" : "Write a message… (Enter to send, Shift+Enter for a new line)"}
              className="input max-h-40 min-h-16 resize-y border-0 bg-transparent focus:ring-0"
            />
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <label className="cursor-pointer rounded-lg px-3 py-2 text-xs text-muted hover:bg-ink/[0.05]">
                ＋ {pending ? "Change file" : "Attach any file (up to 50 MB) — or paste / drop it here"}
                <input
                  ref={fileInput}
                  name="file"
                  type="file"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void startUpload(f);
                  }}
                />
              </label>
              <button className="btn-primary" disabled={sending || pending?.status === "error"}>
                {sending ? "Sending…" : pending?.status === "uploading" ? `Send (uploading ${pending.progress}%)` : "Send ↗"}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

/** Preview of a file being uploaded: thumbnail (or icon), name, size, progress bar, and status. */
function UploadPreview({
  u,
  inBubble = false,
  onRemove,
  onRetry,
}: {
  u: LocalUpload;
  inBubble?: boolean;
  onRemove?: () => void;
  onRetry?: () => void;
}) {
  const icon = u.kind === "pdf" ? "📄" : u.kind === "audio" ? "🎵" : u.kind === "video" ? "🎬" : "📎";
  const busy = u.status === "uploading";
  return (
    <div className={`relative overflow-hidden rounded-xl border ${inBubble ? "mt-2 border-current/20" : "border-line bg-panel"} p-2`}>
      <div className="flex items-center gap-3">
        <div className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-ink/[0.06] text-2xl">
          {u.kind === "image" && u.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
            <img src={u.url} alt="" className={`h-full w-full object-cover ${busy ? "opacity-60" : ""}`} />
          ) : u.kind === "video" && u.url ? (
            <video src={u.url} muted preload="metadata" className={`h-full w-full object-cover ${busy ? "opacity-60" : ""}`} />
          ) : (
            <span aria-hidden>{icon}</span>
          )}
          {busy && (
            <span className="absolute inset-0 grid place-items-center">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{u.name}</p>
          <p className="text-[11px] opacity-70">
            {formatSize(u.size)} ·{" "}
            {u.status === "uploading"
              ? `Uploading… ${u.progress}%`
              : u.status === "done"
                ? inBubble
                  ? "Uploaded — sending…"
                  : "Ready to send ✓"
                : "Upload failed"}
          </p>
          <div
            className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-ink/10"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={u.progress}
            aria-label={`Uploading ${u.name}`}
          >
            <div
              className={`h-full rounded-full transition-[width] duration-200 ${u.status === "error" ? "bg-danger" : u.status === "done" ? "bg-emerald-500" : "bg-volt"}`}
              style={{ width: `${u.status === "error" ? 100 : u.progress}%` }}
            />
          </div>
          {u.status === "error" && <p className="mt-1 text-[11px] text-danger">{u.error}</p>}
        </div>
        {!inBubble && (
          <div className="flex shrink-0 flex-col gap-1">
            {u.status === "error" && onRetry && (
              <button type="button" onClick={onRetry} className="rounded-md px-2 py-1 text-xs font-semibold text-volt hover:bg-ink/5">
                Retry
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={onRemove}
                aria-label={`Remove ${u.name}`}
                title="Remove"
                className="rounded-md px-2 py-1 text-xs text-muted hover:bg-ink/5"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
