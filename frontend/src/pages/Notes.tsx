import { useEffect, useRef, useState } from "react";
import { api, apiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../ui/kit";
import { confirmDialog } from "../ui/dialog";
import HtmlEditor from "../ui/HtmlEditorLazy";
const ROLE_KO: Record<string, string> = { prof: "교수", phd: "박사과정", master: "석사과정", under: "학부", staff: "행정", admin: "관리자" };
interface Note { id: string; parent_id: string; sort: number; title: string; icon: string; content: string; project_id: string; tags: string[]; owner_id: string; share_uids: string[]; updated_at?: string; }

// 여러 구성원 다중 선택 공유 — 체크박스 목록 팝오버(이름 검색)
function SharePicker({ value, all, excludeIds, disabled, onChange }: { value: string[]; all: any[]; excludeIds: string[]; disabled: boolean; onChange: (uids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const nameOf = (uid: string) => all.find((u) => u.id === uid)?.name || uid;
  const toggle = (uid: string) => onChange(value.includes(uid) ? value.filter((x) => x !== uid) : [...value, uid]);
  const candidates = all.filter((u) => u.active !== false && !excludeIds.includes(u.id) && u.role !== "admin");
  const list = candidates.filter((u) => (u.name || "").toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="share-pick" ref={ref}>
      <div className="share-chips">
        {value.map((uid) => <span key={uid} className="badge s-info">{nameOf(uid)}{!disabled && <button onClick={() => toggle(uid)} style={{ marginLeft: 3, border: "none", background: "none", cursor: "pointer", color: "inherit" }}>✕</button>}</span>)}
        {!disabled && <button type="button" className="btn ghost sm" data-testid="share-open" onClick={() => setOpen((o) => !o)}>+ 구성원 선택{value.length ? ` (${value.length})` : ""}</button>}
        {disabled && !value.length && <span className="muted small">—</span>}
      </div>
      {open && !disabled && (
        <div className="share-pop">
          <input className="share-search" placeholder="이름 검색" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="share-list">
            {list.map((u) => (
              <label key={u.id} className="share-item">
                <input type="checkbox" checked={value.includes(u.id)} onChange={() => toggle(u.id)} />
                <span>{u.name}</span><span className="muted small">{ROLE_KO[u.role] || u.role}</span>
              </label>
            ))}
            {!list.length && <div className="muted small" style={{ padding: 8 }}>구성원이 없습니다.</div>}
          </div>
          {value.length > 0 && <button type="button" className="btn ghost sm" style={{ width: "100%", marginTop: 4 }} onClick={() => onChange([])}>전체 해제</button>}
        </div>
      )}
    </div>
  );
}

export default function Notes() {
  const { me } = useAuth();
  const [pages, setPages] = useState<Note[]>([]);
  const [sel, setSel] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [projects, setProjects] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [showTree, setShowTree] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ id: string; pos: string } | null>(null);

  async function load() { try { setPages((await api.get<Note[]>("/projects/notes")).data); } catch (e) { setErr(apiError(e)); } }
  useEffect(() => {
    load();
    api.get<any[]>("/projects/projects").then((r) => setProjects(r.data)).catch(() => {});   // 과제·프로젝트 모두
    api.get<any[]>("/members/users").then((r) => setUsers(r.data)).catch(() => {});
  }, []);

  const cur = pages.find((p) => p.id === sel) || null;
  const canEdit = (p: Note | null) => !!p && !!me && (p.owner_id === me.id || ["prof", "admin"].includes(me.role) || !!me.delegated_admin);

  // 과제·프로젝트 연결 후보 — 본인 관련(책임자·담당자·참여) + 진행중. 이미 연결된 것은 필터 제외돼도 유지.
  const today = new Date().toLocaleDateString("sv-SE");
  // 과제 기간 — 해당 연도 기간(meta) 우선, 없으면 전체 기간 폴백
  const period = (p: any): [string, string] =>
    (p.meta?.year_start || p.meta?.year_end) ? [p.meta.year_start || "", p.meta.year_end || ""] : [p.start || "", p.end || ""];
  const relatedActive = (p: any) => {
    if (/균등\s*\(\d{4}\)/.test(p.code || "")) return false;   // 균등(YYYY) 과제 숨김
    if (!me || !(p.lead_id === me.id || p.pm_id === me.id || (p.members || []).includes(me.id))) return false;
    const [s, e] = period(p);   // 해당 연도 기간 기준 진행중 판정
    if (s && today < s) return false;
    if (e && today > e) return false;
    return true;
  };
  const projOpts = (linkedId: string) => {
    const opts = projects.filter(relatedActive).sort((a, b) => period(b)[0].localeCompare(period(a)[0]));   // 해당 연도 기간 최신순
    if (linkedId && !opts.some((p) => p.id === linkedId)) { const l = projects.find((p) => p.id === linkedId); if (l) opts.push(l); }
    return opts;
  };
  const upLocal = (id: string, patch: Partial<Note>) => setPages((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  async function patch(id: string, fields: Partial<Note>) {
    upLocal(id, fields);
    try { await api.patch(`/projects/notes/${id}`, fields); setSaved(new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })); }
    catch (e) { setErr(apiError(e)); }
  }
  // 본문(HTML) 디바운스 자동저장
  const saveTimer = useRef<any>(null);
  function saveContent(id: string, html: string) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    upLocal(id, { content: html });
    saveTimer.current = setTimeout(() => { api.patch(`/projects/notes/${id}`, { content: html }).then(() => setSaved(new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }))).catch((e) => setErr(apiError(e))); }, 1200);
  }

  async function create(parent = "") {
    try {
      const p = (await api.post<Note>("/projects/notes", { parent_id: parent, title: "제목 없음" })).data;
      setPages((ps) => [...ps, p]); setSel(p.id);
      if (parent) setCollapsed((c) => ({ ...c, [parent]: false }));
    } catch (e) { setErr(apiError(e)); }
  }
  const descCount = (pid: string): number => childrenOf(pid).reduce((n, c) => n + 1 + descCount(c.id), 0);
  async function del(p: Note) {
    const kids = descCount(p.id);
    if (!await confirmDialog(`"${p.title}"${kids ? " 및 하위 노트" : ""}를 삭제할까요?`, { danger: true })) return;
    if (kids && !await confirmDialog(`하위 노트 ${kids}개도 함께 삭제됩니다. 정말 삭제할까요?`, { danger: true })) return;
    try { await api.delete(`/projects/notes/${p.id}`); if (sel === p.id) setSel(""); load(); } catch (e) { setErr(apiError(e)); }
  }

  const childrenOf = (pid: string) => pages.filter((p) => p.parent_id === pid).sort((a, b) => a.sort - b.sort);
  // 내/공유 구분: 백엔드는 내 노트 + 나에게 공유된 노트만 반환
  const mine = pages.filter((p) => me && p.owner_id === me.id);
  const shared = pages.filter((p) => me && p.owner_id !== me.id);
  const childrenIn = (set: Note[], pid: string) => set.filter((p) => p.parent_id === pid).sort((a, b) => a.sort - b.sort);
  const rootsIn = (set: Note[]) => { const ids = new Set(set.map((p) => p.id)); return set.filter((p) => !p.parent_id || !ids.has(p.parent_id)).sort((a, b) => a.sort - b.sort); };
  function isDesc(nodeId: string, ancestorId: string): boolean {   // nodeId가 ancestorId의 자손인가
    let c = pages.find((p) => p.id === nodeId);
    while (c && c.parent_id) { if (c.parent_id === ancestorId) return true; c = pages.find((x) => x.id === c!.parent_id); }
    return false;
  }
  // 드롭 위치: 행 상단=앞(형제), 하단=뒤(형제), 가운데=하위
  function dropPos(e: React.DragEvent): "before" | "after" | "child" {
    const r = e.currentTarget.getBoundingClientRect(); const y = e.clientY - r.top;
    return y < r.height * 0.28 ? "before" : y > r.height * 0.72 ? "after" : "child";
  }
  function move(targetId: string, pos: "before" | "after" | "child") {
    const id = dragId; setDragId(null); setDropHint(null);
    if (!id || id === targetId || isDesc(targetId, id)) return;   // 자기 자신·자손으로는 이동 불가
    if (pos === "child") {
      const kids = childrenOf(targetId);
      patch(id, { parent_id: targetId, sort: (kids.length ? Math.max(...kids.map((s) => s.sort)) : 0) + 1 });
      setCollapsed((c) => ({ ...c, [targetId]: false }));
      return;
    }
    const target = pages.find((p) => p.id === targetId)!;         // before/after → target의 형제로
    const sibs = childrenOf(target.parent_id).filter((s) => s.id !== id);
    const idx = sibs.findIndex((s) => s.id === targetId);
    const sort = pos === "before"
      ? (idx > 0 ? (sibs[idx - 1].sort + target.sort) / 2 : target.sort - 1)
      : (idx < sibs.length - 1 ? (target.sort + sibs[idx + 1].sort) / 2 : target.sort + 1);
    patch(id, { parent_id: target.parent_id, sort });
  }
  function dropRoot() {   // 빈 영역 → 루트 끝으로
    const id = dragId; setDragId(null); setDropHint(null);
    if (!id) return;
    const roots = childrenOf("").filter((s) => s.id !== id);
    patch(id, { parent_id: "", sort: (roots.length ? Math.max(...roots.map((s) => s.sort)) : 0) + 1 });
  }
  function ancestors(p: Note): Note[] { const out: Note[] = []; let c: Note | undefined = p; while (c && c.parent_id) { const par = pages.find((x) => x.id === c!.parent_id); if (!par) break; out.unshift(par); c = par; } return out; }

  function Node({ p, depth, set, dnd }: { p: Note; depth: number; set: Note[]; dnd: boolean }) {
    const kids = childrenIn(set, p.id);
    const open = !collapsed[p.id];
    const own = !!me && p.owner_id === me.id;
    return (
      <div>
        <div className={"note-row" + (sel === p.id ? " on" : "") + (dnd && dragId && dragId !== p.id && dropHint?.id === p.id ? ` dh-${dropHint.pos}` : "")} style={{ paddingLeft: 6 + depth * 14 }}
          draggable={dnd}
          onDragStart={dnd ? (e) => { e.stopPropagation(); setDragId(p.id); try { e.dataTransfer.setData("text/plain", p.id); e.dataTransfer.effectAllowed = "move"; } catch { /* noop */ } } : undefined}
          onDragEnd={dnd ? () => { setDragId(null); setDropHint(null); } : undefined}
          onDragOver={dnd ? (e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; const pos = dropPos(e); setDropHint((h) => (h && h.id === p.id && h.pos === pos ? h : { id: p.id, pos })); } : undefined}
          onDrop={dnd ? (e) => { e.preventDefault(); e.stopPropagation(); move(p.id, dropPos(e)); } : undefined}
          onClick={() => setSel(p.id)} data-testid={`note-node-${p.id}`}>
          <span className="note-caret" onClick={(e) => { e.stopPropagation(); if (kids.length) setCollapsed((c) => ({ ...c, [p.id]: open })); }}>{kids.length ? (open ? "▾" : "▸") : ""}</span>
          <span className="note-ico">{p.icon}</span>
          <span className="note-title">{p.title || "제목 없음"}</span>
          {own && (p.share_uids?.length ?? 0) > 0 && <span className="note-share" title={`공유 중 · ${p.share_uids.length}명`}>👥</span>}
          {own && <button className="note-add" title="하위 페이지" onClick={(e) => { e.stopPropagation(); create(p.id); }}>＋</button>}
        </div>
        {open && kids.map((k) => <Node key={k.id} p={k} depth={depth + 1} set={set} dnd={dnd} />)}
      </div>
    );
  }

  return (
    <div data-testid="page-notes">
      <PageHeader crumb="업무 › 연구노트" title="연구노트" action={
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn ghost" data-testid="note-toggle-tree" onClick={() => setShowTree((v) => !v)}>{showTree ? "◧ 목록 숨김" : "◨ 목록 보기"}</button>
          <button className="btn primary" data-testid="note-new" onClick={() => create("")}>+ 새 페이지</button>
        </div>} />
      {err && <div className="form-err">{err}</div>}
      <div className="notes-layout" style={{ gridTemplateColumns: showTree ? "260px 1fr" : "1fr" }}>
        {showTree && (
          <div className="notes-tree card" onDragOver={(e) => e.preventDefault()} onDrop={dropRoot}>
            <div className="note-sec">내 연구노트</div>
            {rootsIn(mine).map((p) => <Node key={p.id} p={p} depth={0} set={mine} dnd />)}
            {!mine.length && <div className="muted small" style={{ padding: "4px 12px 8px" }}>내 노트가 없습니다 — "+ 새 페이지"로 시작하세요.</div>}
            {shared.length > 0 && <>
              <div className="note-sec">공유 연구노트</div>
              {rootsIn(shared).map((p) => <Node key={p.id} p={p} depth={0} set={shared} dnd={false} />)}
            </>}
          </div>
        )}
        <div className="notes-editor card">
          {!cur ? <div className="muted" style={{ padding: 24, textAlign: "center" }}>{showTree ? "왼쪽에서" : "목록에서"} 페이지를 선택하거나 새로 만드세요.</div> : (() => {
            const editable = canEdit(cur);
            return (
              <>
                <div className="notes-editor-head">
                  <div className="note-crumb muted small">{ancestors(cur).map((a) => <span key={a.id}><span className="lnk" onClick={() => setSel(a.id)}>{a.icon} {a.title}</span> / </span>)}</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                    <input className="note-icon-in" value={cur.icon} maxLength={2} disabled={!editable} onChange={(e) => upLocal(cur.id, { icon: e.target.value })} onBlur={() => editable && patch(cur.id, { icon: cur.icon })} />
                    <input className="note-title-in" value={cur.title} placeholder="제목 없음" disabled={!editable} data-testid="note-title-input"
                      onChange={(e) => upLocal(cur.id, { title: e.target.value })} onBlur={() => editable && patch(cur.id, { title: cur.title || "제목 없음" })} />
                  </div>
                  <div className="note-meta">
                    <label>과제·프로젝트</label>
                    <select value={cur.project_id} disabled={!editable} data-testid="note-project" onChange={(e) => patch(cur.id, { project_id: e.target.value })}>
                      <option value="">(연결 없음)</option>
                      {(() => {
                        const o = projOpts(cur.project_id); const label = (p: any) => [p.code, p.name].filter(Boolean).join(" · ");
                        const g = o.filter((p: any) => p.kind === "grant"); const a = o.filter((p: any) => p.kind !== "grant");
                        return <>
                          {g.length > 0 && <optgroup label="연구과제">{g.map((p: any) => <option key={p.id} value={p.id}>{label(p)}</option>)}</optgroup>}
                          {a.length > 0 && <optgroup label="프로젝트">{a.map((p: any) => <option key={p.id} value={p.id}>{label(p)}</option>)}</optgroup>}
                        </>;
                      })()}
                    </select>
                    <label>공유</label>
                    <SharePicker value={cur.share_uids || []} all={users} excludeIds={[me?.id, cur.owner_id].filter(Boolean) as string[]} disabled={!editable}
                      onChange={(uids) => patch(cur.id, { share_uids: uids })} />
                    <span className="note-tags">
                      {cur.tags.map((t, i) => <span key={i} className="badge s-info">#{t}{editable && <button onClick={() => patch(cur.id, { tags: cur.tags.filter((_, j) => j !== i) })} style={{ marginLeft: 3, border: "none", background: "none", cursor: "pointer", color: "inherit" }}>✕</button>}</span>)}
                      {editable && <input className="note-tag-in" placeholder="+태그" value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && tagInput.trim()) { patch(cur.id, { tags: [...cur.tags, tagInput.trim()] }); setTagInput(""); } }} />}
                    </span>
                    {saved && <span className="muted small" style={{ marginLeft: "auto" }}>저장됨 {saved}</span>}
                  </div>
                  {!editable && <div className="muted small" style={{ marginTop: 4 }}>읽기 전용(소유자·관리자만 편집)</div>}
                </div>
                <div className="notes-editor-doc">
                  <HtmlEditor key={cur.id} value={cur.content || ""} editable={editable} fill onChange={(html) => saveContent(cur.id, html)} />
                </div>
                {editable && <div className="notes-editor-foot"><button className="note-del" data-testid="note-delete" onClick={() => del(cur)}>삭제</button></div>}
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
