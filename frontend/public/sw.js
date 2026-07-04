/* LabMate 서비스 워커 — Web Push 수신 및 클릭 처리 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) { d = {}; }
  const title = d.title || "LabMate 알림";
  const options = {
    body: d.body || "",
    tag: d.tag || "labmate",
    data: { url: d.url || "/" },
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    renotify: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cls) => {
      for (const c of cls) {
        if ("focus" in c) { try { c.navigate(url); } catch (_) { /* */ } return c.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});
