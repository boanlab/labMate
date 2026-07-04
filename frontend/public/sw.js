/* LabMate 서비스 워커 — 앱 셸 캐시(오프라인·설치 요건) + Web Push 수신/클릭 */
const CACHE = "labmate-shell-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => { /* 오프라인 설치 시 무시 */ }));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;                                   // API POST 등은 통과
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                    // 외부 요청 통과
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/uploads/")) return;   // 데이터·업로드는 항상 네트워크
  if (url.pathname.startsWith("/assets/")) {                          // 해시된 정적 자산 — 캐시 우선
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => { /* */ });
      return res;
    })));
    return;
  }
  // 내비게이션(HTML) — 네트워크 우선, 오프라인 시 캐시된 앱 셸
  event.respondWith(fetch(req).catch(() => caches.match(req).then((hit) => hit || caches.match("/index.html"))));
});

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
