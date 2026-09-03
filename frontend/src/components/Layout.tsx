import { ReactNode, useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../ui/theme";
import { Icon } from "../ui/icons";
import { useConfig, fileUrl } from "../api/config";
import { usePref } from "../api/prefs";
import { NotificationBell } from "./NotificationBell";
import { InstallButton } from "./InstallButton";
import { TopProgress } from "./TopProgress";
import { GlobalSearch } from "./GlobalSearch";

const ROLE_LABEL: Record<string, string> = {
  prof: "지도교수", phd: "박사과정", master: "석사과정", under: "학사과정", staff: "행정", admin: "관리자",
};

// 역할 기반 메뉴 노출. 행정 위임자는 staff 권한 추가 보유.
// 관리자(admin)는 대시보드·구성원·환경설정만 사용 — ALL 에서 admin 제외.
const ALL = ["prof", "phd", "master", "under", "staff"];
const EVERYONE = [...ALL, "admin"];
// 행정(staff) 차단 모듈 — 프로젝트·전자결재·자원예약·게시판·회의록. 위임 학생은 본인 역할로 접근.
const NO_STAFF = ["prof", "phd", "master", "under"];
interface MenuItem { to: string; label: string; icon: string; roles: string[]; }
const GROUPS: { title: string; items: MenuItem[] }[] = [
  { title: "메인", items: [
    { to: "/", label: "대시보드", icon: "grid", roles: EVERYONE },
    { to: "/calendar", label: "캘린더", icon: "calendar", roles: ALL },
  ] },
  { title: "업무", items: [
    { to: "/grants", label: "연구과제", icon: "award", roles: ["prof", "phd", "master", "under", "staff"] },
    { to: "/projects", label: "프로젝트", icon: "folder", roles: NO_STAFF },
    { to: "/tasks", label: "세부업무", icon: "clipboard", roles: ["prof", "phd", "master", "under", "staff"] },
    { to: "/notes", label: "연구노트", icon: "book", roles: NO_STAFF },
    { to: "/approvals", label: "전자결재", icon: "doc", roles: NO_STAFF },
    { to: "/booking", label: "자원예약", icon: "pin", roles: NO_STAFF },
  ] },
  { title: "소통", items: [
    { to: "/notices", label: "공지사항", icon: "bell", roles: ALL },
    { to: "/board", label: "게시판", icon: "chat", roles: NO_STAFF },
    { to: "/meetings", label: "회의록", icon: "clipboard", roles: NO_STAFF },
  ] },
  { title: "연구비", items: [
    { to: "/budget", label: "예산", icon: "wallet", roles: ["prof", "staff"] },
    { to: "/payroll", label: "학생인건비", icon: "coins", roles: ALL },
    { to: "/expenses", label: "연구비집행", icon: "card", roles: ["prof", "staff"] },
  ] },
  { title: "인사", items: [
    { to: "/attendance", label: "출퇴근", icon: "clock", roles: ALL },
    { to: "/leave", label: "휴가", icon: "sun", roles: ALL },
    { to: "/members", label: "구성원", icon: "users", roles: EVERYONE },
    { to: "/att-admin", label: "근태 관리", icon: "clock", roles: ["prof"] },
  ] },
  { title: "연구실", items: [
    { to: "/publications", label: "실적", icon: "award", roles: ALL },
    { to: "/library", label: "교육", icon: "book", roles: NO_STAFF },
    { to: "/archive", label: "아카이브", icon: "folder", roles: ALL },
    { to: "/assets", label: "자산", icon: "desktop", roles: ALL },
    { to: "/infra", label: "인프라", icon: "server", roles: ALL },
  ] },
  { title: "관리", items: [
    { to: "/admin", label: "환경설정", icon: "shield", roles: ["admin"] },
    { to: "/audit", label: "감사로그", icon: "clipboard", roles: ["admin"] },
  ] },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const { dark, toggle } = useTheme();
  const brandLogo = useConfig<string>("brand_logo", "");
  const labName = useConfig<string>("lab_name", "");
  const [drawer, setDrawer] = useState(false);
  // 사이드바 접힘도 계정에 저장 — PC 를 옮겨도 같은 상태로 시작한다
  const [collapsed, setCollapsed] = usePref<boolean>("sidebar_collapsed", false, { hint: true });
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 사이드 메뉴 토글 — 모바일은 드로어, 데스크탑은 접기/펼치기
  function toggleSidebar() {
    if (window.innerWidth <= 860) setDrawer((v) => !v);
    else setCollapsed(!collapsed);
  }

  // 라우트 이동 시 모바일 드로어 닫기
  useEffect(() => { setDrawer(false); setMenu(false); }, [loc.pathname]);
  // 말줄임된 표 셀에 hover 시 title 자동 부착(위임 처리 — 화면별로 달지 않아도 된다).
  useEffect(() => {
    function onOver(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      const cell = t && t.closest ? (t.closest("td, th") as HTMLElement | null) : null;
      if (!cell || cell.hasAttribute("title")) return;
      if (cell.querySelector("[title]")) return;                 // 안쪽에 이미 툴팁이 있으면 둔다
      if (cell.scrollWidth <= cell.clientWidth + 1) return;       // 잘리지 않았으면 불필요
      const txt = (cell.textContent || "").trim();
      if (txt) cell.setAttribute("title", txt);
    }
    document.addEventListener("mouseover", onOver, true);
    return () => document.removeEventListener("mouseover", onOver, true);
  }, []);
  // 외부 클릭·Esc 로 계정 메뉴 닫기
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setMenu(false);
      // Esc → 열린 모달 닫기. 오버레이(.modal-ovl)에 직접 click 을 보내 화면별 닫기 로직을 재사용한다.
      // position:fixed 는 offsetParent 가 null 이므로 표시 여부는 getClientRects 로 본다.
      const ovls = Array.from(document.querySelectorAll<HTMLElement>(".modal-ovl")).filter((el) => el.getClientRects().length > 0);
      const top = ovls[ovls.length - 1];
      if (top) { e.preventDefault(); top.click(); }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, []);

  if (!me) return null;

  // 위임자는 본인 역할 + staff 권한을 함께 보유
  const effRoles = me.delegated_admin ? [me.role, "staff"] : [me.role];
  function visible(it: MenuItem) {
    return it.roles.some((r) => effRoles.includes(r));
  }

  return (
    <div className={"appshell" + (drawer ? " drawer-open" : "") + (collapsed ? " sidebar-collapsed" : "")}>
      {/* 키보드 사용자가 사이드바 메뉴 전체를 건너뛰고 본문으로 바로 가도록(WCAG 2.4.1 Bypass Blocks) */}
      <a className="skip-link" href="#main" data-testid="skip-link">본문으로 건너뛰기</a>
      <TopProgress />
      <header className="appbar">
        <div className="appbar-l">
          <button className="hamburger" data-testid="hamburger" aria-label="메뉴 접기/펼치기" title="메뉴 접기/펼치기" onClick={toggleSidebar}>☰</button>
          <span className="appbar-brand">
            {brandLogo ? <img className="brand-logo" src={fileUrl(brandLogo)} alt="로고" /> : <><span className="brand-badge">L</span>LabMate</>}
            <span className="appbar-tag">{labName || "연구실 그룹웨어"}</span>
          </span>
        </div>
        <div className="appbar-r">
          <GlobalSearch />
          <InstallButton />
          <NotificationBell />
          <button className="appbar-icon" data-testid="theme-toggle" title="다크모드" onClick={toggle}>{dark ? "☀" : "🌙"}</button>
          <div className="usermenu" ref={menuRef}>
            <button className="user-chip" data-testid="user-menu-btn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
              <span className="prof-av sm">{me.name.slice(0, 1)}</span>
              <span className="user-chip-meta">
                <span className="prof-name">{me.name}</span>
                <span className="user-chip-role">{ROLE_LABEL[me.role] || me.role}{me.delegated_admin ? " · 행정위임" : ""}</span>
              </span>
              <span className="user-chip-caret">▾</span>
            </button>
            {menu && (
              <div className="menu-pop" role="menu" data-testid="user-menu">
                <div className="menu-head"><b>{me.name}</b><div className="muted small">{me.email}</div></div>
                <button role="menuitem" data-testid="um-mypage" onClick={() => { setMenu(false); nav("/mypage"); }}>👤 마이페이지</button>
                <div className="menu-sep" />
                <button role="menuitem" className="menu-danger" data-testid="logout" onClick={() => { logout(); nav("/login"); }}>로그아웃</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="appbody">
      <div className="backdrop" data-testid="backdrop" onClick={() => setDrawer(false)} />

      <aside className="side">
        <nav className="side-nav">
          {GROUPS.map((g) => {
            const items = g.items.filter(visible);
            if (!items.length) return null;
            return (
              <div key={g.title} className="nav-group">
                <div className="nav-title">{g.title}</div>
                {items.map((it) => (
                  <NavLink key={it.to} to={it.to} end className={({ isActive }) => "nav-link" + (isActive ? " active" : "")} data-testid={`nav-${it.to}`}>
                    <span className="nav-ico"><Icon name={it.icon} /></span>{it.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="side-foot muted small">LabMate · {labName || "연구실 그룹웨어"}</div>
      </aside>
      <main className="content" id="main" tabIndex={-1} data-testid="content">
        {children}
      </main>
      </div>

    </div>
  );
}
