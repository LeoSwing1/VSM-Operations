"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registerPush } from "./actions";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function PushOptIn({ vapidKey }: { vapidKey: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "unsupported" | "denied" | "ready" | "subscribed">("checking");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !vapidKey) return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    navigator.serviceWorker
      .register("/sw.js")
      .then(async (reg) => setState((await reg.pushManager.getSubscription()) ? "subscribed" : "ready"))
      .catch(() => setState("unsupported"));
  }, [vapidKey]);

  const enable = () =>
    start(async () => {
      try {
        if ((await Notification.requestPermission()) !== "granted") {
          setState("denied");
          return;
        }
        const reg = await navigator.serviceWorker.register("/sw.js");
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey!) }));
        const r = await registerPush(sub.toJSON(), navigator.userAgent);
        setMsg(r.message);
        if (r.ok) {
          setState("subscribed");
          router.refresh();
        }
      } catch (e) {
        setMsg((e as Error).message);
      }
    });

  if (state === "unsupported")
    return (
      <p className="text-sm text-muted">
        {vapidKey ? "This browser doesn't support push notifications." : "Push isn't configured yet (admin: add VAPID keys)."}
      </p>
    );
  if (state === "denied")
    return (
      <p className="text-sm text-ember">
        Notifications are blocked for this site. Allow them in the browser&apos;s site settings, then reload.
      </p>
    );
  return (
    <div className="flex flex-wrap items-center gap-3">
      {state === "subscribed" ? (
        <span className="text-sm text-volt">✓ This device receives push notifications</span>
      ) : (
        <button type="button" className="btn-primary" disabled={pending || state === "checking"} onClick={enable}>
          {pending ? "Enabling…" : "Turn on push for this device"}
        </button>
      )}
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </div>
  );
}
