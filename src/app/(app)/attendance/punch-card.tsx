"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { nextActions, summariseDayEvents, type AttendanceEvent } from "@/lib/engines/attendance";
import { punch } from "./actions";

const LABEL = { CLOCK_IN: "Clock in", CLOCK_OUT: "Clock out", BREAK_START: "Start break", BREAK_END: "End break" } as const;

export function PunchCard({ events, tz }: { events: AttendanceEvent[]; tz: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => { const t = setInterval(() => setNow(new Date().toISOString()), 30_000); return () => clearInterval(t); }, []);

  const actions = nextActions(events);
  const s = useMemo(() => summariseDayEvents(events, now), [events, now]);
  const state = actions[0] === "CLOCK_IN" ? (events.length ? "Clocked out" : "Not clocked in") : actions[0] === "BREAK_END" ? "On break" : "Working";
  const h = Math.floor(s.workedMinutes / 60), m = s.workedMinutes % 60;
  const fmt = (iso: string | null) => iso ? new Intl.DateTimeFormat("en-IN", { timeStyle: "short", timeZone: tz }).format(new Date(iso)) : "—";

  return (
    <section className="card flex flex-col justify-between p-6 rise" aria-live="polite">
      <div>
        <p className="eyebrow">Today · {state}</p>
        <p className="display mt-3 text-6xl tabular-nums">{h}<span className="text-muted">h</span> {String(m).padStart(2, "0")}<span className="text-muted">m</span></p>
        <p className="mt-2 text-xs text-muted">In {fmt(s.firstIn)} · Out {fmt(s.lastOut)} · Break {s.breakMinutes}m</p>
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        {actions.map((a, i) => (
          <button key={a} disabled={pending} className={i === 0 && a !== "BREAK_START" ? "btn-primary" : "btn-ghost"}
            onClick={() => start(async () => { const r = await punch(a); setMsg({ ok: r.ok, text: r.message }); router.refresh(); })}>
            {pending ? "Saving…" : LABEL[a]}
          </button>
        ))}
      </div>
      {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-volt" : "text-danger"}`}>{msg.text}</p>}
    </section>
  );
}
