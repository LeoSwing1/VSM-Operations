import type { AttendanceEvent } from "./attendance";

export type ClockState = "OFF" | "WORKING" | "BREAK" | "DONE";

/** Second-accurate live clock for today's punches. Pure — the same events give the same numbers everywhere. */
export function liveClock(events: AttendanceEvent[], nowMs: number) {
  const sorted = [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  let workedMs = 0,
    breakMs = 0;
  let inAt: number | null = null,
    breakAt: number | null = null;
  let state: ClockState = "OFF";
  for (const e of sorted) {
    const t = Date.parse(e.occurred_at);
    if (e.event_type === "CLOCK_IN" && inAt === null) {
      inAt = t;
      state = "WORKING";
    } else if (e.event_type === "BREAK_START" && inAt !== null && breakAt === null) {
      workedMs += t - inAt;
      breakAt = t;
      inAt = null;
      state = "BREAK";
    } else if (e.event_type === "BREAK_END" && breakAt !== null) {
      breakMs += t - breakAt;
      breakAt = null;
      inAt = t;
      state = "WORKING";
    } else if (e.event_type === "CLOCK_OUT") {
      if (inAt !== null) workedMs += t - inAt;
      if (breakAt !== null) breakMs += t - breakAt;
      inAt = null;
      breakAt = null;
      state = "DONE";
    }
  }
  if (inAt !== null) workedMs += Math.max(0, nowMs - inAt);
  if (breakAt !== null) breakMs += Math.max(0, nowMs - breakAt);
  return { state, workedMs: Math.max(0, workedMs), breakMs: Math.max(0, breakMs), running: state === "WORKING" };
}

export const hms = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
};
