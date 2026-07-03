import { useEffect, useState } from "react";
import { todayKST } from "../lib/date";
import { api, apiError } from "../api/client";
import { confirmDialog } from "../ui/dialog";
import { useAuth } from "../auth/AuthContext";
import { stripHtml } from "../ui/html";
import HtmlEditor from "../ui/HtmlEditorLazy";
import { PageHeader, Card, AuthorMeta } from "../ui/kit";

interface TFile { name: string; url: string; }
interface Notice { id: string; title: string; body: string; by_id: string; required: boolean; due: string | null; acked_user_ids: string[]; link?: string; files?: TFile[]; target_user_ids?: string[]; updated_by?: string; created_at?: string; updated_at?: string; }

export default function Notices() {
  const { me } = useAuth();
  const isMgr = !!me && (["prof", "staff"].includes(me.role) || !!me.delegated_admin);   // 공지 작성·관리 = 교수·행정·위임
  const [items, setItems] = useState<Notice[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState("");
  const [open, setOpen] = useState<Notice | null>(null);
  const [q, setQ] = useState("");
  const emptyForm = { title: "", required: false, due: "", link: "", files: [] as TFile[], targetMode: "all" as "all" | "select", target_user_ids: [] as string[], by_id: "" };
  const [form, setForm] = useState(emptyForm);
  const [body, setBody] = useState("");
  const today = todayKST();
  const uname = (id: string) => users.find((u) => u.id === id)?.name || id.slice(0, 6);
  const members = users.filter((u) => u.active !== false && u.role !== "admin");

  async function load() {
    try {
      setItems((await api.get<Notice[]>("/boards/notices")).data);
      setUsers((await api.get<any[]>("/members/users")).data);
    } catch (e) { setErr(apiError(e)); }
  }
  useEffect(() => { load(); }, []);

  function openForm() { setEditId(""); setForm({ ...emptyForm, by_id: me?.id || "" }); setAdding(true); setBody(""); }
  function editNotice(n: Notice) {
    setEditId(n.id);
    setForm({ title: n.title, required: n.required, due: n.due || "", link: n.link || "", files: n.files || [], targetMode: (n.target_user_ids && n.target_user_ids.length) ? "select" : "all", target_user_ids: n.target_user_ids || [], by_id: n.by_id });
    setOpen(null); setAdding(true); setBody(n.body || "");
  }
  function toggleTarget(uid: string) { setForm((f) => ({ ...f, target_user_ids: f.target_user_ids.includes(uid) ? f.target_user_ids.filter((x) => x !== uid) : [...f.target_user_ids, uid] })); }
  async function uploadFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const fl = e.target.files; if (!fl || !fl.length) return;
    const fd = new FormData(); Array.from(fl).forEach((f) => fd.append("files", f));
    try {
      const r = await api.post<TFile[]>("/projects/uploads", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setForm((f) => ({ ...f, files: [...f.files, ...r.data] }));
    } catch (err) { setErr(apiError(err)); }
    e.target.value = "";
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    const payload = {
      title: form.title, body, required: form.required, due: form.due || null,
      link: form.link, files: form.files, target_user_ids: form.targetMode === "select" ? form.target_user_ids : [],
    };
    try {
      if (editId) await api.patch(`/boards/notices/${editId}`, payload);
      else await api.post("/boards/notices", payload);
      setAdding(false); setEditId(""); setForm(emptyForm); load();
    } catch (e) { setErr(apiError(e)); }
  }
  async function delNotice(n: Notice) {
    if (!await confirmDialog("이 공지를 삭제할까요?")) return;
    try { await api.delete(`/boards/notices/${n.id}`); setOpen(null); load(); } catch (e) { setErr(apiError(e)); }
  }
  async function ack(n: Notice) {
    try { const r = await api.post<Notice>(`/boards/notices/${n.id}/ack`); if (open) setOpen(r.data); load(); } catch (e) { setErr(apiError(e)); }
  }

  const audience = (n: Notice) => (n.target_user_ids && n.target_user_ids.length) ? n.target_user_ids : members.map((u) => u.id);
  const ackInfo = (n: Notice) => { const aud = audience(n); return { acked: aud.filter((id) => n.acked_user_ids.includes(id)).length, total: aud.length }; };
  const shown = items.filter((n) => !q.trim() || `${n.title} ${stripHtml(n.body || "")}`.toLowerCase().includes(q.trim().toLowerCase()));
  const canEdit = (n: Notice) => isMgr || n.by_id === me?.id;
  const mustAck = (n: Notice) => !!me && audience(n).includes(me.id);

  // ===== 공지 보기 페이지 =====
  if (open) {
    return (
      <div data-testid="page-notice-view">
        <PageHeader crumb={"소통 › 공지사항" + (open.required ? " · 필독" : "")} title={open.title} action={
          <span style={{ display: "flex", gap: 6 }}>
            {canEdit(open) && <button className="btn ghost" onClick={() => editNotice(open)}>수정</button>}
            <button className="btn ghost" onClick={() => setOpen(null)}>목록</button>
          </span>
        } />
        {err && <div className="form-err" data-testid="notice-error">{err}</div>}
        <Card>
          <table className="metatbl"><tbody>
            <tr><th>작성·수정</th><td><AuthorMeta by={open.by_id} updatedBy={open.updated_by} createdAt={open.created_at} updatedAt={open.updated_at} nameOf={uname} className="" /></td></tr>
            <tr><th>확인 마감</th><td>{open.due || "—"}</td></tr>
            <tr><th>대상</th><td>{(open.target_user_ids && open.target_user_ids.length) ? `선택 ${open.target_user_ids.length}명 · ${open.target_user_ids.map(uname).join(", ")}` : "전체 연구원"}</td></tr>
          </tbody></table>
          <div style={{ lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: open.body || "<span class='muted'>내용 없음</span>" }} />
          {open.link && <div style={{ marginTop: 12 }}><a className="lnk small" href={open.link} target="_blank" rel="noreferrer">🔗 {open.link}</a></div>}
          {!!(open.files && open.files.length) && (
            <div style={{ marginTop: 12 }}>
              <div className="muted small" style={{ marginBottom: 4 }}>첨부파일</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {open.files.map((f, i) => <a key={i} className="badge s-info" href={f.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", padding: "5px 10px" }}>📎 {f.name}</a>)}
              </div>
            </div>
          )}
          {isMgr && (
            <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <div style={{ marginBottom: 6 }}><b className="small">확인 현황 {ackInfo(open).acked}/{ackInfo(open).total}</b></div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {members.filter((u) => audience(open).includes(u.id)).map((u) => {
                  const ok = open.acked_user_ids.includes(u.id);
                  return <span key={u.id} className={"badge " + (ok ? "s-ok" : "s-mute")}>{ok ? "✓ " : "· "}{u.name}</span>;
                })}
              </div>
            </div>
          )}
          {me && (
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--line2)", display: "flex", alignItems: "center", gap: 10 }}>
              {!mustAck(open)
                ? <span className="muted small">확인 대상이 아닙니다</span>
                : open.acked_user_ids.includes(me.id)
                  ? <><button className="btn ok" data-testid="notice-ack-modal" onClick={() => ack(open)}>✓ 확인 완료</button><span className="muted small">다시 누르면 미확인으로 전환됩니다</span></>
                  : <><button className="btn primary" data-testid="notice-ack-modal" onClick={() => ack(open)}>이 공지를 확인했습니다</button><span className="muted small">아직 확인하지 않은 공지입니다</span></>}
            </div>
          )}
        </Card>
        {canEdit(open) && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <button data-testid="notice-del" onClick={() => delNotice(open)} style={{ background: "none", border: "none", color: "var(--bad)", fontSize: 11.5, padding: "2px 4px", textDecoration: "underline", opacity: 0.8 }}>공지사항 삭제</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-testid="page-notices">
      <div className="page-head">
        <div><div className="crumb">소통 › 공지사항</div><h1>공지사항</h1></div>
        {isMgr && <button className="btn primary" data-testid="notice-add-open" onClick={() => (adding ? setAdding(false) : openForm())}>+ 공지 작성</button>}
      </div>
      {err && <div className="form-err" data-testid="notice-error">{err}</div>}
      {adding && (
        <form className="card" onSubmit={save} data-testid="notice-form">
          <div className="bd">
            {editId && <div className="io" style={{ marginBottom: 10 }}>수정 중</div>}
            <div className="muted small" style={{ marginBottom: 8 }}>작성자 · <b>{uname(form.by_id)}</b></div>
            <div className="grid3">
              <div style={{ gridColumn: "span 2" }}><label>제목</label><input data-testid="n-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
              <div><label>확인 마감일(선택)</label><input data-testid="n-due" type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} /></div>
            </div>
            <div className="grid3" style={{ marginTop: 4 }}>
              <div style={{ gridColumn: "span 2" }}>
                <label>확인 대상</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" className={"btn sm " + (form.targetMode === "all" ? "primary" : "ghost")} onClick={() => setForm({ ...form, targetMode: "all" })} data-testid="n-target-all">전체</button>
                  <button type="button" className={"btn sm " + (form.targetMode === "select" ? "primary" : "ghost")} onClick={() => setForm({ ...form, targetMode: "select" })} data-testid="n-target-select">선택{form.targetMode === "select" && form.target_user_ids.length ? ` ${form.target_user_ids.length}` : ""}</button>
                </div>
              </div>
              <div>
                <label>필독 지정</label>
                <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}><input type="checkbox" data-testid="n-required" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} style={{ width: "auto", margin: 0 }} /> 필독</label>
              </div>
            </div>
            {form.targetMode === "select" && (
              <div className="fchips" data-testid="n-target_user_ids" style={{ marginTop: 6 }}>
                {members.map((u) => <button type="button" key={u.id} className={"chip" + (form.target_user_ids.includes(u.id) ? " on" : "")} onClick={() => toggleTarget(u.id)}>{u.name}</button>)}
              </div>
            )}
            <label>내용</label><HtmlEditor value={body} onChange={setBody} testid="n-body" minHeight={200} />
            <label>링크(선택)</label>
            <input data-testid="n-link" type="url" placeholder="https://…" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} />
            <label>첨부파일(선택)</label>
            <input type="file" multiple data-testid="n-files" onChange={uploadFiles} />
            {!!form.files.length && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {form.files.map((f, i) => (
                  <span key={i} className="badge s-info">📎 {f.name}
                    <button type="button" onClick={() => setForm((ff) => ({ ...ff, files: ff.files.filter((_, j) => j !== i) }))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", marginLeft: 4 }}>✕</button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <button className="btn primary" data-testid="notice-add-submit">{editId ? "저장" : "작성"}</button>
              <button type="button" className="btn ghost" onClick={() => { setAdding(false); setEditId(""); setForm(emptyForm); }}>취소</button>
            </div>
          </div>
        </form>
      )}
      <div className="tbar"><input className="tsearch" data-testid="notice-search" placeholder="제목·내용 검색…" value={q} onChange={(e) => setQ(e.target.value)} /><span className="muted small" style={{ marginLeft: "auto" }}>{shown.length}건</span></div>
      <div className="card">
        <table className="tbl" data-testid="notice-table">
          <thead><tr><th>공지</th><th>대상</th><th>마감</th><th>내 확인</th>{isMgr && <th>현황</th>}</tr></thead>
          <tbody>
            {shown.map((n) => {
              const acked = me ? n.acked_user_ids.includes(me.id) : false;
              const overdue = n.due && n.due < today;
              const info = ackInfo(n);
              return (
                <tr key={n.id}>
                  <td>{n.required && <span className="badge s-bad" style={{ marginRight: 6 }}>필독</span>}<a className="lnk" style={{ fontWeight: 600 }} data-testid={`notice-open-${n.id}`} onClick={() => setOpen(n)}>{n.title}</a><div className="muted small">{stripHtml(n.body)}{(n.files && n.files.length) ? ` 📎${n.files.length}` : ""}{n.link ? " 🔗" : ""}</div></td>
                  <td className="small muted">{(n.target_user_ids && n.target_user_ids.length) ? `선택 ${n.target_user_ids.length}명` : "전체"}</td>
                  <td>{n.due ? <span className={overdue ? "badge s-bad" : "muted small"}>{n.due}{overdue ? " 초과" : ""}</span> : <span className="muted small">—</span>}</td>
                  <td>{mustAck(n) ? (acked ? <span className="badge s-ok">✓ 확인</span> : <span className="badge s-wait">미확인</span>) : <span className="muted small">대상 아님</span>}</td>
                  {isMgr && <td><span className={info.acked >= info.total ? "badge s-ok" : "badge s-wait"}>{info.acked}/{info.total}</span></td>}
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={isMgr ? 5 : 4} className="muted">{items.length ? "검색 결과 없음" : "공지 없음"}</td></tr>}
          </tbody>
        </table>
      </div>

    </div>
  );
}
