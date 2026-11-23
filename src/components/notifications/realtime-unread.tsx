"use client";

import { useEffect, useState } from "react";
import { openChannel } from "@/lib/supabase/browser";

type Notice = { id: string; title: string; body?: string | null; link?: string | null };

export function RealtimeUnread({ employeeId, initialUnread }: { employeeId: string; initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);
  const [toast, setToast] = useState<Notice | null>(null);

  useEffect(() => setUnread(initialUnread), [initialUnread]);

  useEffect(() => {
    let active = true;
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = openChannel(`notifications:${employeeId}`, (channel) =>
      channel
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${employeeId}` },
          (payload) => {
            if (!active) return;
            setUnread((n) => n + 1);
            const row = payload.new as Notice;
            setToast(row);
            if (toastTimer) clearTimeout(toastTimer);
            toastTimer = setTimeout(() => setToast(null), 6000);
            // Windows / macOS desktop alert: when the tab is in the background, or for a chat you are not looking at.
            const elsewhere = !!row.link && row.link.startsWith("/chat/") && window.location.pathname !== row.link;
            if ((document.visibilityState === "hidden" || elsewhere) && "Notification" in window && Notification.permission === "granted") {
              const notice = new Notification(row.title, {
                body: row.body ?? "You have a new VSM Ops notification.",
                tag: row.id, // same tag as the web-push copy, so Windows shows it once
                icon: "/icons/icon-192.png",
                badge: "/icons/icon-192.png",
              });
              notice.onclick = () => {
                window.focus();
                if (row.link?.startsWith("/")) window.location.assign(row.link);
              };
            }
          },
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "notifications", filter: `recipient_id=eq.${employeeId}` },
          (payload) => {
            if (!active) return;
            const before = payload.old as { read_at?: string | null };
            const after = payload.new as { read_at?: string | null };
            if (!before.read_at && after.read_at) setUnread((n) => Math.max(0, n - 1));
            else if (before.read_at && !after.read_at) setUnread((n) => n + 1);
          },
        ),
    );

    return () => {
      active = false;
      stop();
      if (toastTimer) clearTimeout(toastTimer);
    };
  }, [employeeId]);

  return (
    <>
      {unread > 0 && (
        <span className="rounded-full bg-volt px-1.5 text-[10px] font-bold text-[#0b0b0c]">{unread > 99 ? "99+" : unread}</span>
      )}
      {toast && (
        <div
          className="fixed bottom-4 right-4 z-[80] w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-line bg-panel p-4 shadow-xl"
          role="status"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-volt">New notification</p>
              <p className="mt-1 text-sm font-semibold">{toast.title}</p>
              {toast.body && <p className="mt-1 text-xs text-muted">{toast.body}</p>}
              {toast.link?.startsWith("/") && (
                <a className="mt-2 inline-block text-xs font-semibold underline" href={toast.link}>
                  Open
                </a>
              )}
            </div>
            <button type="button" aria-label="Dismiss notification" className="text-muted" onClick={() => setToast(null)}>
              ×
            </button>
          </div>
        </div>
      )}
    </>
  );
}
