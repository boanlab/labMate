// 세부업무 — 연구과제·프로젝트에서 본인에게 할당된 업무를 상태별로 보고 편집(과제/프로젝트에 반영).
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PageHeader, Chips } from "../ui/kit";
import HtmlEditor from "../ui/HtmlEditorLazy";
import { todayKST } from "../lib/date";

interface TFile { name: string; url: string; }
interface Task { id: string; project_id: string; title: string; by_id?: string; assignee_id: string; status: string; start: string | null; due: string | null; done_date?: string | null; body: string; link?: string; files?: TFile[]; }
interface Proj { id: string; kind: string; code: string; name: string; }

const STC: Record<string, string> = { "예정": "#9aa3ad", "진행": "#3f5d7d", "완료": "#2e9e6b" };

export default function MyTasks() {
  const { me } = useAuth();
  const nav = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projs, setProjs] = useState<Proj[]>([]);
  const [filter, setFilter] = useState("진행");   // 기본: 진행 중
  const [q, setQ] = useState("");
  const [form, setForm] = useState<any | null>(null);
  const [body, setBody] = useState("");
  const [err, setErr] = useState("");

  async function load() {
    try {
      setTasks((await api.get<Task[]>("/projects/tasks")).data);
      const g = (await api.get<Proj[]>("/projects/projects?kind=grant")).data;
      const a = (await api.get<Proj[]>("/projects/projects?kind=activity")).data;
      setProjs([...g, ...a]);
    } catch (e) { setErr(apiError(e)); }
  }
  useEffect(() => { load(); }, []);

  const projOf = (pid: string) => projs.find((p) => p.id === pid);
  const myTasks = tasks.filter((t) => t.assignee_id === me?.id);
  const today = todayKST();
  const count = (s: string) => s === "전체" ? myTasks.length : myTasks.filter((t) => t.status === s).length;
  const ql = q.trim().toLowerCase();
  const shown = (filter === "전체" ? myTasks : myTasks.filter((t) => t.status === filter))
    .filter((t) => { if (!ql) return true; const p = projOf(t.project_id); return `${t.title} ${p?.code || ""} ${p?.name || ""}`.toLowerCase().includes(ql); })
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));

  function openEdit(t: Task) {
    setForm({ id: t.id, project_id: t.project_id, title: t.title, assignee_id: t.assignee_id, status: t.status, start: t.start || "", due: t.due || "", done_date: t.done_date || "", link: t.link || "", files: t.files || [] });
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
          items={["예정", "진행", "완료", "전체"].map((f) => ({ key: f, count: count(f) }))} />
        <input className="tsearch" data-testid="task-search" placeholder="업무·과제 검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginLeft: "auto", maxWidth: 260 }} />
      </div>
      <div className="card scroll">
        <table className="tbl" data-testid="mytasks-table" style={{ tableLayout: "fixed", width: "100%" }}>
          <thead><tr><th style={{ width: 200 }}>과제 · 프로젝트</th><th>업무</th><th style={{ width: 72 }}>상태</th><th style={{ width: 116 }}>마감</th></tr></thead>
          <tbody>
            {shown.map((t) => {
              const p = projOf(t.project_id);
              const late = t.status !== "완료" && t.due && t.due < today;
              return (
                <tr key={t.id} style={{ cursor: "pointer" }} onClick={() => openEdit(t)}>
                  <td style={{ overflow: "hidden" }} onClick={(e) => { e.stopPropagation(); goProject(t.project_id); }}>
                    <a className="lnk" style={{ fontWeight: 700, cursor: "pointer" }}>{p ? p.code : "—"}</a>
                    <div className="muted small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p?.name}>{p?.name || ""}</div>
                  </td>
                  <td style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.title}>{t.title}</td>
                  <td><span className="badge" style={{ background: (STC[t.status] || "#5a6478") + "1f", color: STC[t.status] || "#5a6478" }}>{t.status}</span></td>
                  <td>{t.due ? <span className={"small " + (late ? "badge s-bad" : "")}>{t.due}</span> : <span className="muted small">—</span>}</td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 16 }}>{filter === "전체" ? "담당 업무가 없습니다" : `${filter} 업무가 없습니다`}</td></tr>}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="modal-ovl" onClick={(e) => { if (e.target === e.currentTarget) setForm(null); }}>
          <form className="modal" data-testid="mytask-form" onSubmit={save} style={{ width: 900, maxWidth: "90%" }}>
            <div className="modal-h"><b>업무 수정</b>
              <span style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn ghost sm" onClick={() => goProject(form.project_id)}>과제 열기 →</button>
                <button type="button" className="btn ghost sm" onClick={() => setForm(null)}>✕</button>
              </span>
            </div>
            <div className="modal-b">
              <label>제목</label>
              <input data-testid="mtf-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              <div className="grid2">
                <div><label>상태</label><select data-testid="mtf-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{["예정", "진행", "완료"].map((s) => <option key={s}>{s}</option>)}</select></div>
                <div><label>실제 마감일 <span className="muted small">(완료 시 자동)</span></label><input type="date" value={form.done_date} onChange={(e) => setForm({ ...form, done_date: e.target.value })} /></div>
                <div><label>시작일</label><input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></div>
                <div><label>마감일</label><input type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} /></div>
              </div>
              <label>링크 (선택)</label>
              <input type="url" placeholder="https://…" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} />
              <label>내용</label>
              <HtmlEditor value={body} onChange={setBody} testid="mtf-body" minHeight={120} />
              <label>첨부파일 (선택)</label>
              <input type="file" multiple onChange={uploadFiles} />
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
