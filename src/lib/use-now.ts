"use client";
import { useEffect, useState } from "react";

/**
 * Current time for live clocks without hydration mismatches: returns null during server render and the
 * first client render (so both draw the same thing), then the real time, ticking every second while `ticking`.
 */
export function useNow(ticking: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);
  return now;
}

/** A time both server and browser agree on before mount: the latest event, or 0 when there are none. */
export function stableNow(events: { occurred_at: string }[]): number {
  return events.reduce((m, e) => Math.max(m, Date.parse(e.occurred_at) || 0), 0);
}
