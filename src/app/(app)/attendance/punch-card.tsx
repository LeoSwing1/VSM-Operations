"use client";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { stableNow, useNow } from "@/lib/use-now";
import { nextActions, type AttendanceEvent } from "@/lib/engines/attendance";
import { hms, liveClock } from "@/lib/engines/clock";
import { enqueuePunch, flushQueue, getPosition, loadQueue } from "@/lib/offline-punches";
import { SelfieCapture } from "@/components/selfie-capture";
import { punch, punchRequirements } from "./actions";

type Act = "CLOCK_IN" | "CLOCK_OUT" | "BREAK_START" | "BREAK_END";
const LABEL = { CLOCK_IN: "Clock in", CLOCK_OUT: "Clock out", BREAK_START: "Start break", BREAK_END: "End break" } as const;
const STATE = { OFF: "Not clocked in", WORKING: "Working", BREAK: "On break", DONE: "Clocked out" } as const;
type Req = Awaited<ReturnType<typeof punchRequirements>>;

/** Live clock + punch buttons. Shares location (when offices are set up), takes a selfie (if required) and works offline. */
export function PunchCard({ events, tz, targetMinutes = 480 }: { events: AttendanceEvent[]; tz: string; targetMinutes?: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [optimistic, setOptimistic] = useState<AttendanceEvent[] | null>(null);
  const [req, setReq] = useState<Req | null>(null);
  const [selfieFor, setSelfieFor] = useState<Act | null>(null);
  const [queued, setQueued] = useState(0);
  const [step, setStep] = useState("");
  const evs = optimistic ?? events;
  useEffect(() => setOptimistic(null), [events]);
  const [ticking, setTicking] = useState(false);
  const now = useNow(ticking);
  const c = useMemo(() => liveClock(evs, now ?? stableNow(evs)), [evs, now]);
  useEffect(() => setTicking(c.state === "WORKING" || c.state === "BREAK"), [c.state]);

  const sync = useCallback(async () => {
    if (!loadQueue().length || !navigator.onLine) return setQueued(loadQueue().length);
    const r = await flushQueue((p) => punch(p.type, { lat: p.lat, lng: p.lng, accuracy: p.accuracy, offlineAt: p.at, source: "MOBILE" }));
    setQueued(loadQueue().length);
    if (r.sent || r.failed.length) {
      setMsg({
        ok: !r.failed.length,
        text: `${r.sent} offline punch${r.sent === 1 ? "" : "es"} synced.${r.failed.length ? ` ${r.failed.length} refused: ${r.failed[0]!.message}` : ""}`,
      });
      router.refresh();
    }
  }, [router]);

  useEffect(() => {
    punchRequirements()
      .then(setReq)
      .catch(() => setReq(null));
    void sync();
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, [sync]);

  const actions = nextActions(evs) as Act[];
  const pct = Math.min(1, c.workedMs / (targetMinutes * 60_000));
  const R = 70,
    C = 2 * Math.PI * R;
  const first = evs.find((e) => e.event_type === "CLOCK_IN")?.occurred_at;
  const fmt = (iso?: string) => (iso ? new Intl.DateTimeFormat("en-IN", { timeStyle: "short", timeZone: tz }).format(new Date(iso)) : "—");

  async function doPunch(a: Act, photo: Blob | null) {
    const stamp = new Date().toISOString();
    setOptimistic([...evs, { event_type: a, occurred_at: stamp }]); // clock reacts instantly
    const wantsLocation = (a === "CLOCK_IN" || a === "CLOCK_OUT") && !!req && (req.offices > 0 || req.requireLocation);
    setStep(wantsLocation ? "Getting your location…" : "Saving…");
    const pos = wantsLocation ? await getPosition() : null;
    if (wantsLocation && !pos && req?.requireLocation) {
      setOptimistic(null);
      setStep("");
      return setMsg({ ok: false, text: "Location is required. Allow location for this site (🔒 in the address bar) and try again." });
    }
    const opts = { lat: pos?.lat ?? null, lng: pos?.lng ?? null, accuracy: pos?.accuracy ?? null, source: "WEB" as const };
    if (!navigator.onLine) {
      if (req && !req.allowOffline) {
        setOptimistic(null);
        setStep("");
        return setMsg({ ok: false, text: "You're offline and offline punches are switched off." });
      }
      enqueuePunch({ type: a, at: stamp, ...opts });
      setQueued(loadQueue().length);
      setStep("");
      return setMsg({ ok: true, text: "No internet — punch saved on this device. It will sync automatically." });
    }
    setStep("Saving…");
    let fd: FormData | undefined;
    if (photo) {
      fd = new FormData();
      fd.set("selfie", new File([photo], "selfie.jpg", { type: "image/jpeg" }));
    }
    try {
      const r = await punch(a, opts, fd);
      if (!r.ok) setOptimistic(null);
      setMsg({ ok: r.ok, text: r.message });
    } catch {
      enqueuePunch({ type: a, at: stamp, ...opts });
      setQueued(loadQueue().length);
      setMsg({ ok: true, text: "Connection dropped — punch saved on this device and will sync automatically." });
    }
    setStep("");
    router.refresh();
  }

  const click = (a: Act) => {
    if (a === "CLOCK_IN" && req && req.selfie !== "OFF" && navigator.onLine) return setSelfieFor(a);
    start(() => doPunch(a, null));
  };

  return (
    <section className="card flex flex-col gap-6 p-6 rise sm:flex-row sm:items-center" aria-live="polite">
      {selfieFor && (
        <SelfieCapture
          required={req?.selfie === "REQUIRED"}
          onCancel={() => setSelfieFor(null)}
          onDone={(photo) => {
            const a = selfieFor;
            setSelfieFor(null);
            start(() => doPunch(a, photo));
          }}
        />
      )}
      <div className="relative mx-auto h-44 w-44 shrink-0">
        <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="80" cy="80" r={R} fill="none" strokeWidth="10" className="stroke-line" />
          <circle
            cx="80"
            cy="80"
            r={R}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            stroke="#D7FF3A"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - pct)}
            className="transition-[stroke-dashoffset] duration-1000"
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="font-mono text-2xl font-semibold tabular-nums" aria-label="Time worked today" suppressHydrationWarning>
              {hms(c.workedMs)}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-muted">
              {Math.round(pct * 100)}% of {Math.round(targetMinutes / 60)}h
            </p>
          </div>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="eyebrow flex items-center gap-2">
          <span
            className={clsx(
              "h-2 w-2 rounded-full",
              c.state === "WORKING" ? "animate-pulse bg-volt" : c.state === "BREAK" ? "bg-ember" : "bg-line",
            )}
          />
          Today · {STATE[c.state]}
        </p>
        <p className="mt-2 text-sm text-muted">
          In {fmt(first)} · Break {hms(c.breakMs).slice(0, 5)}
          {c.state === "BREAK" && <span className="ml-2 font-mono text-ember">break running</span>}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {actions.map((a, i) => (
            <button
              key={a}
              disabled={pending}
              className={`${i === 0 && a !== "BREAK_START" ? "btn-primary" : "btn-ghost"} min-h-12 flex-1 touch-manipulation sm:flex-none`}
              onClick={() => click(a)}
            >
              {pending ? step || "Saving…" : LABEL[a]}
            </button>
          ))}
        </div>
        {req && (req.offices > 0 || req.selfie !== "OFF") && (
          <p className="mt-3 text-[11px] text-muted">
            {req.offices > 0 && `📍 Location is checked against your office${req.geofence === "ENFORCE" ? " (required)" : ""}. `}
            {req.selfie !== "OFF" && `📷 Selfie at clock-in ${req.selfie === "REQUIRED" ? "required" : "optional"}.`}
          </p>
        )}
        {queued > 0 && (
          <p className="mt-2 text-xs text-ember">
            ⏳ {queued} punch{queued === 1 ? "" : "es"} waiting to sync
          </p>
        )}
        {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-volt" : "text-danger"}`}>{msg.text}</p>}
      </div>
    </section>
  );
}
