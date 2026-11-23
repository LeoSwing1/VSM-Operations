"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Re-renders the server page every N seconds while the tab is visible. */
export function AutoRefresh({ seconds = 30, renderedAt }: { seconds?: number; renderedAt: string }) {
  const router = useRouter();
  const [on, setOn] = useState(true);
  const [left, setLeft] = useState(seconds);
  useEffect(() => setLeft(seconds), [renderedAt, seconds]);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setLeft((s) => {
        if (s <= 1) {
          router.refresh();
          return seconds;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [on, router, seconds]);
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <span className={on ? "h-2 w-2 animate-pulse rounded-full bg-volt" : "h-2 w-2 rounded-full bg-line"} aria-hidden />
      <span>{on ? `Live · refresh in ${left}s` : "Paused"}</span>
      <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setOn((v) => !v)}>
        {on ? "Pause" : "Resume"}
      </button>
      <button
        type="button"
        className="btn-ghost px-2 py-1 text-xs"
        onClick={() => {
          router.refresh();
          setLeft(seconds);
        }}
      >
        Refresh
      </button>
    </div>
  );
}
