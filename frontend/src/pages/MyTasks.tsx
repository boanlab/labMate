// 세부업무 — 연구과제·프로젝트에서 본인에게 할당된 업무를 상태별로 보고 편집(과제/프로젝트에 반영).
import { useEffect, useRef, useState, useId } from "react";
import { useNavigate } from "react-router-dom";
import { useAutoPageSize, Pager } from "../ui/pageTable";
import { alertDialog } from "../ui/dialog";
import { api, apiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PageHeader, Chips, Req, formSnapshot, confirmDiscard, statusClass } from "../ui/kit";
import { useColumnResize, useTableSort } from "../ui/tableTools";
import HtmlEditor from "../ui/HtmlEditorLazy";
import { todayKST } from "../lib/date";

interface TFile { name: string; url: string; }
interface Task { id: string; project_id: string; title: string; by_id?: string; assignee_id: string; status: string; start: string | null; due: string | null; done_date?: string | null; body: string; link?: string; files?: TFile[]; }
interface Proj { id: string; kind: string; code: string; name: string; }

const STC: Record<string, string> = { "예정": "#9aa3ad", "진행 중": "#3f5d7d", "완료": "#2e9e6b" };

export default function MyTasks() {
  const [snap, setSnap] = useState("");   // 모달 초기 상태 — 작성 중 이탈 경고 판정용
  // 모달을 닫을 때 변경된 내용이 있으면 확인을 받는다
  async function closeForm() { if (!(await confirmDiscard(formSnapshot(form) !== snap))) return; setForm(null); setSnap(""); }
  const uid = useId();   // 라벨-입력 연결용 고유 접두사
  const { me } = useAuth();
  const nav = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projs, setProjs] = useState<Proj[]>([]);
  const [filter, setFilter] = useState("진행 중");   // 기본: 진행 중
  const [q, setQ] = useState("");
  const [form, setForm] = useState<any | null>(null);
  const [body, setBody] = useState("");
  const [err, setErr] = useState("");

  const tableRef = useColumnResize("mytasks");
  const sort = useTableSort({ key: "due", dir: 1 }, "mytasks");
  const [loaded, setLoaded] = useState(false);   // 첫 조회 완료 여부 — "없음"과 "불러오는 중"을 구분
  async function load() {
    try {
      setTasks((await api.get<Task[]>("/projects/tasks")).data);
      const g = (await api.get<Proj[]>("/projects/projects?kind=grant")).data;
      const a = (await api.get<Proj[]>("/projects/projects?kind=activity")).data;
      setProjs([...g, ...a]);
    } catch (e) { setErr(apiError(e)); } finally { setLoaded(true); }
  }
  useEffect(() => { load(); }, []);

  const projOf = (pid: string) => projs.find((p) => p.id === pid);
  const myTasks = tasks.filter((t) => t.assignee_id === me?.id);
  const today = todayKST();
  const count = (s: string) => s === "전체" ? myTasks.length : myTasks.filter((t) => t.status === s).length;
  const ql = q.trim().toLowerCase();
  const shown = sort.apply(
    (filter === "전체" ? myTasks : myTasks.filter((t) => t.status === filter))
      .filter((t) => { if (!ql) return true; const p = projOf(t.project_id); return `${t.title} ${p?.code || ""} ${p?.name || ""}`.toLowerCase().includes(ql); }),
    { proj: (t) => projOf(t.project_id)?.code || "", title: (t) => t.title, status: (t) => t.status, due: (t) => t.due || "9999" });
  const listRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [q, filter]);
  const pageSize = useAutoPageSize(listRef, shown.length);
  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const view = shown.slice(cur * pageSize, cur * pageSize + pageSize);

  function openEdit(t: Task) {
    const f = { id: t.id, project_id: t.project_id, title: t.title, assignee_id: t.assignee_id, status: t.status, start: t.start || "", due: t.due || "", done_date: t.done_date || "", link: t.link || "", files: t.files || [] };
    setForm(f); setSnap(formSnapshot(f));
    setBody(t.body || "");
  }
  async function uploadFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const fl = e.target.files; if (!fl || !fl.length) return;
    const fd = new FormData(); Array.from(fl).forEach((f) => fd.append("files", f));
    try {
      const r = await api.post<TFile[]>("/projects/uploads", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setForm((f: any) => ({ ...f, files: [...(f.files || []), ...r.data] }));
    } catch (e) { setErr(apiError(e)); }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form) return;
    if (!form.title.trim()) return alertDialog("업무 제목을 입력하세요");
    if (!form.start) return alertDialog("시작일을 입력하세요");
    if (!form.due) return alertDialog("마감일을 입력하세요");
    if (!body.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, "").trim()) return alertDialog("내용을 입력하세요");
    const done_date = (form.done_date || (form.status === "완료" ? todayKST() : "")) || null;
    const payload = { title: form.title, assignee_id: form.assignee_id, status: form.status, start: form.start || null, due: form.due || null, done_date, body, link: form.link, files: form.files || [] };
    try { await api.patch(`/projects/tasks/${form.id}`, payload); setForm(null); load(); }
    catch (e) { setErr(apiError(e)); }
  }
  function goProject(pid: string) { const p = projOf(pid); if (p) nav(`${p.kind === "grant" ? "/grants" : "/projects"}?open=${pid}`); }

  return (
    <div>
      <PageHeader crumb="업무 › 세부업무" title="세부업무" />
      {err && <div className="form-err">{err}</div>}
      <div style={{ marginBottom: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Chips testid="task-filter" value={filter} onChange={setFilter}
          items={["진행 중", "예정", "완료", "전체"].map((f) => ({ key: f, count: count(f) }))} />
        <input className="tsearch" data-testid="task-search" aria-label="업무 검색" placeholder="업무·과제 검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginLeft: "auto", maxWidth: 260 }} />
      </div>
      <div className="card scroll" ref={listRef}>
        <table ref={tableRef} className="tbl fit" data-testid="mytasks-table">
          <thead><tr>
            <th {...sort.th("proj")} style={{ width: 118 }}>과제 · 프로젝트{sort.mark("proj")}</th>
            <th {...sort.th("title")}>업무{sort.mark("title")}</th>
            <th {...sort.th("status")} style={{ width: 72 }}>상태{sort.mark("status")}</th>
            <th {...sort.th("due", "hide-sm")} style={{ width: 100 }}>마감{sort.mark("due")}</th>
          </tr></thead>
          <tbody>
            {view.map((t) => {
              const p = projOf(t.project_id);
              const late = t.status !== "완료" && t.due && t.due < today;
              return (
                <tr key={t.id} style={{ cursor: "pointer" }} onClick={() => openEdit(t)}>
                  <td style={{ overflow: "hidden" }} onClick={(e) => { e.stopPropagation(); goProject(t.project_id); }}>
                    <a className="lnk" style={{ fontWeight: 700, cursor: "pointer" }}>{p ? p.code : "—"}</a>
                    <div className="muted small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p?.name}>{p?.name || ""}</div>
                  </td>
                  <td style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.title}>{t.title}</td>
                  <td><span className={statusClass(t.status)}>{t.status}</span></td>
                  <td className="hide-sm">{t.due ? <span className={"small " + (late ? "badge s-bad" : "")}>{t.due}</span> : <span className="muted small">—</span>}</td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 20 }}>
                {filter === "전체"
                  ? <>배정된 업무가 없습니다. 세부 업무는 <a className="lnk" style={{ cursor: "pointer" }} data-testid="tasks-goto-projects" onClick={() => nav("/projects")}>프로젝트</a> 안에서 담당자를 지정해 만듭니다.</>
                  : <>{filter} 상태인 업무가 없습니다 — 위 필터를 <b>전체</b>로 바꿔보세요.</>}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager page={cur} pages={pages} set={setPage} />

      {form && (
        <div className="modal-ovl" onClick={(e) => { if (e.target === e.currentTarget) closeForm(); }}>
          <form className="modal" data-testid="mytask-form" onSubmit={save} style={{ width: 900, maxWidth: "90%" }}>
            <div className="modal-h"><b>업무 수정</b>
              <span style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn ghost sm" onClick={() => goProject(form.project_id)}>과제 열기 →</button>
                <button type="button" className="btn ghost sm" aria-label="닫기" onClick={closeForm}>✕</button>
              </span>
            </div>
            <div className="modal-b">
              <label htmlFor={`${uid}-1`}>제목<Req/></label>
              <input id={`${uid}-1`} data-testid="mtf-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              <div className="grid2">
                <div><label htmlFor={`${uid}-2`}>상태</label><select id={`${uid}-2`} data-testid="mtf-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{["예정", "진행 중", "완료"].map((s) => <option key={s}>{s}</option>)}</select></div>
                <div><label htmlFor={`${uid}-3`}>실제 마감일 <span className="muted small">(완료 시 자동)</span></label><input id={`${uid}-3`} type="date" value={form.done_date} onChange={(e) => setForm({ ...form, done_date: e.target.value })} /></div>
                <div><label htmlFor={`${uid}-4`}>시작일<Req/></label><input id={`${uid}-4`} type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></div>
                <div><label htmlFor={`${uid}-5`}>마감일<Req/></label><input id={`${uid}-5`} type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} /></div>
              </div>
              <label htmlFor={`${uid}-6`}>링크 (선택)</label>
              <input id={`${uid}-6`} type="url" placeholder="https://…" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} />
              <label>내용<Req/></label>
              <HtmlEditor value={body} onChange={setBody} testid="mtf-body" minHeight={120} />
              <label htmlFor={`${uid}-7`}>첨부파일 (선택)</label>
              <input id={`${uid}-7`} type="file" multiple onChange={uploadFiles} />
              {!!(form.files && form.files.length) && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                  {form.files.map((f: TFile, i: number) => (
                    <span key={i} className="badge s-info">📎 {f.name}
                      <button type="button" onClick={() => setForm((tf: any) => ({ ...tf, files: tf.files.filter((_: any, j: number) => j !== i) }))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", marginLeft: 4 }}>✕</button>
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                <button className="btn primary" data-testid="mtf-submit">저장</button>
                <button type="button" className="btn ghost" onClick={() => setForm(null)}>취소</button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
