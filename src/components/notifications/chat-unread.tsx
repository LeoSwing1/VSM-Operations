"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { openChannel } from "@/lib/supabase/browser";

/** Live chat-inbox badge. Recounts on every new chat notification and whenever you open a conversation. */
export function ChatUnread({ employeeId }: { employeeId: string }) {
  const [total, setTotal] = useState(0);
  const path = usePathname();
  const timer = useRef<number | null>(null);
  const refresh = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const r = await fetch("/api/chat/unread", { cache: "no-store" });
        if (r.ok) setTotal(((await r.json()) as { total: number }).total);
      } catch {
        /* offline: keep the last value */
      }
    }, 400);
  }, []);

  useEffect(() => refresh(), [path, refresh]);
  useEffect(() => {
    const stop = openChannel(`chat-inbox:${employeeId}`, (channel) =>
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `recipient_id=eq.${employeeId}` },
        (p) => {
          const row = (p.new ?? p.old) as { category?: string };
          if (!row?.category || row.category.startsWith("CHAT")) refresh();
        },
      ),
    );
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    const beat = window.setInterval(() => document.visibilityState === "visible" && refresh(), 30000);
    return () => {
      window.clearInterval(beat);
      stop();
      window.removeEventListener("focus", onFocus);
    };
  }, [employeeId, refresh]);

  if (!total) return null;
  return (
    <span className="rounded-full bg-signal px-1.5 text-[10px] font-bold text-white" aria-label={`${total} unread chat messages`}>
      {total > 99 ? "99+" : total}
    </span>
  );
}
