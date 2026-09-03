import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, silent } from "../api/client";
import { Icon } from "../ui/icons";

/**
 * 전역 검색(Ctrl/Cmd+K) — 10개 모듈을 이름으로 한 번에 찾는다.
 * 열 때 1회만 조회하고 입력 필터링은 화면에서 한다.
 */
type Hit = { group: string; title: string; sub: string; to: string };

const GROUPS = [
  { g: "공지", url: "/boards/notices", to: (x: any) => `/notices?open=${x.id}`, t: (x: any) => x.title, s: () => "공지사항" },
  { g: "게시글", url: "/boards/posts", to: (x: any) => `/board?open=${x.id}`, t: (x: any) => x.title, s: (x: any) => x.cat || "게시판" },
  { g: "회의록", url: "/boards/meetings", to: (x: any) => `/meetings?open=${x.id}`, t: (x: any) => x.title, s: (x: any) => x.date || "회의록" },
  { g: "연구과제", url: "/projects/projects?kind=grant", to: (x: any) => `/grants?open=${x.id}`, t: (x: any) => x.name, s: (x: any) => x.code },
  { g: "프로젝트", url: "/projects/projects?kind=activity", to: (x: any) => `/projects?open=${x.id}`, t: (x: any) => x.name, s: (x: any) => x.code },
  { g: "세부업무", url: "/projects/tasks", to: (x: any) => `/projects?open=${x.project_id}`, t: (x: any) => x.title, s: (x: any) => x.status || "업무" },
  { g: "연구노트", url: "/projects/notes", to: () => "/notes", t: (x: any) => x.title || "제목 없음", s: (x: any) => (x.tags || []).map((v: string) => `#${v}`).join(" ") || "연구노트" },
  { g: "실적", url: "/projects/publications", to: () => "/publications", t: (x: any) => x.title, s: (x: any) => x.kind || "실적" },
  { g: "자산", url: "/resource/assets", to: () => "/assets", t: (x: any) => x.name, s: (x: any) => x.asset_no || "자산" },
  { g: "구성원", url: "/members/users", to: () => "/members", t: (x: any) => x.name, s: (x: any) => x.email || "구성원" },
];

export function GlobalSearch() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Hit[] | null>(null);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl/Cmd + K 로 열기
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(true); }
      else if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // 열 때 한 번만 모은다(권한 없는 항목은 서버가 걸러 주므로 실패는 빈 목록으로 둔다)
  useEffect(() => {
    if (!open) return;
    setCursor(0);
    inputRef.current?.focus();
    if (rows) return;
    Promise.all(GROUPS.map((g) =>
      api.get<any[]>(g.url, silent).then((r) => (r.data || []).map((x) => ({
        group: g.g, title: String(g.t(x) || ""), sub: String(g.s(x) || ""), to: g.to(x),
      }))).catch(() => [] as Hit[])))
      .then((lists) => setRows(lists.flat().filter((h) => h.title)));
  }, [open, rows]);

  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || !rows) return [];
    return rows.filter((h) => h.title.toLowerCase().includes(s) || h.sub.toLowerCase().includes(s)).slice(0, 40);
  }, [q, rows]);

  function go(h: Hit) { setOpen(false); setQ(""); nav(h.to); }

  if (!open) {
    return (
      <button className="appbar-icon" data-testid="global-search-open" title="전체 검색 (Ctrl+K)" aria-label="전체 검색" onClick={() => setOpen(true)}>
        <Icon name="search" />
      </button>
    );
  }
  return (
    <div className="modal-ovl" data-testid="global-search" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="modal gsearch" style={{ width: 620, maxWidth: "94%" }}>
        <div className="bd" style={{ padding: 10 }}>
          <input ref={inputRef} data-testid="global-search-input" aria-label="전체 검색어"
            placeholder="공지·게시글·과제·업무·자산·구성원… 이름으로 찾기"
            value={q} onChange={(e) => { setQ(e.target.value); setCursor(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, hits.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
              else if (e.key === "Enter" && hits[cursor]) { e.preventDefault(); go(hits[cursor]); }
            }} style={{ margin: 0 }} />
        </div>
        <div className="gsearch-list" data-testid="global-search-results">
          {!rows && <div className="muted" style={{ padding: 16, textAlign: "center" }}>불러오는 중…</div>}
          {rows && !q.trim() && <div className="muted small" style={{ padding: 16, textAlign: "center" }}>이름 일부만 입력해도 됩니다 · ↑↓ 이동 · Enter 열기 · Esc 닫기</div>}
          {rows && q.trim() && !hits.length && <div className="muted" style={{ padding: 16, textAlign: "center" }}>"{q}" 에 해당하는 항목이 없습니다</div>}
          {hits.map((h, i) => (
            <button key={h.group + h.to + i} className={"gsearch-item" + (i === cursor ? " on" : "")}
              data-testid={`gs-hit-${i}`} onMouseEnter={() => setCursor(i)} onClick={() => go(h)}>
              <span className="badge s-info" style={{ flexShrink: 0 }}>{h.group}</span>
              <span className="gsearch-t">{h.title}</span>
              <span className="muted small gsearch-s">{h.sub}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
