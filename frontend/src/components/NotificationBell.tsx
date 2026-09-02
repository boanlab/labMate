// 인앱 알림 센터 — 처리 대기 항목을 주기적으로 종(bell)에 표시, 새 항목은 브라우저 데스크톱 알림
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, silent } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "../ui/icons";
import { registerPush, pushActive } from "../lib/push";

interface Noti { id: string; title: string; sub: string; link: string; icon: string; svc?: string; read?: boolean; derived?: boolean; }
const SEEN_KEY = "labmate.notif.seen";
// 영구 알림을 조회할 서비스와 kind→아이콘 매핑
const NOTIF_SVCS = ["projects", "boards", "attendance"];
const KIND_ICON: Record<string, string> = {
  project: "folder", task: "clipboard", note: "book", notice: "bell", meeting: "users",
  comment: "chat", event: "calendar", approval: "doc", leave: "sun", attendance: "clock",
};

export function NotificationBell() {
  const { me } = useAuth();
  const nav = useNavigate();
  const [items, setItems] = useState<Noti[]>([]);
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("labmate.notif.read") || "[]"); } catch { return []; } });
  // 저장 알림은 서버 read_at, 파생 리마인더(미확인 공지·승인 대기 등)는 localStorage 로 판정.
  // 파생 항목은 실제로 처리해야 사라지지만, 오래 남는 리마인더는 종에서 임시로 닫을 수 있어야 한다.
  const isRead = (i: Noti) => (i.derived ? read.includes(i.id) : !!i.read);
  const unread = items.filter((i) => !isRead(i));
  const ref = useRef<HTMLDivElement>(null);
  function markAllRead() {
    const ids = items.map((i) => i.id); setRead(ids); localStorage.setItem("labmate.notif.read", JSON.stringify(ids));
    setItems((list) => list.map((i) => (i.derived ? i : { ...i, read: true })));   // 저장 알림 낙관적 읽음
    NOTIF_SVCS.forEach((s) => { api.post(`/${s}/notifications/read`, {}).catch(() => { /* */ }); });
  }

  useEffect(() => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") { registerPush(); return; }
    if (Notification.permission === "default") {
      try { Notification.requestPermission().then((p) => { if (p === "granted") registerPush(); }); } catch { /* */ }
    }
  }, []);

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function poll() {
    if (!me) return;
    // 예전에는 종이 목록 API(공지·회의록·과제·예산·휴가·근태정정)를 따로 받아 직접 걸렀다.
    // 폴링 1회에 요청 9건이 순차로 나갔고, 목록 전체를 받아 대부분 버리는 낭비도 있었다.
    // 지금은 각 서비스가 자기 도메인의 파생 항목까지 /notifications 로 함께 내려준다.
    const results = await Promise.all(NOTIF_SVCS.map((s) =>
      api.get<any[]>(`/${s}/notifications`, silent).then((r) => ({ s, rows: r.data || [] })).catch(() => ({ s, rows: [] as any[] }))));
    const out: Noti[] = [];
    for (const { s, rows } of results) {
      rows.forEach((n) => out.push({
        id: n.derived ? n.id : "n-" + n.id,
        title: n.title, sub: n.body, link: n.link,
        icon: KIND_ICON[n.kind] || "bell", svc: s,
        read: !!n.read_at, derived: !!n.derived,
      }));
    }
    setItems(out);
    setRead((r) => r.filter((id) => out.some((o) => o.id === id)));   // 처리된 항목은 read 목록에서도 제거
    // 새 항목 → 데스크톱 알림
    let seen: string[] = [];
    try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); } catch { /* */ }
    const fresh = out.filter((o) => !seen.includes(o.id) && !(o.svc && o.read));
    // 서버 푸시(SW)가 활성이면 OS 알림은 그쪽에서 처리 → 폴링 중복 알림 억제
    if (fresh.length && !pushActive() && "Notification" in window && Notification.permission === "granted") {
      const n = fresh[0];
      try { new Notification("LabMate 알림", { body: n.title + " · " + n.sub + (fresh.length > 1 ? ` 외 ${fresh.length - 1}건` : ""), tag: "labmate" }); } catch { /* */ }
    }
    localStorage.setItem(SEEN_KEY, JSON.stringify(out.map((o) => o.id)));
  }

  useEffect(() => {
    poll();
    // 알림 1회 갱신에 여러 서비스를 훑기 때문에, 보고 있지도 않은 탭에서 45초마다 도는 것은 낭비다.
    // 화면이 보일 때만 돌리고, 다시 보이는 순간 한 번 갱신한다.
    const tick = () => { if (!document.hidden) poll(); };
    const t = setInterval(tick, 45000);
    const onFocus = () => poll();                 // 탭 복귀/처리 후 즉시 갱신
    const onVis = () => { if (!document.hidden) poll(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  function go(n: Noti) { setOpen(false); nav(n.link); }

  return (
    <div className="usermenu" ref={ref}>
      <button className="appbar-icon" data-testid="notif-bell" aria-label="알림" onClick={() => setOpen((v) => { if (!v) markAllRead(); return !v; })} style={{ position: "relative" }}>
        <Icon name="bell" size={17} />
        {unread.length > 0 && <span className="notif-badge" data-testid="notif-count">{unread.length > 9 ? "9+" : unread.length}</span>}
      </button>
      {open && (
        <div className="menu-pop" role="menu" data-testid="notif-pop" style={{ width: 320 }}>
          <div className="menu-head"><b>알림</b><span className="muted small"> {items.length}건 처리 대기</span></div>
          {items.map((n) => (
            <button key={n.id} role="menuitem" onClick={() => go(n)} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
              <span style={{ opacity: .7, marginTop: 1 }}><Icon name={n.icon} size={15} /></span>
              <span style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600 }}>{n.title}</div><div className="muted small" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.sub}</div></span>
            </button>
          ))}
          {!items.length && <div className="muted small" style={{ padding: "10px 12px", textAlign: "center" }}>새 알림이 없습니다 🎉</div>}
        </div>
      )}
    </div>
  );
}
