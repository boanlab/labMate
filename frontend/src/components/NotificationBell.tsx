// 인앱 알림 센터 — 처리 대기 항목을 주기적으로 종(bell)에 표시, 새 항목은 브라우저 데스크톱 알림
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, silent } from "../api/client";
import { usePref } from "../api/prefs";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "../ui/icons";
import { registerPush, pushActive } from "../lib/push";

interface Noti { id: string; title: string; sub: string; link: string; icon: string; svc?: string; read?: boolean; derived?: boolean; }
// 데스크톱 알림 중복 방지용 — 이것만은 기기별이어야 한다(PC 마다 한 번씩 떠야 하므로 계정에 두지 않는다).
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
  // 파생 리마인더를 종에서 닫은 기록도 계정에 둔다 — 노트북에서 닫은 것이 데스크톱에서 되살아나지 않도록
  const [read, setRead] = usePref<string[]>("notif_read", []);
  // 딥워크 시간에는 데스크톱 알림을 띄우지 않는다(종 배지는 그대로 — 놓치면 안 되므로).
  const [deep] = usePref<{ on: boolean; from: string; to: string }>("deep_work", { on: false, from: "", to: "" });
  // 읽음 판정 — 저장 알림은 서버 read_at, 파생 리마인더는 계정 설정(임시로 닫아 둘 수 있게).
  const isRead = (i: Noti) => (i.derived ? read.includes(i.id) : !!i.read);
  const unread = items.filter((i) => !isRead(i));
  const ref = useRef<HTMLDivElement>(null);
  function markAllRead() {
    const ids = items.map((i) => i.id); setRead(ids);
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
    // 각 서비스가 저장 알림 + 파생 항목을 /notifications 로 함께 내려준다(3개 서비스 병렬 조회).
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
    setRead(read.filter((id) => out.some((o) => o.id === id)));      // 처리된 항목은 read 목록에서도 제거
    // 새 항목 → 데스크톱 알림
    let seen: string[] = [];
    try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); } catch { /* */ }
    const fresh = out.filter((o) => !seen.includes(o.id) && !(o.svc && o.read));
    // 서버 푸시(SW)가 활성이면 OS 알림은 그쪽에서 처리 → 폴링 중복 알림 억제
    if (fresh.length && !inDeepWork() && !pushActive() && "Notification" in window && Notification.permission === "granted") {
      const n = fresh[0];
      try { new Notification("LabMate 알림", { body: n.title + " · " + n.sub + (fresh.length > 1 ? ` 외 ${fresh.length - 1}건` : ""), tag: "labmate" }); } catch { /* */ }
    }
    localStorage.setItem(SEEN_KEY, JSON.stringify(out.map((o) => o.id)));
  }

  useEffect(() => {
    poll();
    // 폴링 45초 — 화면이 보일 때만, 탭 복귀 시 즉시 1회.
    const tick = () => { if (!document.hidden) poll(); };
    const t = setInterval(tick, 45000);
    const onFocus = () => poll();                 // 탭 복귀/처리 후 즉시 갱신
    const onVis = () => { if (!document.hidden) poll(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  /** 지금이 딥워크 시간인지 — 자정을 넘기는 설정도 처리한다. */
  function inDeepWork(): boolean {
    if (!deep?.on || !deep.from || !deep.to) return false;
    const now = new Date().toTimeString().slice(0, 5);
    return deep.from <= deep.to ? now >= deep.from && now < deep.to : now >= deep.from || now < deep.to;
  }

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
