// 인앱 알림 센터 — 처리 대기 항목을 주기적으로 종(bell)에 표시, 새 항목은 브라우저 데스크톱 알림
import { useEffect, useRef, useState } from "react";
import { todayKST } from "../lib/date";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "../ui/icons";
import { registerPush, pushActive } from "../lib/push";

interface Noti { id: string; title: string; sub: string; link: string; icon: string; svc?: string; read?: boolean; }
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
  // 영구 알림은 서버 read_at, 파생 리마인더는 localStorage 로 읽음 판정
  const isRead = (i: Noti) => (i.svc ? !!i.read : read.includes(i.id));
  const unread = items.filter((i) => !isRead(i));
  const ref = useRef<HTMLDivElement>(null);
  const isMgr = !!me && (["prof", "staff", "admin"].includes(me.role) || !!me.delegated_admin);
  function markAllRead() {
    const ids = items.map((i) => i.id); setRead(ids); localStorage.setItem("labmate.notif.read", JSON.stringify(ids));
    setItems((list) => list.map((i) => (i.svc ? { ...i, read: true } : i)));   // 영구 알림 낙관적 읽음
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
    const out: Noti[] = [];
    const today = todayKST();
    // 영구 알림(서버 저장) — 참여자/담당자 지정·결재 요청/결과·댓글 등
    for (const s of NOTIF_SVCS) {
      try {
        const rows = (await api.get<any[]>(`/${s}/notifications`)).data || [];
        rows.forEach((n) => out.push({ id: "n-" + n.id, title: n.title, sub: n.body, link: n.link, icon: KIND_ICON[n.kind] || "bell", svc: s, read: !!n.read_at }));
      } catch { /* */ }
    }
    // 관리자: 승인 대기 요청(역할 기반 → 파생 유지)
    if (isMgr) {
      try {
        const lv = (await api.get<any[]>("/attendance/leaves/inbox")).data || [];
        lv.forEach((l) => out.push({ id: "lv-" + l.id, title: "휴가 승인 요청", sub: `${l.type} ${l.start_date}~${l.end_date}`, link: "/leave", icon: "sun" }));
      } catch { /* */ }
      try {
        const cr = (await api.get<any[]>("/attendance/attendance/correct-requests")).data || [];
        cr.forEach((r) => { if (r.status === "대기") out.push({ id: "cr-" + r.id, title: "근태 정정 요청", sub: `${r.date} · ${r.reason || ""}`, link: "/att-admin", icon: "clock" }); });
      } catch { /* */ }
    }
    try {
      const mts = (await api.get<any[]>("/boards/meetings")).data || [];
      mts.forEach((m) => (m.actions || []).forEach((a: any) => {
        if (a.assignee_id === me.id && !a.done) out.push({ id: "act-" + a.id, title: "내 할 일" + (a.due && a.due <= today ? " (마감 도래)" : ""), sub: a.title, link: "/meetings", icon: "clipboard" });
      }));
    } catch { /* */ }
    try {
      const nt = (await api.get<any[]>("/boards/notices")).data || [];
      nt.forEach((n) => { if (n.required && !(n.acked_user_ids || []).includes(me.id)) out.push({ id: "nt-" + n.id, title: "필독 공지 미확인", sub: n.title, link: "/notices", icon: "bell" }); });
    } catch { /* */ }

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
    const t = setInterval(poll, 45000);
    const onFocus = () => poll();                 // 탭 복귀/처리 후 즉시 갱신
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
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
