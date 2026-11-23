"use client";

import { useEffect, useState } from "react";

export function DesktopAlerts() {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [busy, setBusy] = useState(false);
  useEffect(() => setPermission("Notification" in window ? Notification.permission : "unsupported"), []);
  async function enable() {
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setBusy(true);
    try {
      setPermission(await Notification.requestPermission());
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {permission === "granted" ? (
        <span className="text-emerald-600">Desktop alerts enabled</span>
      ) : permission === "unsupported" ? (
        <span className="text-muted">Desktop alerts are not supported in this browser</span>
      ) : permission === "denied" ? (
        <span className="text-muted">Alerts blocked by browser settings</span>
      ) : (
        <button type="button" onClick={enable} disabled={busy} className="btn-ghost">
          {busy ? "Requesting…" : "Enable desktop alerts"}
        </button>
      )}
    </div>
  );
}
