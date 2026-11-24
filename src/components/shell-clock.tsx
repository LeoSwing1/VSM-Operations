"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { stableNow, useNow } from "@/lib/use-now";
import type { AttendanceEvent } from "@/lib/engines/attendance";
import { hms, liveClock } from "@/lib/engines/clock";
import { LiveSync } from "./live-sync";

/** Small always-visible work clock in the sidebar; it stays in sync with every device through Realtime. */
export function ShellClock({ events, employeeId }: { events: AttendanceEvent[]; employeeId: string }) {
  const [ticking, setTicking] = useState(false);
  const now = useNow(ticking);
  const c = useMemo(() => liveClock(events, now ?? stableNow(events)), [events, now]);
  useEffect(() => setTicking(c.state === "WORKING" || c.state === "BREAK"), [c.state]);
  return (
    <Link
      href="/attendance"
      className="mb-6 flex items-center justify-between rounded-xl border border-line px-3 py-2 hover:border-volt/50"
      aria-label="Today's work clock"
    >
      <LiveSync tables={["attendance_events"]} filter={`employee_id=eq.${employeeId}`} />
      <span className="flex items-center gap-2 text-xs">
        <span
          className={clsx(
            "h-2 w-2 rounded-full",
            c.state === "WORKING" ? "animate-pulse bg-volt" : c.state === "BREAK" ? "bg-ember" : "bg-line",
          )}
        />
        {c.state === "OFF" ? "Clock in" : c.state === "BREAK" ? "On break" : c.state === "DONE" ? "Clocked out" : "Working"}
      </span>
      <span className="font-mono text-sm tabular-nums" suppressHydrationWarning>
        {hms(c.workedMs)}
      </span>
    </Link>
  );
}
