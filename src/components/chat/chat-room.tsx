"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { addChatReaction, postChatMessage, reportChatMessage, sendChatMessage } from "@/app/(app)/chat/actions";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getAccessToken, openChannel } from "@/lib/supabase/browser";
import { CHAT_THEMES, themeByKey } from "./chat-themes";
import {
  MAX_CHAT_FILE,
  RESUMABLE_FROM,
  chatFilePath,
  formatSize,
  previewKind,
  removeUploaded,
  uploadId,
  uploadResumable,
  uploadWithProgress,
  type PreviewKind,
} from "@/lib/chat-upload";

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

type Attachment = { id: string; file_name: string; url: string | null; download_url?: string | null; mime_type: string; file_size: number };
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
  const [liveNote, setLiveNote] = useState("");
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
      setLiveNote(""); // a refresh never clears an upload/send error the person still needs to see
      setLoading(false);
      const latest = next.at(-1)?.id ?? "empty";
      if (latest !== lastRead.current) {
        lastRead.current = latest;
        if (!readOnly) void fetch(`/api/chat/${channelId}/read`, { method: "POST" });
      }
    } catch (e) {
      setLiveNote(e instanceof Error ? e.message : "Connection issue.");
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
          if (status === "SUBSCRIBED") setLiveNote("");
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setLiveNote("Live updates paused — refreshing every 30 seconds.");
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
  const [preparing, setPreparing] = useState("");
  const [inflight, setInflight] = useState<Record<string, LocalUpload>>({});
  const [dragging, setDragging] = useState(false);
  const [viewer, setViewer] = useState<Attachment | null>(null);
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
    setPreparing(file.name); // something shows the instant a file is picked
    try {
      if (!orgId) throw new Error("Attachments are not available here.");
      if (file.size === 0) throw new Error("That file is empty.");
      if (file.size > MAX_CHAT_FILE) throw new Error(`"${file.name}" is ${formatSize(file.size)} — files can be up to 10 GB.`);
      if (pending) discardPending();
      // Login cookies are HttpOnly (page scripts can't read them), so the short-lived token comes from the server.
      const token = await getAccessToken();
      const mime = file.type || "application/octet-stream";
      const kind = previewKind(mime, file.name);
      const path = chatFilePath(orgId, channelId, employeeId, file.name, uploadId());
      const common = {
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        accessToken: token,
        bucket: "chat-files",
        path,
        file,
        onProgress: (pct: number) => update(path, { progress: pct }),
      };
      // Small files in one request; big ones (videos, project files) in resumable 6 MB chunks — original bytes either way.
      const up =
        file.size > RESUMABLE_FROM
          ? uploadResumable({ ...common, getToken: getAccessToken })
          : uploadWithProgress({ ...common, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! });
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
    } catch (e) {
      setError(`Couldn't attach "${file.name}": ${(e as Error).message}`);
      if (fileInput.current) fileInput.current.value = "";
    } finally {
      setPreparing("");
    }
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
    else if (pending.status === "done") {
      const path = pending.path;
      void getAccessToken()
        .then((accessToken) =>
          removeUploaded({
            supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
            anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            accessToken,
            bucket: "chat-files",
            path,
          }),
        )
        .catch(() => undefined);
    }
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
        {liveNote && <p className="text-xs text-muted">{liveNote}</p>}
        {!loading && !messages.length && (
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
                      {m.attachments.map((a) => (
                        <AttachmentView key={a.id} a={a} onLoaded={keepPinned} onOpen={setViewer} />
                      ))}
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
      {viewer && <Lightbox a={viewer} onClose={() => setViewer(null)} />}
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
          {error && (
            <div
              role="alert"
              className="mb-2 flex items-start justify-between gap-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              <span>{error}</span>
              <button
                type="button"
                onClick={() => setError("")}
                aria-label="Dismiss"
                className="shrink-0 text-xs opacity-70 hover:opacity-100"
              >
                ✕
              </button>
            </div>
          )}
          <div className="rounded-2xl border border-line bg-paper p-2">
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
              rows={1}
              maxLength={10000}
              placeholder={pending ? "Add a message (optional)…" : "Write a message… (Enter to send, Shift+Enter for a new line)"}
              className="input max-h-40 min-h-11 resize-y border-0 bg-transparent focus:ring-0"
            />
            {preparing && !pending && (
              <div className="mx-1 mb-1 flex max-w-md items-center gap-2 rounded-lg border border-line bg-panel px-2 py-1.5 text-xs">
                <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-volt/30 border-t-volt" aria-hidden />
                <span className="truncate">Preparing {preparing}…</span>
              </div>
            )}
            {pending && (
              <div className="mx-1 mb-1">
                <AttachmentChip u={pending} onRemove={discardPending} onRetry={retryPending} />
              </div>
            )}
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <label className="cursor-pointer rounded-lg px-3 py-2 text-xs text-muted hover:bg-ink/[0.05]">
                ＋ {pending ? "Change file" : "Attach any file (up to 10 GB) — or paste / drop it here"}
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

/** Circular progress ring with the percentage in the middle (WhatsApp-style). */
function ProgressRing({ pct, size = 56, onCancel }: { pct: number; size?: number; onCancel?: () => void }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative grid place-items-center rounded-full bg-black/55 text-white shadow-lg" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,.25)" strokeWidth="3" fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#D7FF3A"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(2, pct) / 100)}
          className="transition-[stroke-dashoffset] duration-300"
        />
      </svg>
      {onCancel ? (
        <button type="button" onClick={onCancel} aria-label="Cancel upload" className="relative text-xs font-semibold">
          <span className="block leading-none">{pct}%</span>
          <span className="block text-[10px] leading-none opacity-80">✕</span>
        </button>
      ) : (
        <span className="relative text-xs font-semibold">{pct}%</span>
      )}
    </span>
  );
}

const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.slice(0, 5).toUpperCase() : "FILE");

/**
 * Preview of a file being uploaded. Photos and videos show blurred with a progress ring while uploading and turn
 * sharp with a tick when they're ready; documents show a file card with the same ring.
 */
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
  const busy = u.status === "uploading";
  const failed = u.status === "error";
  const visual = (u.kind === "image" || u.kind === "video") && u.url;
  const status = busy ? `Uploading… ${u.progress}%` : u.status === "done" ? (inBubble ? "Sending…" : "Ready to send") : "Upload failed";
  return (
    <div className={`relative ${inBubble ? "mt-2" : ""}`}>
      {visual ? (
        <div className="relative w-60 max-w-full overflow-hidden rounded-xl bg-black">
          {u.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
            <img
              src={u.url!}
              alt=""
              className={`max-h-48 w-full object-cover transition duration-500 ${busy || failed ? "scale-105 blur-md brightness-75" : ""}`}
            />
          ) : (
            <video
              src={u.url!}
              muted
              playsInline
              preload="metadata"
              className={`max-h-48 w-full object-cover transition duration-500 ${busy || failed ? "scale-105 blur-md brightness-75" : ""}`}
            />
          )}
          <span className="absolute inset-0 grid place-items-center">
            {busy ? (
              <ProgressRing pct={u.progress} onCancel={inBubble ? undefined : onRemove} />
            ) : failed ? (
              <span className="rounded-full bg-danger px-3 py-1 text-xs font-semibold text-white">Failed</span>
            ) : (
              <span
                className="grid h-10 w-10 place-items-center rounded-full bg-emerald-500 text-lg text-white shadow-lg"
                aria-label="Ready"
              >
                ✓
              </span>
            )}
          </span>
          {u.kind === "video" && !busy && (
            <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] text-white">▶ Video</span>
          )}
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 text-[11px] text-white">
            <span className="block truncate font-medium">{u.name}</span>
            {formatSize(u.size)} · {status}
          </span>
        </div>
      ) : (
        <div className={`flex items-center gap-3 rounded-xl border p-2.5 ${inBubble ? "border-current/20" : "border-line bg-panel"}`}>
          <span className="relative grid h-14 w-12 shrink-0 place-items-center rounded-lg bg-ink/[0.07] text-[10px] font-bold">
            <span className={busy ? "opacity-30" : ""}>{u.kind === "pdf" ? "PDF" : u.kind === "audio" ? "🎵" : extOf(u.name)}</span>
            {busy && (
              <span className="absolute inset-0 grid place-items-center">
                <ProgressRing pct={u.progress} size={40} />
              </span>
            )}
            {u.status === "done" && (
              <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-emerald-500 text-[10px] text-white">
                ✓
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{u.name}</span>
            <span className="block text-[11px] opacity-70">
              {formatSize(u.size)} · {status}
            </span>
            <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-ink/10">
              <span
                className={`block h-full rounded-full transition-[width] duration-300 ${failed ? "bg-danger" : u.status === "done" ? "bg-emerald-500" : "bg-volt"}`}
                style={{ width: `${failed ? 100 : u.progress}%` }}
              />
            </span>
          </span>
        </div>
      )}
      {failed && <p className="mt-1 text-[11px] text-danger">{u.error}</p>}
      {!inBubble && (
        <div className="mt-1 flex gap-2">
          {failed && onRetry && (
            <button type="button" onClick={onRetry} className="rounded-md px-2 py-1 text-xs font-semibold text-volt hover:bg-ink/5">
              Retry
            </button>
          )}
          {onRemove && (
            <button type="button" onClick={onRemove} className="rounded-md px-2 py-1 text-xs text-muted hover:bg-ink/5">
              {busy ? "Cancel upload" : "Remove"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Save to device: the signed link carries Content-Disposition: attachment, so the original file downloads. */
function SaveButton({ a, light = false }: { a: Attachment; light?: boolean }) {
  const href = a.download_url ?? a.url;
  if (!href) return null;
  return (
    <a
      href={href}
      download={a.file_name}
      rel="noreferrer"
      title={`Save ${a.file_name} to this device (original quality)`}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
        light ? "bg-black/60 text-white hover:bg-black/80" : "border border-current/25 hover:opacity-75"
      }`}
    >
      ⬇ Save
    </a>
  );
}

function AttachmentView({ a, onLoaded, onOpen }: { a: Attachment; onLoaded: () => void; onOpen: (a: Attachment) => void }) {
  const size = formatSize(a.file_size);
  if (a.url && /^image\/(jpeg|png|webp|gif|avif|bmp)$/.test(a.mime_type))
    return (
      <figure className="relative max-w-sm">
        <button type="button" onClick={() => onOpen(a)} title="View full size" className="block w-full">
          {/* eslint-disable-next-line @next/next/no-img-element -- private signed URL, the original file */}
          <img src={a.url} alt={a.file_name} loading="lazy" onLoad={onLoaded} className="max-h-80 w-full rounded-xl object-contain" />
        </button>
        <span className="absolute right-2 top-2">
          <SaveButton a={a} light />
        </span>
        <figcaption className="mt-1 text-[11px] opacity-70">
          {a.file_name} · {size} · original quality
        </figcaption>
      </figure>
    );
  if (a.url && /^video\//.test(a.mime_type))
    return (
      <figure className="w-full max-w-md">
        <video
          src={a.url}
          controls
          preload="metadata"
          playsInline
          onLoadedMetadata={onLoaded}
          className="max-h-80 w-full rounded-xl bg-black"
        />
        <figcaption className="mt-1 flex items-center justify-between gap-2 text-[11px]">
          <span className="truncate opacity-70">
            {a.file_name} · {size}
          </span>
          <SaveButton a={a} />
        </figcaption>
      </figure>
    );
  if (a.url && /^audio\//.test(a.mime_type))
    return (
      <figure className="w-full max-w-md">
        <audio src={a.url} controls preload="metadata" className="w-full" />
        <figcaption className="mt-1 flex items-center justify-between gap-2 text-[11px]">
          <span className="truncate opacity-70">
            {a.file_name} · {size}
          </span>
          <SaveButton a={a} />
        </figcaption>
      </figure>
    );
  const pdf = a.mime_type === "application/pdf";
  return (
    <div className="flex max-w-sm items-center gap-3 rounded-xl border border-current/20 p-2.5">
      <span className="grid h-12 w-10 shrink-0 place-items-center rounded-md bg-black/10 text-[10px] font-bold">
        {pdf ? "PDF" : extOf(a.file_name)}
      </span>
      <span className="min-w-0 flex-1">
        {a.url && pdf ? (
          <a
            href={a.url}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-sm font-medium underline-offset-2 hover:underline"
          >
            {a.file_name}
          </a>
        ) : (
          <span className="block truncate text-sm font-medium">{a.file_name}</span>
        )}
        <span className="block text-[11px] opacity-70">
          {size}
          {pdf ? " · tap name to open" : ""}
        </span>
      </span>
      <SaveButton a={a} />
    </div>
  );
}

/** Full-screen photo viewer at original resolution. */
function Lightbox({ a, onClose }: { a: Attachment; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={a.file_name}
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-white" onClick={(e) => e.stopPropagation()}>
        <span className="truncate">
          {a.file_name} · {formatSize(a.file_size)}
        </span>
        <span className="flex items-center gap-2">
          <SaveButton a={a} light />
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/10 px-3 py-1 text-xs hover:bg-white/20"
            aria-label="Close"
          >
            ✕ Close
          </button>
        </span>
      </div>
      <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- original file, no resizing */}
        <img src={a.url!} alt={a.file_name} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
      </div>
    </div>
  );
}

/** Compact attachment chip under the message box: small thumbnail with the progress ring, name, size, status, ✕. */
function AttachmentChip({ u, onRemove, onRetry }: { u: LocalUpload; onRemove: () => void; onRetry: () => void }) {
  const busy = u.status === "uploading";
  const failed = u.status === "error";
  const done = u.status === "done";
  const visual = (u.kind === "image" || u.kind === "video") && u.url;
  return (
    <div
      className={`flex max-w-md items-center gap-2.5 rounded-lg border bg-panel p-1.5 pr-2 ${failed ? "border-danger/50" : "border-line"}`}
      title={failed ? u.error : u.name}
    >
      <span className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-md bg-ink/[0.07] text-[9px] font-bold">
        {visual ? (
          u.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
            <img
              src={u.url!}
              alt=""
              className={`h-full w-full object-cover transition duration-300 ${busy || failed ? "scale-110 blur-[3px] brightness-75" : ""}`}
            />
          ) : (
            <video
              src={u.url!}
              muted
              playsInline
              preload="metadata"
              className={`h-full w-full object-cover ${busy || failed ? "blur-[3px] brightness-75" : ""}`}
            />
          )
        ) : (
          <span className={busy ? "opacity-40" : ""}>{u.kind === "pdf" ? "PDF" : u.kind === "audio" ? "🎵" : extOf(u.name)}</span>
        )}
        {busy && (
          <span className="absolute inset-0 grid place-items-center">
            <ProgressRing pct={u.progress} size={30} />
          </span>
        )}
        {done && (
          <span
            className="absolute bottom-0.5 right-0.5 grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-[9px] text-white"
            aria-label="Ready"
          >
            ✓
          </span>
        )}
        {failed && <span className="absolute inset-0 grid place-items-center bg-black/40 text-sm text-white">!</span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{u.name}</span>
        <span className={`block text-[10px] ${failed ? "line-clamp-2 text-danger" : "truncate text-muted"}`}>
          {busy
            ? `${formatSize(u.size)} · Uploading ${u.progress}%`
            : done
              ? `${formatSize(u.size)} · Ready to send`
              : `Upload failed — ${u.error ?? "try again"}`}
        </span>
        <span className="mt-1 block h-[3px] w-full overflow-hidden rounded-full bg-ink/10">
          <span
            className={`block h-full rounded-full transition-[width] duration-300 ${failed ? "bg-danger" : done ? "bg-emerald-500" : "bg-volt"}`}
            style={{ width: `${failed ? 100 : u.progress}%` }}
          />
        </span>
      </span>
      {failed && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold text-volt hover:bg-ink/5"
        >
          Retry
        </button>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={busy ? `Cancel upload of ${u.name}` : `Remove ${u.name}`}
        title={busy ? "Cancel upload" : "Remove"}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs text-muted hover:bg-ink/10 hover:text-ink"
      >
        ✕
      </button>
    </div>
  );
}
