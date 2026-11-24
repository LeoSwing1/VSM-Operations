"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { draftClientReport, summariseUpdates, type AiState } from "./actions";

type Msg = { role: "user" | "assistant"; content: string };
const EXAMPLES = [
  "Aaj kaun kaun clock-in hai aur kaun late hai?",
  "Which of my tasks are due this week?",
  "Kaunse leads ka follow-up aaj due hai?",
  "Summarise yesterday's blockers for my team",
];

export function AskOps({ language }: { language: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [lang, setLang] = useState(language);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), [msgs, busy]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next = [...msgs, { role: "user" as const, content: q }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next, language: lang }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
      setMsgs([...next, { role: "assistant", content: json.reply }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
      setMsgs(msgs);
      setInput(q);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[28rem] flex-col">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-muted">Sees only what you can see · can't change anything · chats aren't saved</p>
        <div className="flex gap-2">
          <select value={lang} onChange={(e) => setLang(e.target.value)} className="input w-32" aria-label="Language">
            <option value="HINGLISH">Hinglish</option>
            <option value="ENGLISH">English</option>
            <option value="HINDI">Hindi</option>
          </select>
          {msgs.length > 0 && (
            <button type="button" className="btn-ghost" onClick={() => setMsgs([])}>
              New chat
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-line p-4" aria-live="polite">
        {!msgs.length && (
          <div className="grid gap-2 sm:grid-cols-2">
            {EXAMPLES.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => send(e)}
                className="rounded-xl border border-line p-3 text-left text-sm text-muted hover:text-ink"
              >
                {e}
              </button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-auto max-w-[85%] rounded-2xl bg-ink px-4 py-2 text-sm text-paper"
                : "max-w-[92%] whitespace-pre-wrap rounded-2xl border border-line px-4 py-3 text-sm"
            }
          >
            {m.content}
          </div>
        ))}
        {busy && <p className="text-sm text-muted">Looking it up…</p>}
        <div ref={end} />
      </div>
      {err && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {err}
        </p>
      )}
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={2000}
          className="input flex-1"
          placeholder="Ask about tasks, attendance, leads, projects, OKRs…"
          aria-label="Your question"
        />
        <button className="btn" disabled={busy || !input.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}

function Output({ state, pending }: { state: AiState; pending: boolean }) {
  const [copied, setCopied] = useState(false);
  if (pending) return <p className="mt-4 text-sm text-muted">Writing…</p>;
  if (state.error)
    return (
      <p role="alert" className="mt-4 text-sm text-danger">
        {state.error}
      </p>
    );
  if (!state.text) return null;
  return (
    <div className="mt-4">
      <div className="whitespace-pre-wrap rounded-xl border border-line p-4 text-sm">{state.text}</div>
      <button
        type="button"
        className="btn-ghost mt-2"
        onClick={async () => {
          await navigator.clipboard.writeText(state.text!);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <p className="mt-1 text-xs text-muted">AI draft — check it before sharing.</p>
    </div>
  );
}

export function SummaryTool({ today, yesterday, language }: { today: string; yesterday: string; language: string }) {
  const [state, action, pending] = useActionState(summariseUpdates, {});
  return (
    <form action={action}>
      <div className="grid gap-3 sm:grid-cols-4">
        <label>
          <span className="label">From</span>
          <input type="date" name="from" defaultValue={yesterday} className="input" required />
        </label>
        <label>
          <span className="label">To</span>
          <input type="date" name="to" defaultValue={today} className="input" required />
        </label>
        <label>
          <span className="label">Language</span>
          <select name="language" defaultValue={language} className="input">
            <option value="HINGLISH">Hinglish</option>
            <option value="ENGLISH">English</option>
            <option value="HINDI">Hindi</option>
          </select>
        </label>
        <div className="flex items-end">
          <button className="btn" disabled={pending}>
            Summarise
          </button>
        </div>
      </div>
      <Output state={state} pending={pending} />
    </form>
  );
}

export function ReportTool({ projects, language }: { projects: { id: string; name: string; client: string | null }[]; language: string }) {
  const [state, action, pending] = useActionState(draftClientReport, {});
  return (
    <form action={action}>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="sm:col-span-2">
          <span className="label">Project</span>
          <select name="project_id" className="input" required>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.client ? ` · ${p.client}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Format</span>
          <select name="kind" className="input">
            <option value="REPORT">Monthly report</option>
            <option value="EMAIL">Email</option>
            <option value="WHATSAPP">WhatsApp</option>
          </select>
        </label>
        <label>
          <span className="label">Language</span>
          <select name="language" defaultValue={language} className="input">
            <option value="HINGLISH">Hinglish</option>
            <option value="ENGLISH">English</option>
            <option value="HINDI">Hindi</option>
          </select>
        </label>
        <label className="sm:col-span-3">
          <span className="label">Anything to add (optional)</span>
          <input
            name="notes"
            maxLength={1500}
            className="input"
            placeholder="e.g. Diwali campaign got 2.3x reach; ask for new product photos"
          />
        </label>
        <div className="flex items-end">
          <button className="btn" disabled={pending || !projects.length}>
            Draft
          </button>
        </div>
      </div>
      <Output state={state} pending={pending} />
    </form>
  );
}
