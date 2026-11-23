"use client";
import { useEffect, useState } from "react";
import { registerPush } from "@/app/(app)/notifications/preferences/actions";

const KEY = "vsm-notify-dismissed";
const b64 = (s: string) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from([...atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"))].map((c) => c.charCodeAt(0)));
};

/**
 * One-click "Windows notifications": asks the browser for permission, registers the service worker and,
 * when VAPID is configured, a push subscription — so chat and approvals reach the Windows notification
 * centre even when VSM Ops is closed. Shown once until enabled or dismissed.
 */
export function EnableNotifications({ vapidKey }: { vapidKey: string | null }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!("Notification" in window)) return;
    let dismissed = false;
    try {
      dismissed = !!localStorage.getItem(KEY);
    } catch {
      /* ignore */
    }
    if (Notification.permission === "default" && !dismissed) setShow(true);
    // Already allowed: make sure this device keeps a live push subscription.
    if (Notification.permission === "granted" && vapidKey && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then(async (reg) => {
          const sub =
            (await reg.pushManager.getSubscription()) ??
            (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(vapidKey) }));
          await registerPush(sub.toJSON(), navigator.userAgent);
        })
        .catch(() => {});
    }
  }, [vapidKey]);

  async function enable() {
    setBusy(true);
    try {
      const p = await Notification.requestPermission();
      if (p !== "granted") {
        setMsg("Blocked. Click the 🔒 icon in the address bar → Notifications → Allow.");
        return;
      }
      const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.register("/sw.js") : null;
      if (reg && vapidKey && "PushManager" in window) {
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(vapidKey) }));
        await registerPush(sub.toJSON(), navigator.userAgent);
      }
      const opts = { body: "You'll now get chat messages, approvals and reminders here.", icon: "/icons/icon-192.png", tag: "vsm-enabled" };
      if (reg) await reg.showNotification("VSM Ops notifications are on", opts);
      else new Notification("VSM Ops notifications are on", opts);
      setShow(false);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!show) return null;
  return (
    <div
      className="no-print mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-signal/40 bg-signal/10 px-4 py-3 text-sm"
      role="region"
      aria-label="Enable notifications"
    >
      <span aria-hidden className="text-lg">
        🔔
      </span>
      <p className="min-w-0 flex-1">
        <b>Turn on desktop notifications</b> — get chat messages, approvals and clock-in reminders in the Windows notification centre.
        {msg && <span className="block text-xs text-ember">{msg}</span>}
      </p>
      <button type="button" className="btn-primary" disabled={busy} onClick={enable}>
        {busy ? "Turning on…" : "Turn on"}
      </button>
      <button
        type="button"
        className="text-xs text-muted hover:text-ink"
        onClick={() => {
          try {
            localStorage.setItem(KEY, "1");
          } catch {
            /* ignore */
          }
          setShow(false);
        }}
      >
        Not now
      </button>
    </div>
  );
}
