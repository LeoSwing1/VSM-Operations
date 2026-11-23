/* VSM Ops service worker — web push + an offline fallback page. Private pages and API responses are never cached. */
const OFFLINE = "/offline";
const CACHE = "vsm-offline-v1";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return; // only page loads, and only when the network fails
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});
self.addEventListener("push", (event) => {
  let data = { title: "VSM Ops", body: "", url: "/notifications", tag: "" };
  try { data = { ...data, ...event.data.json() }; } catch (_) {}
  const url = typeof data.url === "string" && /^\/(?![/\\])/.test(data.url) ? data.url : "/notifications";
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, tag: data.tag || undefined, data: { url }, icon: "/icons/icon-192.png", badge: "/icons/icon-72.png",
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/notifications", self.location.origin);
  const url = target.origin === self.location.origin ? target.href : self.location.origin + "/notifications";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) if (c.url.startsWith(self.location.origin)) { await c.focus(); return c.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
