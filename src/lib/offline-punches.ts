/** Browser-side queue for punches made without internet. Synced in order as soon as the device is back online. */
export interface QueuedPunch {
  id: string;
  type: "CLOCK_IN" | "CLOCK_OUT" | "BREAK_START" | "BREAK_END";
  at: string; // ISO time on the device when the button was pressed
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
}
const KEY = "vsm-offline-punches";

export function loadQueue(): QueuedPunch[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? (raw as QueuedPunch[]).filter((p) => p && typeof p.at === "string" && typeof p.type === "string") : [];
  } catch {
    return [];
  }
}
export function saveQueue(q: QueuedPunch[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q.slice(-20)));
  } catch {
    /* storage full or blocked */
  }
}
export function enqueuePunch(p: Omit<QueuedPunch, "id">): QueuedPunch {
  const item = { ...p, id: crypto.randomUUID() };
  saveQueue([...loadQueue(), item]);
  return item;
}

/** Sends queued punches oldest-first. Stops at the first refusal that isn't a network error, and drops it with a reason. */
export async function flushQueue(
  send: (p: QueuedPunch) => Promise<{ ok: boolean; message: string }>,
): Promise<{ sent: number; failed: { punch: QueuedPunch; message: string }[] }> {
  const q = loadQueue().sort((a, b) => a.at.localeCompare(b.at));
  let sent = 0;
  const failed: { punch: QueuedPunch; message: string }[] = [];
  const left: QueuedPunch[] = [];
  for (let i = 0; i < q.length; i++) {
    const p = q[i]!;
    try {
      const r = await send(p);
      if (r.ok) sent++;
      else failed.push({ punch: p, message: r.message });
    } catch {
      left.push(...q.slice(i)); // still offline — keep the rest
      break;
    }
  }
  saveQueue(left);
  return { sent, failed };
}

export function getPosition(timeoutMs = 8000): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}
