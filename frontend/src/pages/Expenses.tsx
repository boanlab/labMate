import { useEffect, useState, useId } from "react";
import { useNavigate } from "react-router-dom";
import { todayKST } from "../lib/date";
import { api, apiError } from "../api/client";
import { confirmDialog } from "../ui/dialog";
import { useAuth } from "../auth/AuthContext";
import { useConfig, names } from "../api/config";
import { Chips, formSnapshot, confirmDiscard, wonKo, won } from "../ui/kit";


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
  const nav = useNavigate();
  const uid = useId();   // 라벨-입력 연결용 고유 접두사
  const { me } = useAuth();
  const isAdmin = !!me && (["prof", "staff"].includes(me.role) || !!me.delegated_admin);
  const BCATS = useConfig<any[]>("budget_types", CATS_FB);
  const STD = names(BCATS);
  const subsOf = (category: string): string[] => (BCATS.find((c: any) => (c.name || c) === category)?.subs) || [];
  const [items, setItems] = useState<Exp[]>([]);
  const [projects, setProjects] = useState<Proj[]>([]);
  const [budgets, setBudgets] = useState<{ project_id: string; category: string; allocated: number; spent: number }[]>([]);
  // 집행이 결재를 거치는지(환경설정 › 마스터데이터). 끄면 예전처럼 등록 즉시 확정된다.
  const approvalOn = useConfig<boolean>("expense_approval", true);
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
  const [snap, setSnap] = useState("");   // 폼 초기 상태 — 작성 중 이탈 경고 판정용

  async function uploadFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const fl = e.target.files; if (!fl || !fl.length) return;
    const fd = new FormData(); Array.from(fl).forEach((f) => fd.append("files", f));
    try { const r = await api.post<TFile[]>("/projects/uploads", fd, { headers: { "Content-Type": "multipart/form-data" } }); setForm((f) => ({ ...f, files: [...f.files, ...r.data] })); }
    catch (err) { setErr(apiError(err)); }
    e.target.value = "";
  }

  // 지금 고른 과제·비목의 잔액 — 초과 집행을 등록 전에 알아챌 수 있게 한다
  const curBudget = budgets.find((b) => b.project_id === form.project_id && b.category === form.category);
  const remain = curBudget ? curBudget.allocated - curBudget.spent : null;
  const afterRemain = remain === null ? null : remain - (form.amount || 0);

  const [loaded, setLoaded] = useState(false);   // 첫 조회 완료 여부 — "없음"과 "불러오는 중"을 구분
  // 상신: 집행 건을 '상신'으로 올리고, 같은 내용으로 결재 문서를 만든다.
  // 결재가 승인되면 Approvals 화면이 source_ref 를 보고 이 건을 승인 처리한다.
  async function submitExpense(x: Exp) {
    if (!x.files?.length && x.amount > 0) { setErr("증빙 파일을 첨부해야 상신할 수 있습니다 — [수정]에서 첨부하세요"); return; }
    const approver = users.find((u) => u.role === "prof" && u.id !== me?.id)
      || users.find((u) => ["staff", "admin"].includes(u.role) && u.id !== me?.id);
    if (!approver) { setErr("결재할 사람을 찾지 못했습니다 — 지도교수·행정 계정이 필요합니다"); return; }
    setErr("");
    try {
      await api.post(`/funds/expenses/${x.id}/submit`);
      await api.post("/boards/approvals", {
        type: "구매",
        title: `연구비 집행 · ${x.title} (${x.amount.toLocaleString()}원)`,
        content: `<p>과제 ${code(x.project_id)} · ${x.category}${x.subcategory ? " · " + x.subcategory : ""}</p><p>집행일자 ${x.claim_date || "-"}</p>`,
        project_id: x.project_id,
        approver_ids: [approver.id],
        source_ref: `expense:${x.id}`,
      });
      load();
    } catch (e) { setErr(apiError(e)); }
  }

  async function load() {
    try {
      setItems((await api.get<Exp[]>("/funds/expenses")).data);
      const pr = (await api.get<Proj[]>("/projects/projects?kind=grant")).data;
      setProjects(pr);
      if (pr.length && !form.project_id) setForm((f) => ({ ...f, project_id: pr[0].id }));
      setUsers((await api.get<any[]>("/members/users")).data);
      // 집행 등록 시 '이 비목에 얼마 남았는지'를 그 자리에서 보여주기 위해 예산도 함께 받는다
      api.get<{ project_id: string; category: string; allocated: number; spent: number }[]>("/funds/budgets")
        .then((r) => setBudgets(r.data)).catch(() => {});
    } catch (e) { setErr(apiError(e)); } finally { setLoaded(true); }
  }
  useEffect(() => { load(); }, []);

  const EXP_BADGE: Record<string, string> = { "작성중": "s-mute", "상신": "s-wait", "승인": "s-ok", "지급": "s-ok", "반려": "s-bad", "집행": "s-info" };
const EMPTY = { project_id: projects[0]?.id || "", category: "인건비", subcategory: "", title: "", claim_date: today, amount: 0, files: [] as TFile[] };
  function openForm() {
    setEditId("");
    const yr = today.slice(0, 4); setFormYear(yr);                               // 등록 시작: 현 시점 연도
    const yp = projects.filter((p) => projInYear(p, yr));
    const f = { ...EMPTY, project_id: yp[0]?.id || projects[0]?.id || "" };
    setForm(f); setAdding(true); setSnap(formSnapshot(f));
  }
  // 상단 토글 — 작성 중이면 확인 후 닫는다
  async function toggleForm() {
    if (!adding) return openForm();
    if (!(await confirmDiscard(formSnapshot(form) !== snap))) return;
    closeForm();
  }
  function editExpense(x: Exp) {
    setFormYear((x.claim_date || today).slice(0, 4));                            // 수정: 집행연도로 맞춰 과제 노출
    setForm({ project_id: x.project_id, category: x.category, subcategory: x.subcategory || "", title: x.title, claim_date: x.claim_date || today, amount: x.amount, files: x.files || [] });
    setEditId(x.id); setAdding(true);
    setSnap(formSnapshot({ project_id: x.project_id, category: x.category, subcategory: x.subcategory || "", title: x.title, claim_date: x.claim_date || today, amount: x.amount, files: x.files || [] }));
  }
  function closeForm() { setAdding(false); setEditId(""); setForm({ ...EMPTY, project_id: form.project_id || projects[0]?.id || "" }); setSnap(""); }
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
  const shown = base.filter((x) => statusFilter === "전체" || statusOf(x.project_id) === statusFilter)
    .sort((a, b) => (b.claim_date || "").localeCompare(a.claim_date || ""));   // 집행일자 최신순
  const statusCount = (t: string) => t === "전체" ? base.length : base.filter((x) => statusOf(x.project_id) === t).length;
  const total = shown.reduce((a, x) => a + x.amount, 0);

  return (
    <div data-testid="page-expenses">
      <div className="page-head">
        <div><div className="crumb">연구비 › 연구비집행</div><h1>연구비집행</h1></div>
        <button className={"btn " + (adding ? "ghost" : "primary")} data-testid="exp-add-open" onClick={toggleForm}>{adding ? "닫기" : "+ 집행 등록"}</button>
      </div>
      {err && <div className="form-err" data-testid="exp-error">{err}</div>}
      {adding && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); save(); }} data-testid="exp-form">
          <div className="card-h"><b>{editId ? "집행 내역 수정" : "집행 내역 등록"}</b></div>
          <div className="bd grid" style={{ gridTemplateColumns: "repeat(6, 1fr)", gap: "0 14px" }}>
            <div style={{ gridColumn: "span 2" }}><label htmlFor={`${uid}-1`}>연도</label><select id={`${uid}-1`} data-testid="e-year" value={formYear} onChange={(e) => { const yr = e.target.value; setFormYear(yr); const yp = projects.filter((p) => projInYear(p, yr)); if (!yp.some((p) => p.id === form.project_id)) setForm((f) => ({ ...f, project_id: yp[0]?.id || "" })); }}>{yearOpts.map((y) => <option key={y} value={y}>{y}년</option>)}</select></div>
            <div style={{ gridColumn: "span 2" }}><label htmlFor={`${uid}-2`}>과제 <span className="muted small">({formYear}년)</span></label><select id={`${uid}-2`} data-testid="e-project" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>{formProjects.length ? formProjects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>) : <option value="">해당 연도 과제 없음</option>}</select></div>
            <div style={{ gridColumn: "span 2" }}><label htmlFor={`${uid}-3`}>집행일자</label><input id={`${uid}-3`} data-testid="e-date" type="date" value={form.claim_date} onChange={(e) => setForm({ ...form, claim_date: e.target.value })} /></div>
            <div style={{ gridColumn: "span 3" }}>
              <label htmlFor={`${uid}-4`}>비목</label>
              <select id={`${uid}-4`} data-testid="e-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value, subcategory: "" })}>{STD.map((c) => <option key={c}>{c}</option>)}</select>
              <div className="small" data-testid="e-remain">
                {remain === null
                  ? <span className="muted">이 비목의 예산이 아직 편성되지 않았습니다</span>
                  : <>
                      <span className="muted">편성 {won(curBudget!.allocated)} · 집행 {won(curBudget!.spent)} · </span>
                      <b style={{ color: remain <= 0 ? "var(--bad-text)" : "inherit" }}>잔액 {won(remain)}</b>
                      {!!form.amount && (afterRemain! < 0
                        ? <span className="badge s-bad" style={{ marginLeft: 6 }}>이 건을 넣으면 {won(-afterRemain!)} 초과</span>
                        : <span className="badge s-ok" style={{ marginLeft: 6 }}>등록 후 잔액 {won(afterRemain!)}</span>)}
                    </>}
              </div>
            </div>
            <div style={{ gridColumn: "span 3" }}><label>세목(선택)</label>{subsOf(form.category).length ? (
              <select data-testid="e-subcategory" aria-label="세목" value={form.subcategory} onChange={(e) => setForm({ ...form, subcategory: e.target.value })}>
                <option value="">선택…</option>{subsOf(form.category).map((s) => <option key={s}>{s}</option>)}
              </select>
            ) : (
              <input data-testid="e-subcategory" aria-label="세목" value="" disabled placeholder="세목 없음" style={{ background: "var(--soft)", cursor: "not-allowed" }} />
            )}</div>
            <div style={{ gridColumn: "span 4" }}><label htmlFor={`${uid}-5`}>집행 내용</label><input id={`${uid}-5`} data-testid="e-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="예: 클라우드 사용료" /></div>
            <div style={{ gridColumn: "span 2" }}>
              <label htmlFor={`${uid}-6`}>금액(원)</label>
              <input id={`${uid}-6`} data-testid="e-amount" inputMode="numeric" value={form.amount ? form.amount.toLocaleString() : ""} onChange={(e) => setForm({ ...form, amount: Number(e.target.value.replace(/[^0-9]/g, "")) })} placeholder="0" />
              <div className="muted small" data-testid="e-amount-ko">{wonKo(form.amount) || "\u00a0"}</div>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label htmlFor={`${uid}-7`}>증빙 첨부</label>
              <input id={`${uid}-7`} type="file" multiple data-testid="e-files" onChange={uploadFiles} />
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
            <button type="button" className="btn ghost" onClick={toggleForm}>취소</button>
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
            <input data-testid="exp-search" aria-label="집행 내역 검색" placeholder="내용·과제·비목·등록자 검색" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 200, margin: 0 }} />
            <select data-testid="exp-filter" aria-label="진행 상태 필터" value={filterPid} onChange={(e) => setFilterPid(e.target.value)} style={{ width: "auto", margin: 0 }}>
              <option value="">전체 과제</option>
              {yearsSorted.map((y) => <optgroup key={y} label={y === "미상" ? "연도 미상" : `${y}년`}>{byYear[y].map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</optgroup>)}
            </select>
            <span className="pill">합계 {total.toLocaleString()}원</span>
          </span>
        </div>
        <table className="tbl fit" data-testid="exp-table">
          <thead><tr><th style={{ width: 104 }}>집행일자</th><th className="hide-sm" style={{ width: 100 }}>과제</th><th className="hide-sm" style={{ width: 130 }}>비목/세목</th><th>집행 내용</th>{isAdmin && <th className="hide-sm" style={{ width: 90 }}>등록자</th>}<th style={{ width: 104 }}>금액</th><th className="hide-sm" style={{ width: 64 }}>증빙</th>{approvalOn && <th style={{ width: 78 }}>상태</th>}<th style={{ width: 168 }}>처리</th></tr></thead>
          <tbody>
            {shown.map((x) => (
              <tr key={x.id}>
                <td className="small muted">{x.claim_date || "—"}</td>
                <td className="hide-sm">{code(x.project_id)}</td>
                <td className="hide-sm">{x.category}{x.subcategory ? <span className="muted small"> · {x.subcategory}</span> : ""}</td>
                <td className="ell" title={x.title}>{x.title}</td>
                {isAdmin && <td className="muted hide-sm">{uname(x.by_id)}</td>}
                <td>{x.amount.toLocaleString()}원</td>
                <td className="small hide-sm">{x.files?.length ? x.files.map((f, i) => <a key={i} href={f.url} target="_blank" rel="noreferrer" title={f.name} style={{ marginRight: 6 }}>📎{x.files!.length > 1 ? i + 1 : ""}</a>) : <span className="muted">—</span>}</td>
                {approvalOn && <td><span className={"badge " + (EXP_BADGE[x.status] || "s-mute")} data-testid={`e-status-${x.id}`}>{x.status}</span></td>}
                <td style={{ whiteSpace: "nowrap" }}>
                  {approvalOn && x.by_id === me?.id && ["작성중", "반려"].includes(x.status)
                    && <><button className="btn primary sm" data-testid={`e-submit-${x.id}`} onClick={() => submitExpense(x)}>상신</button>{" "}</>}
                  {(x.by_id === me?.id || isAdmin) && <button className="btn ghost sm" data-testid={`e-edit-${x.id}`} onClick={() => editExpense(x)}>수정</button>}{" "}
                  {(x.by_id === me?.id || isAdmin) && <button className="btn ghost sm" data-testid={`e-del-${x.id}`} style={{ color: "var(--bad-text)" }} onClick={() => del(x)}>삭제</button>}
                </td>
              </tr>
            ))}
            {!shown.length && (
              <tr><td colSpan={isAdmin ? 8 : 7} className="muted" style={{ textAlign: "center", padding: 20 }}>
                {projects.length === 0
                  ? <>집행은 연구과제 예산에서 나갑니다. <a className="lnk" style={{ cursor: "pointer" }} data-testid="exp-goto-grants" onClick={() => nav("/grants")}>연구과제</a>를 먼저 등록해 주세요.</>
                  : <>아직 등록된 집행 내역이 없습니다 — 위 <b>+ 집행 등록</b>으로 첫 건을 올려보세요.</>}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
