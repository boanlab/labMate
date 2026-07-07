import { useEffect, useState } from "react";
import { todayKST } from "../lib/date";
import { api, apiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PageHeader, Card, Chips, won, statusClass, Req } from "../ui/kit";
import { useConfig, names } from "../api/config";


interface Budget { id: string; project_id: string; category: string; allocated: number; spent: number; }
interface Project { id: string; code: string; name: string; agency: string; category: string; status: string; start: string | null; end: string | null; meta?: Record<string, any>; }
const STD_FB = ["인건비", "학생인건비", "장비비", "재료비", "연구활동비", "연구수당", "간접비"];
const FILTERS = ["진행 중", "예정", "완료", "전체"];
function autoStatus(start: string | null, end: string | null): string {
  const today = todayKST();
  if (start && today < start) return "예정";
  if (end && today > end) return "완료";
  return "진행 중";
}
// 연구과제 상태는 해당 연도 기간 기준(미입력 시 총 과제기간)
function grantAutoStatus(p: Project): string {
  const m = p.meta || {};
  if (m.year_start || m.year_end) return autoStatus(m.year_start || "", m.year_end || "");
  return autoStatus(p.start, p.end);
}

export default function BudgetPage() {
  const { me } = useAuth();
  const isAdmin = !!me && (["prof", "staff"].includes(me.role) || !!me.delegated_admin);
  const STD = names(useConfig<any[]>("budget_types", STD_FB.map((n) => ({ name: n, subs: [] }))));
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sel, setSel] = useState("");
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(false);
  const [allocated, setAlloc] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [filter, setFilter] = useState("진행 중");

  async function load() {
    try {
      let bg = (await api.get<Budget[]>("/funds/budgets")).data;
      const pr = (await api.get<Project[]>("/projects/projects?kind=grant")).data.filter((p) => p.category !== "세미나");
      setProjects(pr);
      // 표준 비목 누락 과제는 자동 생성(관리자)
      if (isAdmin) {
        const need = pr.filter((p) => { const cats = new Set(bg.filter((b) => b.project_id === p.id).map((b) => b.category)); return STD.some((c) => !cats.has(c)); });
        if (need.length) { for (const p of need) await api.post(`/funds/budgets/ensure/${p.id}`); bg = (await api.get<Budget[]>("/funds/budgets")).data; }
      }
      setBudgets(bg);
      setSel((s) => s || pr.filter((p) => grantAutoStatus(p) === "진행 중")[0]?.id || pr[0]?.id || "");
    } catch (e) { setErr(apiError(e)); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const stat = (p: Project) => grantAutoStatus(p);
  const visProjects = projects.filter((p) => filter === "전체" || stat(p) === filter);
  const proj = projects.find((p) => p.id === sel);
  const rowsOf = (pid: string) => budgets.filter((b) => b.project_id === pid);
  // 간접비는 편성액 전액을 집행으로 간주
  const spentOf = (b: { category: string; allocated: number; spent: number }) => (b.category === "간접비" ? b.allocated : b.spent);
  const totOf = (pid: string) => rowsOf(pid).reduce((a, b) => ({ allocated: a.allocated + b.allocated, spent: a.spent + spentOf(b) }), { allocated: 0, spent: 0 });
  const pctOf = (a: number, s: number) => (a ? Math.round((s / a) * 100) : 0);
  const allocOf = (pid: string, category: string) => rowsOf(pid).find((b) => b.category === category) || { id: "", allocated: 0, spent: 0 };

  function startEdit() {
    const m: Record<string, number> = {}; STD.forEach((c) => { m[c] = allocOf(sel, c).allocated; });
    setAlloc(m); setReason(""); setEditing(true); setErr("");
  }
  async function saveEdit() {
    setErr("");
    const changed = STD.filter((c) => allocOf(sel, c).allocated !== allocated[c]);
    if (!changed.length) { setEditing(false); return; }
    if (!reason.trim()) { setErr("편성액 변경 시 사유를 입력하세요"); return; }
    try {
      for (const c of changed) {
        const b = allocOf(sel, c) as Budget;
        await api.patch(`/funds/budgets/${b.id}`, { project_id: sel, category: c, allocated: allocated[c], spent: b.spent, reason });
      }
      setEditing(false); load();
    } catch (e) { setErr(apiError(e)); }
  }

  return (
    <div data-testid="page-budget">
      <PageHeader crumb="연구비 › 예산" title="예산" action={!isAdmin ? <span className="muted small">조회 전용</span> : undefined} />
      {err && <div className="form-err" data-testid="budget-error">{err}</div>}

      <Card title="과제 예산 현황" extra={
        <Chips testid="bg-filter" value={filter}
          onChange={(t) => { setFilter(t); setEditing(false); const vis = projects.filter((p) => t === "전체" || stat(p) === t); if (!vis.some((p) => p.id === sel)) setSel(vis[0]?.id || ""); }}
          items={FILTERS.map((t) => ({ key: t, count: t === "전체" ? projects.length : projects.filter((p) => stat(p) === t).length }))} />
      } testid="budget-summary">
        <table className="tbl">
          <thead><tr><th style={{ width: 130 }}>관리코드</th><th>과제명</th><th>상태</th><th>총 편성</th><th>총 집행</th><th>잔액</th><th>집행률</th></tr></thead>
          <tbody>
            {visProjects.map((p) => { const t = totOf(p.id); const r = pctOf(t.allocated, t.spent); const st = stat(p); return (
              <tr key={p.id} data-testid={`bg-row-${p.code}`} onClick={() => { setSel(p.id); setEditing(false); }} style={{ cursor: "pointer", background: sel === p.id ? "var(--bsoft)" : undefined }}>
                <td><b>{p.code}</b></td><td className="muted" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }} title={p.name}>{p.name}</td>
                <td><span className={statusClass(st)}>{st}</span></td>
                <td>{won(t.allocated)}</td><td>{won(t.spent)}</td>
                <td style={{ color: t.allocated - t.spent < 0 ? "var(--bad)" : "inherit" }}>{won(t.allocated - t.spent)}</td>
                <td>{r}%</td>
              </tr>
            ); })}
            {!visProjects.length && <tr><td colSpan={7} className="muted">{filter} 과제 없음</td></tr>}
          </tbody>
        </table>
      </Card>

      {proj && (
        <Card testid="budget-detail" title={<>{proj.code} <span className="muted small">{proj.name}</span></>} extra={
          isAdmin && (editing
            ? <span style={{ display: "flex", gap: 6 }}><button className="btn primary sm" data-testid="bg-save" onClick={saveEdit}>저장</button><button className="btn ghost sm" onClick={() => setEditing(false)}>취소</button></span>
            : <button className="btn primary sm" data-testid="bg-edit" onClick={startEdit}>예산 편성</button>)
        }>
          <table className="tbl" data-testid="bg-detail-table">
            <thead><tr><th>비목</th><th style={{ width: 180 }}>편성</th><th>집행</th><th>잔액</th><th style={{ width: 120 }}>집행률</th></tr></thead>
            <tbody>
              {STD.map((c) => {
                const b = allocOf(sel, c); const a = editing ? (allocated[c] || 0) : b.allocated; const sp = c === "간접비" ? a : b.spent; const r = pctOf(a, sp);
                return (
                  <tr key={c}>
                    <td><b>{c}</b>{c === "간접비" && <span className="muted small"> (집행 간주)</span>}</td>
                    <td>{editing
                      ? <input data-testid={`bg-allocated-${c}`} inputMode="numeric" value={allocated[c] ? allocated[c].toLocaleString() : ""} onChange={(e) => setAlloc({ ...allocated, [c]: Number(e.target.value.replace(/[^0-9]/g, "")) })} placeholder="0" style={{ margin: 0, width: 150 }} />
                      : won(a)}</td>
                    <td>{won(sp)}</td>
                    <td style={{ color: a - sp < 0 ? "var(--bad)" : "inherit" }}>{won(a - sp)}</td>
                    <td><div className="bar" style={{ width: 70, display: "inline-block", verticalAlign: "middle" }}><i style={{ width: `${Math.min(r, 100)}%`, background: r > 90 ? "var(--bad)" : "var(--brand)" }} /></div> {r}%</td>
                  </tr>
                );
              })}
              {(() => {
                const ta = STD.reduce((a, c) => a + (editing ? (allocated[c] || 0) : allocOf(sel, c).allocated), 0);
                const ts = STD.reduce((a, c) => a + (c === "간접비" ? (editing ? (allocated[c] || 0) : allocOf(sel, c).allocated) : allocOf(sel, c).spent), 0);
                return <tr style={{ fontWeight: 700, background: "var(--soft)" }}><td>합계</td><td>{won(ta)}</td><td>{won(ts)}</td><td>{won(ta - ts)}</td><td>{pctOf(ta, ts)}%</td></tr>;
              })()}
            </tbody>
          </table>
          {editing && (
            <div className="bd" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label style={{ margin: 0 }}>변경 사유<Req/></label>
              <input data-testid="bg-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 1차년도 예산 편성" style={{ margin: 0, flex: 1 }} />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
