import { useRef, useState, useEffect } from "react";
import { api, apiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PageHeader, AuthorMeta } from "../ui/kit";
import { confirmDialog } from "../ui/dialog";
import HtmlEditor from "../ui/HtmlEditorLazy";

interface TFile { name: string; url: string; }
interface Doc { id: string; parent_id: string; sort: number; title: string; icon: string; content: string; tags: string[]; files: TFile[]; owner_id: string; updated_by?: string; created_at?: string; updated_at?: string; }

// 자료실 — 트리형 문서. 전 구성원 열람·작성·수정, 삭제는 작성자·교수. 기본 읽기 전용(수정 버튼으로 편집).
export default function Archive() {
  const { me } = useAuth();
  const [pages, setPages] = useState<Doc[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [sel, setSel] = useState("");
  const [edit, setEdit] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [showTree, setShowTree] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ id: string; pos: string } | null>(null);

  async function load() { try { setPages((await api.get<Doc[]>("/projects/archive")).data); } catch (e) { setErr(apiError(e)); } }
  useEffect(() => { load(); api.get<any[]>("/members/users").then((r) => setUsers(r.data)).catch(() => {}); }, []);

  const cur = pages.find((p) => p.id === sel) || null;
  const canDelete = (p: Doc | null) => !!p && !!me && (p.owner_id === me.id || ["prof", "admin"].includes(me.role) || !!me.delegated_admin);
  const openView = (id: string) => { setSel(id); setEdit(false); };

  const upLocal = (id: string, patch: Partial<Doc>) => setPages((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  async function patch(id: string, fields: Partial<Doc>) {
    upLocal(id, fields);
    try { await api.patch(`/projects/archive/${id}`, fields); setSaved(new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })); }
    catch (e) { setErr(apiError(e)); }
  }
  const saveTimer = useRef<any>(null);
  function saveContent(id: string, html: string) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    upLocal(id, { content: html });
    saveTimer.current = setTimeout(() => { api.patch(`/projects/archive/${id}`, { content: html }).then(() => setSaved(new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }))).catch((e) => setErr(apiError(e))); }, 1200);
  }
  async function uploadFiles(p: Doc, fl: FileList) {
    const fd = new FormData(); Array.from(fl).forEach((f) => fd.append("files", f));
    try { const r = await api.post<TFile[]>("/projects/uploads", fd, { headers: { "Content-Type": "multipart/form-data" } }); patch(p.id, { files: [...(p.files || []), ...r.data] }); }
    catch (e) { setErr(apiError(e)); }
  }

  async function create(parent = "") {
    try {
      const p = (await api.post<Doc>("/projects/archive", { parent_id: parent, title: "제목 없음" })).data;
      setPages((ps) => [...ps, p]); setSel(p.id); setEdit(true);
      if (parent) setCollapsed((c) => ({ ...c, [parent]: false }));
    } catch (e) { setErr(apiError(e)); }
  }
  const childrenOf = (pid: string) => pages.filter((p) => p.parent_id === pid).sort((a, b) => a.sort - b.sort);
  const rootPages = () => { const ids = new Set(pages.map((p) => p.id)); return pages.filter((p) => !p.parent_id || !ids.has(p.parent_id)).sort((a, b) => a.sort - b.sort); };
  const descCount = (pid: string): number => childrenOf(pid).reduce((n, c) => n + 1 + descCount(c.id), 0);
  async function del(p: Doc) {
    const kids = descCount(p.id);
    if (!await confirmDialog(`"${p.title}"${kids ? " 및 하위 자료" : ""}를 삭제할까요?`, { danger: true })) return;
    if (kids && !await confirmDialog(`하위 자료 ${kids}개도 함께 삭제됩니다. 정말 삭제할까요?`, { danger: true })) return;
    try { await api.delete(`/projects/archive/${p.id}`); if (sel === p.id) setSel(""); load(); } catch (e) { setErr(apiError(e)); }
  }

  function isDesc(nodeId: string, ancestorId: string): boolean {
    let c = pages.find((p) => p.id === nodeId);
    while (c && c.parent_id) { if (c.parent_id === ancestorId) return true; c = pages.find((x) => x.id === c!.parent_id); }
    return false;
  }
  function dropPos(e: React.DragEvent): "before" | "after" | "child" {
    const r = e.currentTarget.getBoundingClientRect(); const y = e.clientY - r.top;
    return y < r.height * 0.28 ? "before" : y > r.height * 0.72 ? "after" : "child";
  }
  function move(targetId: string, pos: "before" | "after" | "child") {
    const id = dragId; setDragId(null); setDropHint(null);
    if (!id || id === targetId || isDesc(targetId, id)) return;
    if (pos === "child") {
      const kids = childrenOf(targetId);
      patch(id, { parent_id: targetId, sort: (kids.length ? Math.max(...kids.map((s) => s.sort)) : 0) + 1 });
      setCollapsed((c) => ({ ...c, [targetId]: false }));
      return;
    }
    const target = pages.find((p) => p.id === targetId)!;
    const sibs = childrenOf(target.parent_id).filter((s) => s.id !== id);
    const idx = sibs.findIndex((s) => s.id === targetId);
    const sort = pos === "before"
      ? (idx > 0 ? (sibs[idx - 1].sort + target.sort) / 2 : target.sort - 1)
      : (idx < sibs.length - 1 ? (target.sort + sibs[idx + 1].sort) / 2 : target.sort + 1);
    patch(id, { parent_id: target.parent_id, sort });
  }
  function dropRoot() {
    const id = dragId; setDragId(null); setDropHint(null);
    if (!id) return;
    const roots = childrenOf("").filter((s) => s.id !== id);
    patch(id, { parent_id: "", sort: (roots.length ? Math.max(...roots.map((s) => s.sort)) : 0) + 1 });
  }
  function ancestors(p: Doc): Doc[] { const out: Doc[] = []; let c: Doc | undefined = p; while (c && c.parent_id) { const par = pages.find((x) => x.id === c!.parent_id); if (!par) break; out.unshift(par); c = par; } return out; }

  function Node({ p, depth }: { p: Doc; depth: number }) {
    const kids = childrenOf(p.id);
    const open = !collapsed[p.id];
    return (
      <div>
        <div className={"note-row" + (sel === p.id ? " on" : "") + (dragId && dragId !== p.id && dropHint?.id === p.id ? ` dh-${dropHint.pos}` : "")} style={{ paddingLeft: 6 + depth * 14 }}
          draggable
          onDragStart={(e) => { e.stopPropagation(); setDragId(p.id); try { e.dataTransfer.setData("text/plain", p.id); e.dataTransfer.effectAllowed = "move"; } catch { /* noop */ } }}
          onDragEnd={() => { setDragId(null); setDropHint(null); }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; const pos = dropPos(e); setDropHint((h) => (h && h.id === p.id && h.pos === pos ? h : { id: p.id, pos })); }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); move(p.id, dropPos(e)); }}
          onClick={() => openView(p.id)} data-testid={`arch-node-${p.id}`}>
          <span className="note-caret" onClick={(e) => { e.stopPropagation(); if (kids.length) setCollapsed((c) => ({ ...c, [p.id]: open })); }}>{kids.length ? (open ? "▾" : "▸") : ""}</span>
          <span className="note-ico">{p.icon}</span>
          <span className="note-title">{p.title || "제목 없음"}</span>
          {(p.files?.length ?? 0) > 0 && <span className="note-share" title={`첨부 ${p.files.length}`}>📎</span>}
          <button className="note-add" title="하위 페이지" onClick={(e) => { e.stopPropagation(); create(p.id); }}>＋</button>
        </div>
        {open && kids.map((k) => <Node key={k.id} p={k} depth={depth + 1} />)}
      </div>
    );
  }

  return (
    <div data-testid="page-archive">
      <PageHeader crumb="연구실 › 자료실" title="자료실" action={
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn ghost" data-testid="arch-toggle-tree" onClick={() => setShowTree((v) => !v)}>{showTree ? "◧ 목록 숨김" : "◨ 목록 보기"}</button>
          <button className="btn primary" data-testid="arch-new" onClick={() => create("")}>+ 새 페이지</button>
        </div>} />
      {err && <div className="form-err">{err}</div>}
      <div className="notes-layout" style={{ gridTemplateColumns: showTree ? "260px 1fr" : "1fr" }}>
        {showTree && (
          <div className="notes-tree card" onDragOver={(e) => e.preventDefault()} onDrop={dropRoot}>
            {rootPages().map((p) => <Node key={p.id} p={p} depth={0} />)}
            {!pages.length && <div className="muted small" style={{ padding: 12 }}>자료가 없습니다 — "+ 새 페이지"로 시작하세요.</div>}
          </div>
        )}
        <div className="notes-editor card">
          {!cur ? <div className="muted" style={{ padding: 24, textAlign: "center" }}>{showTree ? "왼쪽에서" : "목록에서"} 자료를 선택하거나 새로 만드세요.</div> : (
            <>
              <div className="notes-editor-head">
                <div className="note-crumb muted small">{ancestors(cur).map((a) => <span key={a.id}><span className="lnk" onClick={() => openView(a.id)}>{a.icon} {a.title}</span> / </span>)}</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                  <input className="note-icon-in" value={cur.icon} maxLength={2} disabled={!edit} onChange={(e) => upLocal(cur.id, { icon: e.target.value })} onBlur={() => edit && patch(cur.id, { icon: cur.icon })} />
                  <input className="note-title-in" value={cur.title} placeholder="제목 없음" disabled={!edit} data-testid="arch-title-input" style={{ flex: 1 }}
                    onChange={(e) => upLocal(cur.id, { title: e.target.value })} onBlur={() => edit && patch(cur.id, { title: cur.title || "제목 없음" })} />
                  <button className={"btn sm " + (edit ? "primary" : "ghost")} data-testid="arch-edit-toggle" style={{ flexShrink: 0 }} onClick={() => setEdit((v) => !v)}>{edit ? "완료" : "✎ 수정"}</button>
                </div>
                <div className="note-meta">
                  <label>태그</label>
                  <span className="note-tags">
                    {cur.tags.map((t, i) => <span key={i} className="badge s-info">#{t}{edit && <button onClick={() => patch(cur.id, { tags: cur.tags.filter((_, j) => j !== i) })} style={{ marginLeft: 3, border: "none", background: "none", cursor: "pointer", color: "inherit" }}>✕</button>}</span>)}
                    {edit && <input className="note-tag-in" placeholder="+태그" value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && tagInput.trim()) { patch(cur.id, { tags: [...cur.tags, tagInput.trim()] }); setTagInput(""); } }} />}
                    {!edit && !cur.tags.length && <span className="muted small">—</span>}
                  </span>
                  <AuthorMeta by={cur.owner_id} updatedBy={cur.updated_by} createdAt={cur.created_at} updatedAt={cur.updated_at} nameOf={(id) => users.find((u) => u.id === id)?.name || "—"} />
                  {saved && <span className="muted small" style={{ marginLeft: "auto" }}>저장됨 {saved}</span>}
                </div>
              </div>
              <div className="notes-editor-doc">
                <HtmlEditor key={cur.id} value={cur.content || ""} editable={edit} fill onChange={(html) => saveContent(cur.id, html)} />
              </div>
              <div className="notes-arch-files">
                <div className="arch-files-h">첨부파일{cur.files?.length ? ` (${cur.files.length})` : ""}
                  {edit && <label className="btn ghost sm" style={{ marginLeft: 8 }}>+ 파일<input type="file" multiple data-testid="arch-file-input" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.length) uploadFiles(cur, e.target.files); e.target.value = ""; }} /></label>}
                </div>
                <div className="arch-files-list">
                  {(cur.files || []).map((f, i) => <span key={i} className="badge s-info arch-file"><a href={f.url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>📎 {f.name}</a>{edit && <button onClick={() => patch(cur.id, { files: cur.files.filter((_, j) => j !== i) })} style={{ marginLeft: 4, border: "none", background: "none", cursor: "pointer", color: "inherit" }}>✕</button>}</span>)}
                  {!(cur.files?.length) && <span className="muted small">첨부 없음</span>}
                </div>
              </div>
              {edit && canDelete(cur) && <div className="notes-editor-foot"><button className="note-del" data-testid="arch-delete" onClick={() => del(cur)}>삭제</button></div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
