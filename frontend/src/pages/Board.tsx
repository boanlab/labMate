import { useEffect, useState } from "react";
import { api, apiError } from "../api/client";
import { confirmDialog } from "../ui/dialog";
import { useAuth } from "../auth/AuthContext";
import { PageHeader, Card, AuthorMeta } from "../ui/kit";
import { stripHtml } from "../ui/html";
import HtmlEditor from "../ui/HtmlEditorLazy";
import { useConfig } from "../api/config";

interface TFile { name: string; url: string; }
interface Post { id: string; cat: string; title: string; body: string; link: string; by_id: string; views: number; comments: any[]; files?: TFile[]; created_at?: string; updated_by?: string; updated_at?: string; min_role?: string; }
// 공개 범위(최소 직급 이상만 열람). ''=전체 공개.
const MIN_ROLE_OPTS: [string, string][] = [["", "전체 공개"], ["master", "석사과정 이상"], ["phd", "박사과정 이상"]];
const minRoleLabel = (v?: string) => (MIN_ROLE_OPTS.find(([k]) => k === (v || ""))?.[1]) || "전체 공개";
const CATS_FB = ["정보공유", "논문리뷰", "자유게시판"];
const CBADGE: Record<string, string> = { "정보공유": "s-info", "논문리뷰": "s-pur", "자유게시판": "s-mute" };

export default function Board() {
  const { me } = useAuth();
  const CATS = useConfig<string[]>("post_types", CATS_FB);
  const [items, setItems] = useState<Post[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const uname = (id: string) => users.find((u) => u.id === id)?.name || (id ? id.slice(0, 6) : "—");
  const [tab, setTab] = useState("전체");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Post | null>(null);
  const [comment, setComment] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [editC, setEditC] = useState<{ id: string; text: string } | null>(null);
  const canModerate = !!me && ["prof", "admin"].includes(me.role);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState("");
  const [form, setForm] = useState({ cat: "정보공유", title: "", link: "", min_role: "", files: [] as TFile[] });
  const [body, setBody] = useState("");

  async function load() {
    try { setItems((await api.get<Post[]>("/boards/posts")).data); api.get<any[]>("/members/users").then((r) => setUsers(r.data)).catch(() => {}); } catch (e) { setErr(apiError(e)); }
  }
  useEffect(() => { load(); }, []);

  function openForm() { setEditId(""); setAdding((v) => !v); setForm({ cat: "정보공유", title: "", link: "", min_role: "", files: [] }); setBody(""); }
  function editPost(p: Post) {
    setForm({ cat: p.cat, title: p.title, link: p.link || "", min_role: p.min_role || "", files: p.files || [] });
    setEditId(p.id); setAdding(true); setOpen(null);
    setBody(p.body || "");
  }
  function closeForm() { setAdding(false); setEditId(""); setForm({ cat: "정보공유", title: "", link: "", min_role: "", files: [] }); }
  async function uploadFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const fl = e.target.files; if (!fl || !fl.length) return;
    const fd = new FormData(); Array.from(fl).forEach((f) => fd.append("files", f));
    try {
      const r = await api.post<TFile[]>("/projects/uploads", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setForm((f) => ({ ...f, files: [...f.files, ...r.data] }));
    } catch (err) { setErr(apiError(err)); }
    e.target.value = "";
  }
  async function add(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    try {
      if (editId) await api.put(`/boards/posts/${editId}`, { ...form, body });
      else await api.post("/boards/posts", { ...form, body });
      closeForm(); load();
    } catch (e) { setErr(apiError(e)); }
  }
  async function openPost(p: Post) {
    try { const r = await api.get<Post>(`/boards/posts/${p.id}`); setOpen(r.data); load(); } catch (e) { setErr(apiError(e)); }
  }
  const canDel = (p: Post) => !!me && (p.by_id === me.id || me.role === "prof" || me.role === "admin");
  async function delPost(p: Post) {
    if (!await confirmDialog("게시물을 삭제할까요?")) return;
    try { await api.delete(`/boards/posts/${p.id}`); setOpen(null); load(); } catch (e) { setErr(apiError(e)); }
  }
  async function addComment(parent = "") {
    const text = parent ? replyText : comment;
    if (!text.trim() || !open) return;
    try { const r = await api.post<Post>(`/boards/posts/${open.id}/comments`, { text, parent }); setOpen(r.data); setComment(""); setReplyText(""); setReplyTo(null); load(); }
    catch (e) { setErr(apiError(e)); }
  }
  async function saveEditC() {
    if (!open || !editC || !editC.text.trim()) return;
    try { const r = await api.patch<Post>(`/boards/posts/${open.id}/comments/${editC.id}`, { text: editC.text }); setOpen(r.data); setEditC(null); load(); }
    catch (e) { setErr(apiError(e)); }
  }
  async function delComment(cid: string) {
    if (!open || !await confirmDialog("댓글을 삭제할까요?")) return;
    try { const r = await api.delete<Post>(`/boards/posts/${open.id}/comments/${cid}`); setOpen(r.data); load(); }
    catch (e) { setErr(apiError(e)); }
  }
  const linkBtn: React.CSSProperties = { background: "none", border: "none", fontSize: 12, cursor: "pointer", padding: 0, whiteSpace: "nowrap" };
  function cmtActions(c: any) {
    return <>
      {c.by === me?.id && <button style={{ ...linkBtn, color: "var(--sub)" }} onClick={() => setEditC({ id: c.id, text: c.text })}>수정</button>}
      {(c.by === me?.id || canModerate) && <button style={{ ...linkBtn, color: "var(--bad)" }} onClick={() => delComment(c.id)}>삭제</button>}
    </>;
  }
  function cmtBody(c: any) {
    if (editC && editC.id === c.id) {
      const ec = editC;
      return (
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <input value={ec.text} autoFocus data-testid="cmt-edit-input" onChange={(e) => setEditC({ id: c.id, text: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") saveEditC(); }} style={{ margin: 0, fontSize: 14 }} />
          <button className="btn primary sm" data-testid="cmt-edit-save" onClick={saveEditC}>저장</button>
          <button className="btn ghost sm" onClick={() => setEditC(null)}>취소</button>
        </div>
      );
    }
    return <div style={{ marginTop: 3, fontSize: 14 }}>{c.text}</div>;
  }

  const ql = q.trim().toLowerCase();
  const filtered = items.filter((p) => (tab === "전체" || p.cat === tab) && (!ql || `${p.title} ${stripHtml(p.body || "")} ${uname(p.by_id)}`.toLowerCase().includes(ql)));

  if (open) {
    return (
      <div data-testid="page-board-view">
        <PageHeader crumb="소통 › 게시판" title={open.title} action={<span style={{ display: "flex", gap: 6 }}>{canDel(open) && <button className="btn ghost" data-testid="post-edit" onClick={() => editPost(open)}>수정</button>}<button className="btn ghost" onClick={() => setOpen(null)}>목록</button></span>} />
        {err && <div className="form-err" data-testid="board-error">{err}</div>}
        <Card>
          <table className="metatbl"><tbody>
            <tr><th>분류</th><td><span className={"badge " + (CBADGE[open.cat] || "s-mute")}>{open.cat}</span></td></tr>
            {open.min_role ? <tr><th>공개 범위</th><td><span className="badge s-wait">🔒 {minRoleLabel(open.min_role)}</span></td></tr> : null}
            <tr><th>조회</th><td>{open.views}</td></tr>
            <tr><th>작성·수정</th><td><AuthorMeta by={open.by_id} updatedBy={open.updated_by} createdAt={open.created_at} updatedAt={open.updated_at} nameOf={uname} className="" /></td></tr>
            {open.link && <tr><th>링크</th><td><a className="lnk" href={open.link} target="_blank" rel="noreferrer">🔗 {open.link}</a></td></tr>}
          </tbody></table>
          <div style={{ lineHeight: 1.7, minHeight: 60 }} dangerouslySetInnerHTML={{ __html: open.body || "<span class='muted'>본문 없음</span>" }} />
          {!!(open.files && open.files.length) && (
            <div style={{ marginTop: 12 }}>
              <div className="muted small" style={{ marginBottom: 4 }}>첨부파일</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {open.files.map((f, i) => <a key={i} className="badge s-info" href={f.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", padding: "5px 10px" }}>📎 {f.name}</a>)}
              </div>
            </div>
          )}
          <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <b>댓글 {open.comments?.length || 0}</b>
            {(open.comments || []).filter((c: any) => !c.parent).map((c: any, i: number) => (
              <div key={c.id || i} style={{ padding: "10px 0", borderBottom: "1px solid var(--line2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span><b>{c.name || c.by?.slice(0, 6)}</b> <span className="muted small">{c.at}</span></span>
                  <span style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                    {cmtActions(c)}
                    <button onClick={() => { setReplyTo(replyTo === c.id ? null : c.id); setReplyText(""); }}
                      style={{ background: "none", border: "none", color: replyTo === c.id ? "var(--sub)" : "var(--brand)", fontSize: 12, cursor: "pointer", padding: 0, whiteSpace: "nowrap" }}>
                      {replyTo === c.id ? "취소" : "↩ 답글"}
                    </button>
                  </span>
                </div>
                {cmtBody(c)}
                {(open.comments || []).filter((r: any) => r.parent === c.id).map((r: any, j: number) => (
                  <div key={r.id || j} style={{ marginLeft: 22, marginTop: 6, paddingLeft: 10, borderLeft: "2px solid var(--line)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                      <span><b>{r.name || r.by?.slice(0, 6)}</b> <span className="muted small">{r.at}</span></span>
                      <span style={{ display: "flex", gap: 10, alignItems: "baseline" }}>{cmtActions(r)}</span>
                    </div>
                    {cmtBody(r)}
                  </div>
                ))}
                {replyTo === c.id && (
                  <div style={{ display: "flex", gap: 8, marginTop: 6, marginLeft: 22 }}>
                    <input data-testid="post-reply" placeholder={`${c.name}에게 답글`} value={replyText} onChange={(e) => setReplyText(e.target.value)} style={{ margin: 0 }} />
                    <button className="btn primary sm" data-testid="post-reply-submit" onClick={() => addComment(c.id)}>답글</button>
                  </div>
                )}
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input data-testid="post-comment" placeholder="댓글 입력" value={comment} onChange={(e) => setComment(e.target.value)} style={{ margin: 0 }} />
              <button className="btn primary sm" data-testid="post-comment-submit" onClick={() => addComment()}>등록</button>
            </div>
          </div>
        </Card>
        {canDel(open) && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <button data-testid="post-del" onClick={() => delPost(open)} style={{ background: "none", border: "none", color: "var(--bad)", fontSize: 11.5, padding: "2px 4px", textDecoration: "underline", opacity: 0.8 }}>게시물 삭제</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-testid="page-board">
      <PageHeader crumb="소통 › 게시판" title="게시판" action={
        <button className="btn primary" data-testid="board-add-open" onClick={openForm}>+ 글쓰기</button>
      } />
      {err && <div className="form-err" data-testid="board-error">{err}</div>}
      {adding && (
        <form className="card" onSubmit={add} data-testid="board-form">
          <div className="card-h"><b>{editId ? "게시물 수정" : "글쓰기"}</b></div>
          <div className="bd grid2">
            <div style={{ gridColumn: "1 / -1" }}><label>제목</label><input data-testid="b-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><label>분류</label><select data-testid="b-cat" value={form.cat} onChange={(e) => setForm({ ...form, cat: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label>공개 범위</label><select data-testid="b-minrole" value={form.min_role} onChange={(e) => setForm({ ...form, min_role: e.target.value })}>{MIN_ROLE_OPTS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div style={{ gridColumn: "1 / -1" }}><label>본문</label><HtmlEditor value={body} onChange={setBody} testid="b-body" minHeight={200} /></div>
            <div style={{ gridColumn: "1 / -1" }}><label>링크(선택)</label><input data-testid="b-link" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} /></div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label>첨부파일(선택)</label>
              <input type="file" multiple data-testid="b-files" onChange={uploadFiles} />
              {!!form.files.length && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                  {form.files.map((f, i) => (
                    <span key={i} className="badge s-info">📎 {f.name}
                      <button type="button" onClick={() => setForm((ff) => ({ ...ff, files: ff.files.filter((_, j) => j !== i) }))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", marginLeft: 4 }}>✕</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="bd" style={{ display: "flex", gap: 6 }}>
            <button className="btn primary" data-testid="board-add-submit">{editId ? "저장" : "등록"}</button>
            <button type="button" className="btn ghost" onClick={closeForm}>취소</button>
          </div>
        </form>
      )}

      <div className="fchips" style={{ marginBottom: 12 }} data-testid="board-tabs">
        {["전체", ...CATS].map((c) => (
          <button key={c} className={"chip" + (tab === c ? " on" : "")} data-testid={`board-tab-${c}`} onClick={() => setTab(c)}>{c}{c !== "전체" ? ` ${items.filter((p) => p.cat === c).length}` : ""}</button>
        ))}
      </div>

      <div className="tbar" style={{ marginBottom: 8 }}><input className="tsearch" data-testid="board-search" placeholder="제목·내용·작성자 검색…" value={q} onChange={(e) => setQ(e.target.value)} /><span className="muted small" style={{ marginLeft: "auto" }}>{filtered.length}건</span></div>
      <Card pad={false}>
        <table className="tbl" data-testid="board-table">
          <thead><tr><th>분류</th><th>제목</th><th>작성자</th><th>작성일</th><th>댓글</th><th>조회</th></tr></thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id}>
                <td><span className={"badge " + (CBADGE[p.cat] || "s-mute")}>{p.cat}</span></td>
                <td><a style={{ cursor: "pointer", fontWeight: 600 }} data-testid={`post-open-${p.id}`} onClick={() => openPost(p)}>{p.title}</a>{p.min_role ? <span className="badge s-wait" style={{ marginLeft: 6 }} title={minRoleLabel(p.min_role)}>🔒 {minRoleLabel(p.min_role)}</span> : null}<div className="muted small">{stripHtml(p.body)}</div></td>
                <td className="small muted">{uname(p.by_id)}</td>
                <td className="small muted">{p.created_at ? p.created_at.slice(0, 10) : "—"}</td>
                <td>{p.comments?.length || 0}</td><td>{p.views}</td>
              </tr>
            ))}
            {!filtered.length && <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 18 }}>게시글 없음</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
