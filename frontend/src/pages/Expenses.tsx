import { useEffect, useState } from "react";
import { todayKST } from "../lib/date";
import { api, apiError } from "../api/client";
import { confirmDialog } from "../ui/dialog";
import { useAuth } from "../auth/AuthContext";
import { useConfig, names } from "../api/config";
import { Chips } from "../ui/kit";


interface TFile { name: string; url: string; }
interface Exp { id: string; project_id: string; category: string; subcategory: string; title: string; amount: number; status: string; by_id: string; claim_date?: string; files?: TFile[]; }
interface Proj { id: string; code: string; start?: string | null; end?: string | null; meta?: Record<string, any>; }
const CATS_FB = [{ name: "인건비", subs: [] }, { name: "학생인건비", subs: [] }, { name: "장비비", subs: [] }, { name: "재료비", subs: [] }, { name: "연구활동비", subs: [] }, { name: "연구수당", subs: [] }, { name: "간접비", subs: [] }];
const FILTERS = ["전체", "진행 중", "예정", "완료"];
// 과제 상태는 해당 연도 기간 기준(미입력 시 총 과제기간)
function autoStatus(start?: string | null, end?: string | null): string {
  const t = todayKST();
  if (start && t < start) return "예정";
  if (end && t > end) return "완료";
  return "진행 중";
}
function grantAutoStatus(p?: Proj): string {
  if (!p) return "";
  const m = p.meta || {};
  if (m.year_start || m.year_end) return autoStatus(m.year_start || null, m.year_end || null);
  return autoStatus(p.start, p.end);
}

export default function Expenses() {
  const { me } = useAuth();
  const isAdmin = !!me && (["prof", "staff"].includes(me.role) || !!me.delegated_admin);
  const BCATS = useConfig<any[]>("budget_types", CATS_FB);
  const STD = names(BCATS);
  const subsOf = (category: string): string[] => (BCATS.find((c: any) => (c.name || c) === category)?.subs) || [];
  const [items, setItems] = useState<Exp[]>([]);
  const [projects, setProjects] = useState<Proj[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState("");
  const today = todayKST();
  const uname = (id: string) => users.find((u) => u.id === id)?.name || "—";
  const code = (pid: string) => projects.find((p) => p.id === pid)?.code || "—";
  const [filterPid, setFilterPid] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("진행 중");   // 기본: 진행 중 과제 내역만
  const [formYear, setFormYear] = useState(todayKST().slice(0, 4));   // 등록 화면 연도(기본 현 시점)
  const [form, setForm] = useState({ project_id: "", category: "인건비", subcategory: "", title: "", claim_date: today, amount: 0, files: [] as TFile[] });

  async function uploadFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const fl = e.target.files; if (!fl || !fl.length) return;
    const fd = new FormData(); Array.from(fl).forEach((f) => fd.append("files", f));
    try { const r = await api.post<TFile[]>("/projects/uploads", fd, { headers: { "Content-Type": "multipart/form-data" } }); setForm((f) => ({ ...f, files: [...f.files, ...r.data] })); }
    catch (err) { setErr(apiError(err)); }
    e.target.value = "";
  }

  async function load() {
    try {
      setItems((await api.get<Exp[]>("/funds/expenses")).data);
      const pr = (await api.get<Proj[]>("/projects/projects?kind=grant")).data;
      setProjects(pr);
      if (pr.length && !form.project_id) setForm((f) => ({ ...f, project_id: pr[0].id }));
      setUsers((await api.get<any[]>("/members/users")).data);
    } catch (e) { setErr(apiError(e)); }
  }
  useEffect(() => { load(); }, []);

  const EMPTY = { project_id: projects[0]?.id || "", category: "인건비", subcategory: "", title: "", claim_date: today, amount: 0, files: [] as TFile[] };
  function openForm() {
    setEditId("");
    const yr = today.slice(0, 4); setFormYear(yr);                               // 등록 시작: 현 시점 연도
    const yp = projects.filter((p) => projInYear(p, yr));
    setForm({ ...EMPTY, project_id: yp[0]?.id || projects[0]?.id || "" });
    setAdding((v) => !v);
  }
  function editExpense(x: Exp) {
    setFormYear((x.claim_date || today).slice(0, 4));                            // 수정: 집행연도로 맞춰 과제 노출
    setForm({ project_id: x.project_id, category: x.category, subcategory: x.subcategory || "", title: x.title, claim_date: x.claim_date || today, amount: x.amount, files: x.files || [] });
    setEditId(x.id); setAdding(true);
  }
  function closeForm() { setAdding(false); setEditId(""); setForm({ ...EMPTY, project_id: form.project_id || projects[0]?.id || "" }); }
  async function save() {
    setErr("");
    if (!form.title.trim()) { setErr("집행 내용을 입력하세요"); return; }
    if (!form.amount) { setErr("금액을 입력하세요"); return; }
    const payload = { ...form, amount: Number(form.amount) };
    try {
      if (editId) await api.put(`/funds/expenses/${editId}`, payload);
      else await api.post("/funds/expenses", payload);
      closeForm(); load();
    } catch (e) { setErr(apiError(e)); }
  }
  async function del(x: Exp) {
    if (!await confirmDialog(`집행 내역 "${x.title}"을(를) 삭제할까요? (예산 집행액도 원복됩니다)`, { danger: true })) return;
    try { await api.delete(`/funds/expenses/${x.id}`); load(); } catch (e) { setErr(apiError(e)); }
  }

  // 과제 해당 연도 기간(미입력 시 총 기간)이 선택 연도를 포함하면 그 연도 과제로 노출
  const projInYear = (p: Proj, yr: string) => {
    const m = p.meta || {};
    const s = ((m.year_start || m.year_end) ? (m.year_start || "") : (p.start || ""));
    const e = ((m.year_start || m.year_end) ? (m.year_end || "") : (p.end || ""));
    return (!s || s.slice(0, 4) <= yr) && (!e || e.slice(0, 4) >= yr);
  };
  // 과제 해당 연도 기간의 최소~최대 연도를 연속 표시(최근 연도부터)
  const yearOpts = (() => {
    let min = Infinity, max = -Infinity;
    projects.forEach((p) => {
      const m = p.meta || {};
      const sy = Number(String(m.year_start || p.start || "").slice(0, 4)) || 0;   // 해당 연도 기간(시작)
      const ey = Number(String(m.year_end || p.end || "").slice(0, 4)) || 0;       // 해당 연도 기간(종료)
      if (sy) { min = Math.min(min, sy); max = Math.max(max, sy); }
      if (ey) { min = Math.min(min, ey); max = Math.max(max, ey); }
    });
    if (min === Infinity || max === -Infinity) return [todayKST().slice(0, 4)];   // 과제 없으면 올해만
    const out: string[] = [];
    for (let y = max; y >= min; y--) out.push(String(y));
    return out;
  })();
  const yearProjects = projects.filter((p) => projInYear(p, formYear));
  // 선택된 과제가 연도 목록에 없으면(수정 등) 함께 노출해 선택 유지.
  const formProjects = (form.project_id && !yearProjects.some((p) => p.id === form.project_id) && projects.find((p) => p.id === form.project_id))
    ? [projects.find((p) => p.id === form.project_id)!, ...yearProjects] : yearProjects;
  // '전체 과제' 필터: 연도별 그룹(최근 먼저), 연도는 해당 연도 기간→총 기간→코드 순 추출
  const projYear = (p: Proj) => {
    const m = p.meta || {};
    const y = String(m.year_start || m.year_end || p.start || p.end || "").slice(0, 4);
    if (y) return y;
    const mt = String(p.code || "").match(/(20\d{2})/);
    return mt ? mt[1] : "미상";
  };
  const byYear: Record<string, Proj[]> = {};
  projects.forEach((p) => { (byYear[projYear(p)] ||= []).push(p); });
  Object.values(byYear).forEach((arr) => arr.sort((a, b) => (b.code || "").localeCompare(a.code || "")));
  const yearsSorted = Object.keys(byYear).sort((a, b) => (a === "미상" ? 1 : b === "미상" ? -1 : b.localeCompare(a)));
  // 상태 필터는 집행 내역이 속한 과제 기준
  const statusOf = (pid: string) => grantAutoStatus(projects.find((p) => p.id === pid));
  const q = query.trim().toLowerCase();
  const matchQ = (x: Exp) => !q || [code(x.project_id), x.category, x.subcategory, x.title, uname(x.by_id), x.claim_date, String(x.amount)].some((v) => (v || "").toLowerCase().includes(q));
  const base = items.filter((x) => (!filterPid || x.project_id === filterPid) && matchQ(x));
  const shown = base.filter((x) => statusFilter === "전체" || statusOf(x.project_id) === statusFilter);
  const statusCount = (t: string) => t === "전체" ? base.length : base.filter((x) => statusOf(x.project_id) === t).length;
  const total = shown.reduce((a, x) => a + x.amount, 0);

  return (
    <div data-testid="page-expenses">
      <div className="page-head">
        <div><div className="crumb">연구비 › 연구비집행</div><h1>연구비집행</h1></div>
        <button className="btn primary" data-testid="exp-add-open" onClick={openForm}>+ 집행 등록</button>
      </div>
      {err && <div className="form-err" data-testid="exp-error">{err}</div>}
      {adding && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); save(); }} data-testid="exp-form">
          <div className="card-h"><b>{editId ? "집행 내역 수정" : "집행 내역 등록"}</b></div>
          <div className="bd grid" style={{ gridTemplateColumns: "repeat(6, 1fr)", gap: "0 14px" }}>
            <div style={{ gridColumn: "span 2" }}><label>연도</label><select data-testid="e-year" value={formYear} onChange={(e) => { const yr = e.target.value; setFormYear(yr); const yp = projects.filter((p) => projInYear(p, yr)); if (!yp.some((p) => p.id === form.project_id)) setForm((f) => ({ ...f, project_id: yp[0]?.id || "" })); }}>{yearOpts.map((y) => <option key={y} value={y}>{y}년</option>)}</select></div>
            <div style={{ gridColumn: "span 2" }}><label>과제 <span className="muted small">({formYear}년)</span></label><select data-testid="e-project" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>{formProjects.length ? formProjects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>) : <option value="">해당 연도 과제 없음</option>}</select></div>
            <div style={{ gridColumn: "span 2" }}><label>집행일자</label><input data-testid="e-date" type="date" value={form.claim_date} onChange={(e) => setForm({ ...form, claim_date: e.target.value })} /></div>
            <div style={{ gridColumn: "span 3" }}><label>비목</label><select data-testid="e-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value, subcategory: "" })}>{STD.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div style={{ gridColumn: "span 3" }}><label>세목(선택)</label>{subsOf(form.category).length ? (
              <select data-testid="e-subcategory" value={form.subcategory} onChange={(e) => setForm({ ...form, subcategory: e.target.value })}>
                <option value="">선택…</option>{subsOf(form.category).map((s) => <option key={s}>{s}</option>)}
              </select>
            ) : (
              <input data-testid="e-subcategory" value="" disabled placeholder="세목 없음" style={{ background: "var(--soft)", cursor: "not-allowed" }} />
            )}</div>
            <div style={{ gridColumn: "span 4" }}><label>집행 내용</label><input data-testid="e-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="예: 클라우드 사용료" /></div>
            <div style={{ gridColumn: "span 2" }}><label>금액(원)</label><input data-testid="e-amount" inputMode="numeric" value={form.amount ? form.amount.toLocaleString() : ""} onChange={(e) => setForm({ ...form, amount: Number(e.target.value.replace(/[^0-9]/g, "")) })} placeholder="0" /></div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label>증빙 첨부</label>
              <input type="file" multiple data-testid="e-files" onChange={uploadFiles} />
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
          <div className="bd" style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="btn primary" data-testid="exp-save">{editId ? "저장" : "등록"}</button>
            <button type="button" className="btn ghost" onClick={closeForm}>취소</button>
          </div>
        </form>
      )}

      <div className="card scroll">
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <span style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <b>집행 내역</b>
            <Chips testid="exp-status-filter" value={statusFilter} onChange={setStatusFilter}
              items={FILTERS.map((t) => ({ key: t, count: statusCount(t) }))} />
          </span>
          <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input data-testid="exp-search" placeholder="내용·과제·비목·등록자 검색" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 200, margin: 0 }} />
            <select data-testid="exp-filter" value={filterPid} onChange={(e) => setFilterPid(e.target.value)} style={{ width: "auto", margin: 0 }}>
              <option value="">전체 과제</option>
              {yearsSorted.map((y) => <optgroup key={y} label={y === "미상" ? "연도 미상" : `${y}년`}>{byYear[y].map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</optgroup>)}
            </select>
            <span className="pill">합계 {total.toLocaleString()}원</span>
          </span>
        </div>
        <table className="tbl" data-testid="exp-table">
          <thead><tr><th>집행일자</th><th>과제</th><th>비목/세목</th><th>집행 내용</th>{isAdmin && <th>등록자</th>}<th>금액</th><th>증빙</th><th>처리</th></tr></thead>
          <tbody>
            {shown.map((x) => (
              <tr key={x.id}>
                <td className="small muted">{x.claim_date || "—"}</td>
                <td>{code(x.project_id)}</td>
                <td>{x.category}{x.subcategory ? <span className="muted small"> · {x.subcategory}</span> : ""}</td>
                <td className="ell" title={x.title}>{x.title}</td>
                {isAdmin && <td className="muted">{uname(x.by_id)}</td>}
                <td>{x.amount.toLocaleString()}원</td>
                <td className="small">{x.files?.length ? x.files.map((f, i) => <a key={i} href={f.url} target="_blank" rel="noreferrer" title={f.name} style={{ marginRight: 6 }}>📎{x.files!.length > 1 ? i + 1 : ""}</a>) : <span className="muted">—</span>}</td>
                <td>
                  {(x.by_id === me?.id || isAdmin) && <button className="btn ghost sm" data-testid={`e-edit-${x.id}`} onClick={() => editExpense(x)}>수정</button>}{" "}
                  {(x.by_id === me?.id || isAdmin) && <button className="btn ghost sm" data-testid={`e-del-${x.id}`} style={{ color: "var(--bad)" }} onClick={() => del(x)}>삭제</button>}
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={isAdmin ? 8 : 7} className="muted" style={{ textAlign: "center", padding: 14 }}>집행 내역 없음</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
