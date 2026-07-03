import { useEffect, useState } from "react";
import { todayKST } from "../lib/date";
import { api, apiError } from "../api/client";
import { confirmDialog } from "../ui/dialog";
import { useAuth } from "../auth/AuthContext";
import { PageHeader, Card, AuthorMeta } from "../ui/kit";
import HtmlEditor from "../ui/HtmlEditorLazy";

interface Action { id?: string; title: string; assignee_id: string; due: string; done: boolean; task_id?: string; }
interface Meeting { id: string; date: string; title: string; by_id: string; decisions: string; actions: Action[]; attendees: string[]; project_id?: string; updated_by?: string; created_at?: string; updated_at?: string; }
// 진행 중 판정 — 연구과제=해당 연도 기간(폴백 총기간), 프로젝트=총기간
function ongoing(p: any, isGrant: boolean): boolean {
  const t = todayKST();
  const m = p.meta || {};
  const [s, e] = (isGrant && (m.year_start || m.year_end)) ? [m.year_start || "", m.year_end || ""] : [p.start || "", p.end || ""];
  if (s && t < s) return false;   // 예정
  if (e && t > e) return false;   // 완료
  return true;                    // 진행 중
}

export default function Meetings() {
  const { me } = useAuth();
  const isMgr = !!me && ["prof", "staff", "admin"].includes(me.role);
  const [items, setItems] = useState<Meeting[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [grants, setGrants] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<null | { id?: string }>(null);
  const [open, setOpen] = useState<Meeting | null>(null);
  const [q, setQ] = useState("");
  const today = todayKST();
  const [form, setForm] = useState({ date: today, title: "", project_id: "", decisions: "", attendees: [] as string[], actions: [] as Action[] });
  const [dec, setDec] = useState("");

  const uname = (id: string) => users.find((u) => u.id === id)?.name || id.slice(0, 6);
  const taskById: Record<string, any> = Object.fromEntries(tasks.map((t: any) => [t.id, t]));
  const isDone = (a: Action) => (a.task_id ? taskById[a.task_id]?.status === "완료" : !!a.done);
  const projName = (id?: string) => { const p = [...grants, ...activities].find((x) => x.id === id); return p ? `${p.code} · ${p.name}` : ""; };
  const projCode = (id?: string) => [...grants, ...activities].find((x) => x.id === id)?.code || "";
  const shown = items.filter((m) => !q.trim() || `${m.title} ${m.decisions || ""} ${projCode(m.project_id)} ${uname(m.by_id)}`.toLowerCase().includes(q.trim().toLowerCase()));
  // 관련 프로젝트 후보 — 본인 참여+진행 중(기존 선택은 유지)
  const mineProj = (p: any) => !!me && (p.lead_id === me.id || p.pm_id === me.id || (p.members || []).includes(me.id));
  const ongoingGrants = grants.filter((p) => (ongoing(p, true) && mineProj(p)) || p.id === form.project_id);
  const ongoingActs = activities.filter((p) => (ongoing(p, false) && mineProj(p)) || p.id === form.project_id);
  async function load() {
    try {
      setItems((await api.get<Meeting[]>("/boards/meetings")).data);
      setUsers((await api.get<any[]>("/members/users")).data);
      api.get("/projects/projects?kind=grant").then((r) => setGrants(r.data)).catch(() => {});
      api.get("/projects/projects?kind=activity").then((r) => setActivities(r.data)).catch(() => {});
      api.get("/projects/tasks").then((r) => setTasks(r.data)).catch(() => {});
    } catch (e) { setErr(apiError(e)); }
  }
  useEffect(() => { load(); }, []);

  function openNew() { setForm({ date: today, title: "", project_id: "", decisions: "", attendees: [], actions: [] }); setEditing({}); setDec(""); }
  function openEdit(m: Meeting) {
    setForm({ date: m.date, title: m.title, project_id: m.project_id || "", decisions: m.decisions, attendees: m.attendees || [], actions: (m.actions || []).map((a) => ({ ...a })) });
    setEditing({ id: m.id }); setDec(m.decisions || "");
  }
  function toggleAttendee(uid: string) {
    setForm((f) => ({ ...f, attendees: f.attendees.includes(uid) ? f.attendees.filter((x) => x !== uid) : [...f.attendees, uid] }));
  }
  function addAction() { setForm((f) => ({ ...f, actions: [...f.actions, { title: "", assignee_id: "", due: "", done: false }] })); }
  function setAction(i: number, patch: Partial<Action>) { setForm((f) => ({ ...f, actions: f.actions.map((a, j) => j === i ? { ...a, ...patch } : a) })); }
  function delAction(i: number) { setForm((f) => ({ ...f, actions: f.actions.filter((_, j) => j !== i) })); }

  async function save() {
    setErr("");
    const actions = form.actions.map((a) => ({ ...a }));
    // 관련 과제가 있으면 신규 액션을 세부 업무(예정)로 등록하고 task_id 연결
    if (form.project_id) {
      for (const a of actions) {
        if (!a.task_id && a.title.trim()) {
          try {
            const r = await api.post<any>(`/projects/projects/${form.project_id}/tasks`, { title: a.title, assignee_id: a.assignee_id || "", due: a.due || null, status: "예정" });
            a.task_id = r.data.id;
          } catch { /* 참여자 아님 등 — 연결 생략, 회의록에서 수동 체크 */ }
        }
      }
    }
    const payload = { ...form, actions, decisions: dec };
    try {
      if (editing?.id) await api.put(`/boards/meetings/${editing.id}`, payload);
      else await api.post("/boards/meetings", payload);
      setEditing(null); load();
    } catch (e) { setErr(apiError(e)); }
  }
  async function del(m: Meeting) {
    if (!await confirmDialog("회의록을 삭제할까요?")) return;
    try { await api.delete(`/boards/meetings/${m.id}`); setOpen(null); load(); } catch (e) { setErr(apiError(e)); }
  }
  async function toggleAction(m: Meeting, a: Action) {
    try { const r = await api.post<Meeting>(`/boards/meetings/${m.id}/actions/${a.id}/toggle`); setOpen(r.data); load(); } catch (e) { setErr(apiError(e)); }
  }

  // ===== 작성/수정 페이지 =====
  if (editing) {
    return (
      <div data-testid="page-meeting-form">
        <PageHeader crumb="소통 › 회의록" title={editing.id ? "회의록 수정" : "회의록 작성"} action={<button className="btn ghost" onClick={() => setEditing(null)}>목록</button>} />
        {err && <div className="form-err" data-testid="meeting-error">{err}</div>}
        <Card>
          <div><label>제목</label><input data-testid="mt-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="grid2" style={{ marginBottom: 10 }}>
            <div><label>일자</label><input data-testid="mt-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            <div><label>관련 프로젝트 <span className="muted small">(선택 시 액션아이템이 세부 업무로 등록)</span></label>
              <select data-testid="mt-project" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} style={{ margin: 0 }}>
                <option value="">(없음 — 회의록에서 직접 체크)</option>
                {ongoingGrants.length > 0 && <optgroup label="연구과제">{ongoingGrants.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</optgroup>}
                {ongoingActs.length > 0 && <optgroup label="프로젝트">{ongoingActs.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</optgroup>}
              </select>
            </div>
          </div>
          <label>참석자</label>
          <div className="fchips" data-testid="mt-attendees" style={{ marginBottom: 10 }}>
            {users.filter((u) => u.role !== "admin" && u.active !== false).map((u) => <button type="button" key={u.id} className={"chip" + (form.attendees.includes(u.id) ? " on" : "")} onClick={() => toggleAttendee(u.id)}>{u.name}</button>)}
          </div>
          <label>결정사항</label>
          <HtmlEditor value={dec} onChange={setDec} testid="mt-decisions" minHeight={120} />
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>액션아이템
            <button type="button" className="btn ghost sm" data-testid="mt-action-add" onClick={addAction}>+ 추가</button>
          </label>
          {form.actions.map((a, i) => (
            <div key={i} data-testid={`mt-action-${i}`} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <input placeholder="할 일" value={a.title} onChange={(e) => setAction(i, { title: e.target.value })} style={{ flex: 1, margin: 0, minWidth: 0 }} />
              <select value={a.assignee_id} onChange={(e) => setAction(i, { assignee_id: e.target.value })} style={{ flex: "0 0 130px", margin: 0, minWidth: 0 }}>
                <option value="">담당자</option>{users.filter((u) => u.role !== "admin" && u.active !== false).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <input type="date" value={a.due} onChange={(e) => setAction(i, { due: e.target.value })} style={{ flex: "0 0 150px", margin: 0 }} />
              <button type="button" className="btn ghost sm" onClick={() => delAction(i)}>✕</button>
            </div>
          ))}
          {!form.actions.length && <div className="muted small">액션아이템 없음 — “누가 언제까지 무엇을” 추가</div>}
        </Card>
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <button className="btn primary" data-testid="meeting-add-submit" onClick={save}>저장</button>
          <button className="btn ghost" onClick={() => setEditing(null)}>취소</button>
        </div>
      </div>
    );
  }

  // ===== 보기 페이지 =====
  if (open) {
    return (
      <div data-testid="page-meeting-view">
        <PageHeader crumb="소통 › 회의록" title={open.title} action={
          <span style={{ display: "flex", gap: 6 }}>
            {(open.by_id === me?.id || isMgr) && <button className="btn ghost" data-testid="meeting-edit" onClick={() => { openEdit(open); setOpen(null); }}>수정</button>}
            <button className="btn ghost" onClick={() => setOpen(null)}>목록</button>
          </span>
        } />
        {err && <div className="form-err" data-testid="meeting-error">{err}</div>}
        <Card>
          <table className="metatbl"><tbody>
            <tr><th>일자</th><td>{open.date}</td></tr>
            <tr><th>작성·수정</th><td><AuthorMeta by={open.by_id} updatedBy={open.updated_by} createdAt={open.created_at} updatedAt={open.updated_at} nameOf={uname} className="" /></td></tr>
            <tr><th>참석자</th><td>{(open.attendees || []).map(uname).join(", ") || "—"}</td></tr>
            {open.project_id && <tr><th>관련 프로젝트</th><td>{projName(open.project_id) || "—"}</td></tr>}
          </tbody></table>
          {open.decisions ? <div style={{ margin: "0 0 12px", lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: open.decisions }} /> : <div style={{ margin: "0 0 12px" }} className="muted">결정사항 없음</div>}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)" }}><b>액션아이템</b></div>
          {(open.actions || []).length ? (
            <table className="tbl" style={{ minWidth: 0, marginTop: 8 }}>
              <thead><tr><th style={{ width: 44 }}>완료</th><th>할 일</th><th style={{ width: 100 }}>담당자</th><th style={{ width: 120 }}>마감</th><th style={{ width: 110 }}>세부 업무</th></tr></thead>
              <tbody>
                {(open.actions || []).map((a) => {
                  const linked = a.task_id ? taskById[a.task_id] : null;
                  const done = isDone(a);
                  const canToggle = isMgr || !!me?.delegated_admin || a.assignee_id === me?.id;   // 완료 처리는 교수·행정·담당자만
                  return (
                    <tr key={a.id}>
                      <td><input type="checkbox" checked={done} disabled={!!a.task_id || !canToggle} onChange={() => { if (!a.task_id && canToggle) toggleAction(open, a); }} data-testid={`mt-action-toggle-${a.id}`} style={{ width: "auto", margin: 0 }} title={a.task_id ? "세부 업무 상태에 따라 자동 반영" : canToggle ? "클릭해 완료 처리" : "담당자·교수·행정만 완료 처리"} /></td>
                      <td style={{ whiteSpace: "normal", textDecoration: done ? "line-through" : "none", color: done ? "var(--sub)" : "inherit" }}>{a.title || "—"}</td>
                      <td className="small muted">{a.assignee_id ? uname(a.assignee_id) : "미정"}</td>
                      <td className="small muted">{a.due || "—"}</td>
                      <td className="small">{a.task_id ? (linked ? <span className={"badge " + (linked.status === "완료" ? "s-ok" : linked.status === "진행" ? "s-info" : "s-mute")}>{linked.status}</span> : <span className="muted">삭제됨</span>) : <span className="muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <div className="muted small" style={{ marginTop: 8 }}>액션아이템 없음</div>}
        </Card>
        {(open.by_id === me?.id || isMgr) && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <button data-testid="meeting-del" onClick={() => del(open)} style={{ background: "none", border: "none", color: "var(--bad)", fontSize: 11.5, padding: "2px 4px", textDecoration: "underline", opacity: 0.8 }}>회의록 삭제</button>
          </div>
        )}
      </div>
    );
  }

  // ===== 목록 =====
  return (
    <div data-testid="page-meetings">
      <div className="page-head">
        <div><div className="crumb">소통 › 회의록</div><h1>회의록</h1></div>
        <button className="btn primary" data-testid="meeting-add-open" onClick={openNew}>+ 회의록 작성</button>
      </div>
      {err && <div className="form-err" data-testid="meeting-error">{err}</div>}

      <div className="tbar"><input className="tsearch" data-testid="meeting-search" placeholder="제목·결정사항·프로젝트·작성자 검색…" value={q} onChange={(e) => setQ(e.target.value)} /><span className="muted small" style={{ marginLeft: "auto" }}>{shown.length}건</span></div>
      <div className="card">
        <table className="tbl" data-testid="meeting-table">
          <thead><tr><th style={{ width: 110 }}>일자</th><th style={{ width: 130 }}>관리코드</th><th>제목</th><th style={{ width: 100 }}>작성자</th><th style={{ width: 70 }}>참석</th><th style={{ width: 120 }}>액션(완료/전체)</th></tr></thead>
          <tbody>
            {shown.map((m) => {
              const done = (m.actions || []).filter((a) => isDone(a)).length;
              return (
                <tr key={m.id} style={{ cursor: "pointer" }} onClick={() => setOpen(m)}>
                  <td>{m.date}</td>
                  <td className="small muted">{projCode(m.project_id) || "-"}</td>
                  <td><a style={{ cursor: "pointer", fontWeight: 600 }} data-testid={`mt-open-${m.id}`} onClick={(e) => { e.stopPropagation(); setOpen(m); }}>{m.title}</a></td>
                  <td className="small muted">{uname(m.by_id)}</td>
                  <td>{(m.attendees || []).length}명</td>
                  <td><span className={"badge " + (m.actions?.length && done === m.actions.length ? "s-ok" : "s-info")}>{done}/{m.actions?.length || 0}</span></td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={6} className="muted">{items.length ? "검색 결과 없음" : "회의록 없음"}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
