// Web Push(PWA) — 서비스 워커 등록 + 푸시 구독을 3개 서비스에 저장
import { api } from "../api/client";

const SVCS = ["projects", "boards", "attendance"];
let active = false;                       // 구독 성공 시 true → 폴링 데스크톱 알림 중복 방지
export const pushActive = () => active;

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// 로그인 상태에서 호출. 권한이 granted 일 때만 구독한다.
export async function registerPush(): Promise<void> {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
    const reg = await navigator.serviceWorker.register("/sw.js");
    if (Notification.permission !== "granted") return;

    const { data } = await api.get<{ key: string }>("/boards/push/public-key");
    if (!data?.key) return;                // 서버에 VAPID 미설정 → 푸시 비활성

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.key) as BufferSource,
      });
    }
    const j: any = sub.toJSON();
    const payload = { endpoint: j.endpoint, keys: j.keys, ua: navigator.userAgent };
    // 구독을 3개 서비스에 모두 등록(각 서비스가 자기 알림 발생 시 푸시)
    await Promise.all(SVCS.map((s) => api.post(`/${s}/push/subscribe`, payload).catch(() => { /* */ })));
    active = true;
  } catch { /* 미지원/거부 등 — 인앱 알림으로 대체 */ }
}
