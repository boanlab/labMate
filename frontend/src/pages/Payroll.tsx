import { useEffect, useMemo, useState } from "react";
import { yearKST, todayKST } from "../lib/date";
import { api, apiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PageHeader, Card, won } from "../ui/kit";
import { useConfig } from "../api/config";


interface User { id: string; name: string; role: string; grade: string; join_date: string | null; exit_date: string | null; master_start?: string | null; phd_start?: string | null; active?: boolean; }
interface Project { id: string; code: string; name?: string; category: string; agency: string; start: string | null; end: string | null; meta?: Record<string, any>; }
interface Part { uid: string; project_id: string; rate_pct: number; month: string; }
interface Slip { id: string; uid: string; project_id: string; month: string; amount: number; status: string; }
interface Budget { project_id: string; category: string; allocated: number; spent: number; }

const GRADE_RATES_FB: Record<string, number> = { "박사과정": 2500000, "석사과정": 2200000, "학사과정": 1000000, "교수": 0 };
const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
const TABS = [{ k: "exec", t: "과제별 집행" }, { k: "pay", t: "학생별 지급" }, { k: "plan", t: "참여율 편성" }];

export default function Payroll() {
  const { me } = useAuth();
  const GRADE_RATES = useConfig<Record<string, number>>("grade_rates", GRADE_RATES_FB);
  const isAdmin = !!me && (["prof", "staff"].includes(me.role) || !!me.delegated_admin);
  const yearNow = yearKST();
  const [tab, setTab] = useState("exec");
  const [year, setYear] = useState(String(yearNow));
  const [pid, setPid] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [matrix, setMatrix] = useState<Record<string, Record<string, number>>>({});  // uid -> { 월: rate_pct } (선택 과제)
  const [slips, setSlips] = useState<Slip[]>([]);   // 연도 전체 명세
  const [detail, setDetail] = useState<string | null>(null);   // 학생별 지급 상세 대상 uid
  const [detailYear, setDetailYear] = useState("");            // 팝업 연도(페이지 연도와 독립)
  const [detailSlips, setDetailSlips] = useState<Slip[]>([]);  // 해당 학생·연도 명세
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  // 연도 목록 — 과제 해당 연도 기간의 최소~최대 연속 표시
  const years = (() => {
    let min = Infinity, max = -Infinity;
    projects.forEach((p) => {
      const m = p.meta || {};
      const sy = Number(String(m.year_start || p.start || "").slice(0, 4)) || 0;   // 해당 연도 기간(시작)
      const ey = Number(String(m.year_end || p.end || "").slice(0, 4)) || 0;       // 해당 연도 기간(종료)
      if (sy) { min = Math.min(min, sy); max = Math.max(max, sy); }
      if (ey) { min = Math.min(min, ey); max = Math.max(max, ey); }
    });
    if (min === Infinity || max === -Infinity) return [String(yearNow)];   // 과제 없으면 올해만
    const out: string[] = [];
    for (let y = max; y >= min; y--) out.push(String(y));
    return out;
  })();

  // 해당 연도 재직 학생만 — 연도 이후 입실·이전 퇴실·퇴실없는 비활성 제외
  const students = useMemo(() => {
    const inYear = (u: User) => {
      const jd = u.join_date || "", xd = u.exit_date || "";
      if (jd && jd.slice(0, 7) > `${year}-12`) return false;
      if (xd && xd.slice(0, 7) < `${year}-01`) return false;
      if (!xd && u.active === false) return false;
      return true;
    };
    return users.filter((u) => ["phd", "master", "under"].includes(u.role) && inYear(u));
  }, [users, year]);
  const grade = (u: User) => u.grade || (u.role === "phd" ? "박사과정" : u.role === "master" ? "석사과정" : "학사과정");
  // 특정 월의 학위 등급 — 입학일로 진급 반영
  const gradeAt = (u: User, ym: string) => {
    const ps = (u.phd_start || "").slice(0, 7), ms = (u.master_start || "").slice(0, 7);
    if (ps && ym >= ps) return "박사과정";
    if (ms && ym >= ms) return "석사과정";
    if (ps || ms) return "학사과정";   // 진급일 설정 학생: 입학 전은 학사
    return grade(u);                    // 진급일 미설정: 현재 등급
  };
  const rateAt = (u: User, mm: string) => GRADE_RATES[gradeAt(u, `${year}-${mm}`)] || 0;   // 월별 단가
  const codeOf = (id: string) => projects.find((p) => p.id === id)?.code || "—";
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name || id.slice(0, 6);
  // 재직 기간 밖 월은 잠금
  const active = (u: User, mm: string) => { const ym = `${year}-${mm}`; if (u.join_date && ym < u.join_date.slice(0, 7)) return false; if (u.exit_date && ym > u.exit_date.slice(0, 7)) return false; return true; };
  const stuBudget = (projId: string) => budgets.find((b) => b.project_id === projId && b.category === "학생인건비") || { allocated: 0, spent: 0 };
  // 기간 판정은 해당 연도 기간 기준(미입력 시 총 과제기간 폴백)
  const projPeriod = (p: Project): [string, string] => { const m = p.meta || {}; return (m.year_start || m.year_end) ? [m.year_start || "", m.year_end || ""] : [p.start || "", p.end || ""]; };
  // 과제 기간이 선택 연도를 포함하는지 / 특정 월이 과제 기간 내인지
  const projInYear = (p: Project) => { const [s, e] = projPeriod(p); return (!s || s.slice(0, 4) <= year) && (!e || e.slice(0, 4) >= year); };
  const monthInProj = (p: Project | undefined, mm: string) => { if (!p) return false; const [s, e] = projPeriod(p); return (!s || `${year}-${mm}` >= s.slice(0, 7)) && (!e || `${year}-${mm}` <= e.slice(0, 7)); };
  const yearProjects = projects.filter(projInYear);
  const curProj = projects.find((p) => p.id === pid);

  async function loadBase() {
    try {
      setUsers((await api.get<User[]>("/members/users")).data);
      setProjects((await api.get<Project[]>("/projects/projects?kind=grant")).data.filter((p) => p.category !== "세미나"));
      if (isAdmin) setBudgets((await api.get<Budget[]>("/funds/budgets")).data);   // 예산은 관리자만
    } catch (e) { setErr(apiError(e)); }
  }
  async function loadPlan() {
    if (!pid || !year) { setMatrix({}); return; }
    try {
      const ps = (await api.get<Part[]>(`/funds/participations/year?year=${year}&project_id=${pid}`)).data;
      const mx: Record<string, Record<string, number>> = {};
      ps.forEach((p) => { (mx[p.uid] = mx[p.uid] || {})[p.month.slice(5, 7)] = p.rate_pct; });
      setMatrix(mx);
    } catch (e) { setErr(apiError(e)); }
  }
  async function loadSlips() {
    try { setSlips((await api.get<Slip[]>(`/funds/payslips?year=${year}`)).data); } catch (e) { setErr(apiError(e)); }
  }
  useEffect(() => { loadBase(); }, []);
  useEffect(() => { if (isAdmin) loadPlan(); /* eslint-disable-next-line */ }, [pid, year, isAdmin]);
  useEffect(() => { loadSlips(); /* eslint-disable-next-line */ }, [year]);
  // 학생별 지급 팝업 — 선택 연도 해당 학생 명세 로딩
  useEffect(() => {
    if (!detail) { setDetailSlips([]); return; }
    const yr = detailYear || year;
    api.get<Slip[]>(`/funds/payslips?year=${yr}`).then((r) => setDetailSlips(r.data.filter((s) => s.uid === detail))).catch(() => {});
  }, [detail, detailYear]);   // eslint-disable-line
  useEffect(() => { const yp = projects.filter(projInYear); setPid((p) => (p && yp.some((x) => x.id === p)) ? p : (yp[0]?.id || "")); /* eslint-disable-next-line */ }, [projects, year]);

  function setCell(uid: string, mm: string, v: number) {
    setMatrix((m) => ({ ...m, [uid]: { ...(m[uid] || {}), [mm]: Math.max(0, Math.min(100, v || 0)) } }));
  }
  async function savePlan() {
    setErr(""); setMsg("");
    const rows = students.map((u) => ({ uid: u.id, grade: grade(u), monthly: matrix[u.id] || {}, grades: Object.fromEntries(MONTHS.map((mm) => [mm, gradeAt(u, `${year}-${mm}`)])) }));
    try {
      await api.post("/funds/payroll/year-matrix", { year, project_id: pid, rows, grade_rates: GRADE_RATES });
      setMsg(`${codeOf(pid)} ${year}년 참여율 저장됨`); loadPlan(); loadSlips();
    } catch (e) { setErr(apiError(e)); }
  }
  // 미확정 월 일괄 확정
  async function confirmAll() {
    setErr(""); setMsg("");
    const months = MONTHS.filter((mm) => monthPend(mm) > 0);
    if (!months.length) return;
    try {
      for (const mm of months) await api.post(`/funds/payroll/confirm?month=${year}-${mm}`);
      setMsg(`${year}년 ${months.length}개월 지급확정 완료`); loadSlips(); loadBase();
    } catch (e) { setErr(apiError(e)); }
  }

  // ===== 집계 =====
  const planAmt = (u: User, mm: string) => Math.round(rateAt(u, mm) * (Number(matrix[u.id]?.[mm]) || 0) / 100);
  const planAnnual = students.reduce((a, u) => a + MONTHS.reduce((s, mm) => s + planAmt(u, mm), 0), 0);   // 선택 과제 연 편성(예정)
  // 과제별 최신 1건 반영(예정 우선) — 중복 이중계산 방지
  const payAmt = (uid: string, mm: string) => {
    const rows = slips.filter((s) => s.uid === uid && s.month === `${year}-${mm}`);
    const byProj: Record<string, Slip> = {};
    rows.forEach((s) => { const c = byProj[s.project_id]; if (!c || (s.status === "예정" && c.status !== "예정")) byProj[s.project_id] = s; });
    return Object.values(byProj).reduce((a, s) => a + s.amount, 0);
  };
  const payMonthTotal = (mm: string) => students.reduce((a, u) => a + payAmt(u.id, mm), 0);
  const payAnnual = (uid: string) => MONTHS.reduce((a, mm) => a + payAmt(uid, mm), 0);
  const monthPend = (mm: string) => slips.filter((s) => s.month === `${year}-${mm}` && s.status === "예정").length;
  const pendTotal = slips.filter((s) => s.month.startsWith(`${year}-`) && s.status === "예정").length;   // 연간 미확정 총 건수
  const payStudents = students.filter((u) => MONTHS.some((mm) => payAmt(u.id, mm) > 0));
  const projPend = (projId: string) => slips.filter((s) => s.project_id === projId && s.status === "예정").reduce((a, s) => a + s.amount, 0);
  // 현재 월 다음달~연말 금액 — 지급확정이라도 미래분은 예정으로 처리
  const nowYM = todayKST().slice(0, 7);
  const projFutureAll = (projId: string) => slips.filter((s) => s.project_id === projId && s.month > nowYM).reduce((a, s) => a + s.amount, 0);
  const projFuturePaid = (projId: string) => slips.filter((s) => s.project_id === projId && s.status === "지급" && s.month > nowYM).reduce((a, s) => a + s.amount, 0);

  if (!isAdmin) {
    const my = slips.filter((s) => s.uid === me?.id);
    return (
      <div data-testid="page-payroll">
        <PageHeader crumb="연구비 › 학생인건비" title="학생인건비 (내 지급 내역)" action={<select value={year} onChange={(e) => setYear(e.target.value)} style={{ width: "auto", fontWeight: 700 }}>{years.map((y) => <option key={y}>{y}</option>)}</select>} />
        <Card title={`${year}년 월별 지급`}>
          <table className="tbl"><thead><tr><th>과제</th>{MONTHS.map((m) => <th key={m} style={{ textAlign: "center" }}>{Number(m)}월</th>)}</tr></thead>
            <tbody>
              {Array.from(new Set(my.map((s) => s.project_id))).map((projId) => (
                <tr key={projId}><td><b>{codeOf(projId)}</b></td>{MONTHS.map((m) => { const s = my.find((x) => x.project_id === projId && x.month === `${year}-${m}`); return <td key={m} style={{ textAlign: "center" }} className={s ? "" : "muted"}>{s ? <>{won(s.amount)}<div className="muted small">{s.status}</div></> : "—"}</td>; })}</tr>
              ))}
              {!my.length && <tr><td colSpan={13} className="muted">지급 내역 없음</td></tr>}
            </tbody></table>
        </Card>
      </div>
    );
  }

  // 통합학생인건비: payroll_pool 그룹 예산 합산(풀 한도)
  const curPool = String(curProj?.meta?.payroll_pool || "").trim();
  const poolProjects = curPool ? projects.filter((p) => String(p.meta?.payroll_pool || "").trim() === curPool) : (curProj ? [curProj] : []);
  const sb = poolProjects.reduce((a, p) => { const b = stuBudget(p.id); return { allocated: a.allocated + b.allocated, spent: a.spent + b.spent }; }, { allocated: 0, spent: 0 });
  // 균등(YYYY)은 통합학생인건비 재원으로 운영 → 편성은 그대로, 균등 예산을 확정 집행으로 처리(선택 연도까지 시작분)
  const isEqualGrant = (p: Project) => /균등\s*\(\d{4}\)/.test(p.code || "");
  const grantYear = (p: Project) => (projPeriod(p)[0]?.slice(0, 4)) || (p.code.match(/\((\d{4})\)/)?.[1]) || "0";
  const equalSpentAll = projects.filter((p) => isEqualGrant(p) && grantYear(p) <= year).reduce((a, p) => a + stuBudget(p.id).allocated, 0);
  const equalSpent = curPool ? equalSpentAll : 0;
  // 같은 풀 타 과제 사용액(확정+예정) — 이 과제 몫은 현재 편성으로 대체
  const otherUsed = poolProjects.reduce((a, p) => a + (p.id === pid ? 0 : stuBudget(p.id).spent + projPend(p.id)), 0);
  const remainForThis = sb.allocated - otherUsed - equalSpent - planAnnual;   // 잔여 = 재원 − 타 과제 사용 − 균등 확정집행 − 이 과제 현재 편성
  return (
    <div data-testid="page-payroll">
      <PageHeader crumb="연구비 › 학생인건비" title="학생인건비 관리" />
      {err && <div className="form-err" data-testid="pay-error">{err}</div>}
      {msg && <div className="io" data-testid="pay-msg">{msg}</div>}

      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span className="fchips" data-testid="pay-tabs" style={{ marginBottom: 0 }}>
            {TABS.map((x) => <button key={x.k} className={"chip" + (tab === x.k ? " on" : "")} data-testid={`pay-tab-${x.k}`} onClick={() => setTab(x.k)}>{x.t}</button>)}
          </span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ margin: 0 }}>연도</label>
            <select value={year} data-testid="pay-year" onChange={(e) => setYear(e.target.value)} style={{ width: "auto", fontWeight: 700 }}>{years.map((y) => <option key={y}>{y}</option>)}</select>
            {tab === "plan" && <><label style={{ margin: 0, marginLeft: 6 }}>과제</label>
              <select value={pid} data-testid="pay-project" onChange={(e) => setPid(e.target.value)} style={{ width: "auto", fontWeight: 700 }}>{yearProjects.map((p) => { const pool = String(p.meta?.payroll_pool || "").trim(); return <option key={p.id} value={p.id}>{p.code}{pool ? ` · ${pool}` : ""}</option>; })}{!yearProjects.length && <option value="">{year}년 과제 없음</option>}</select></>}
          </span>
        </div>
      </Card>

      {/* ===== 탭1: 참여율 편성 ===== */}
      {tab === "plan" && (
        <Card title={`${year}년 참여율 편성 — ${codeOf(pid)}`} extra={<span className="pill">재직기간 밖 월은 잠금</span>}>
          <div data-testid="pay-budbar" style={{ display: "flex", gap: 18, flexWrap: "wrap", padding: "2px 2px 12px", fontSize: 13 }}>
            {curPool && <span className="badge s-pur" title={`통합 그룹 '${curPool}' · ${poolProjects.length}개 과제 합산`}>통합 {curPool} · {poolProjects.length}개</span>}
            <span>{curPool ? "통합 학생인건비 예산" : "학생인건비 예산"} <b>{won(sb.allocated)}</b></span>
            {curPool && equalSpent > 0 && <span className="muted" title="균등(YYYY)은 통합 재원으로 운영 → 확정 집행으로 처리">균등 확정집행 <b>{won(equalSpent)}</b></span>}
            {curPool && <span className="muted">타 과제 사용(확정+예정) <b>{won(otherUsed)}</b></span>}
            <span style={{ marginLeft: "auto" }}>이 과제 {year}년 편성(예정) <b style={{ color: remainForThis < 0 ? "var(--bad)" : "var(--brand)" }}>{won(planAnnual)}</b></span>
            <span>잔여 <b style={{ color: remainForThis < 0 ? "var(--bad)" : "var(--ok)" }}>{won(remainForThis)}</b>{remainForThis < 0 && <span className="badge s-bad" style={{ marginLeft: 6 }}>{curPool ? "통합 잔여 초과" : "잔여 예산 초과"}</span>}</span>
          </div>
          <div className="card scroll" style={{ margin: 0, border: "none" }}>
            <table className="tbl" data-testid="pay-matrix">
              <thead><tr><th>구성원</th>{MONTHS.map((m) => <th key={m} style={{ textAlign: "center" }}>{Number(m)}월</th>)}<th>연 인건비</th></tr></thead>
              <tbody>
                {students.map((u) => (
                  <tr key={u.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{u.name} <span className="pill">{grade(u)}</span></td>
                    {MONTHS.map((mm) => {
                      const outProj = !monthInProj(curProj, mm);
                      const lock = !active(u, mm) || outProj;
                      return (
                        <td key={mm} style={{ textAlign: "center", padding: "4px 3px", background: lock ? "var(--soft)" : undefined }}>
                          {lock ? <span className="muted small" title={outProj ? "과제 기간 외" : "재직기간 외"}>–</span> : (() => {
                            const pct = matrix[u.id]?.[mm];
                            const unit = rateAt(u, mm);   // 그 달의 등급 단가
                            const amt = pct != null ? Math.round(unit * Number(pct) / 100) : "";
                            return (
                              <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
                                <input type="number" min={0} max={100} step="any" title="참여율(%) — 입력 시 월인건비 자동 산정" placeholder="%"
                                  style={{ width: 82, textAlign: "center", margin: 0, padding: "4px 2px", boxSizing: "border-box" }}
                                  data-testid={`pm-${u.id}-${mm}`} value={pct != null ? Math.round(Number(pct) * 100) / 100 : ""}
                                  onChange={(e) => setCell(u.id, mm, Number(e.target.value))} />
                                <input type="number" min={0} step={1000} title="월인건비(원) — 입력 시 참여율 자동 산정" placeholder="원" disabled={!unit}
                                  style={{ width: 82, textAlign: "center", margin: 0, padding: "4px 2px", fontSize: 11, color: "var(--sub)", boxSizing: "border-box" }}
                                  data-testid={`pa-${u.id}-${mm}`} value={amt}
                                  onChange={(e) => { const a = Number(e.target.value.replace(/[^0-9]/g, "")); setCell(u.id, mm, unit ? (a / unit * 100) : 0); }} />
                              </div>
                            );
                          })()}
                        </td>
                      );
                    })}
                    <td style={{ whiteSpace: "nowrap" }}><b style={{ color: "var(--brand)" }}>{won(MONTHS.reduce((s, mm) => s + planAmt(u, mm), 0))}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn primary" data-testid="pay-save" onClick={savePlan}>{year}년 참여율 저장</button>
            <span className="muted small">저장 시 월별 인건비 명세(예정) 자동 생성 · 지급확정은 [학생별 지급] 탭</span>
          </div>
        </Card>
      )}

      {/* ===== 탭2: 학생별 지급 ===== */}
      {tab === "pay" && (
        <Card title={`${year}년 학생별 월 지급액`} extra={isAdmin && (pendTotal > 0
          ? <button className="btn primary sm" data-testid="pay-confirm-all" onClick={confirmAll}>미확정 {pendTotal}건 전체 지급확정</button>
          : <span className="muted small">전체 지급확정 완료</span>)}>
          <div className="card scroll" style={{ margin: 0, border: "none" }}>
            <table className="tbl" data-testid="pay-table">
              <thead>
                <tr><th>구성원</th>{MONTHS.map((m) => <th key={m} style={{ textAlign: "center" }}>{Number(m)}월</th>)}<th>연 합계</th></tr>
                <tr style={{ background: "var(--soft)" }}><th className="muted small">지급확정</th>{MONTHS.map((mm) => <th key={mm} style={{ textAlign: "center" }} className="muted small">{monthPend(mm) > 0 ? `미확정 ${monthPend(mm)}` : (payMonthTotal(mm) ? "완료" : "—")}</th>)}<th></th></tr>
              </thead>
              <tbody>
                {payStudents.map((u) => (
                  <tr key={u.id}>
                    <td style={{ whiteSpace: "nowrap" }}><a className="lnk" style={{ fontWeight: 700, cursor: "pointer" }} data-testid={`pay-open-${u.id}`} onClick={() => { setDetailYear(year); setDetail(u.id); }}>{u.name}</a> <span className="pill">{grade(u)}</span></td>
                    {MONTHS.map((mm) => { const amt = payAmt(u.id, mm); return (
                      <td key={mm} style={{ textAlign: "center" }} data-testid={`pay-${u.id}-${mm}`} className={amt ? "" : "muted"}>{amt ? won(amt) : "–"}</td>
                    ); })}
                    <td style={{ whiteSpace: "nowrap" }}><b style={{ color: "var(--brand)" }}>{won(payAnnual(u.id))}</b></td>
                  </tr>
                ))}
                {!payStudents.length && <tr><td colSpan={14} className="muted">지급 내역 없음 — [참여율 편성]에서 먼저 입력하세요</td></tr>}
                <tr style={{ fontWeight: 700, background: "var(--soft)" }}><td>월 합계</td>{MONTHS.map((mm) => <td key={mm} style={{ textAlign: "center", fontSize: 11 }}>{payMonthTotal(mm) ? won(payMonthTotal(mm)) : "—"}</td>)}<td>{won(students.reduce((a, u) => a + payAnnual(u.id), 0))}</td></tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ===== 탭3: 과제별 집행(예산 연동) ===== */}
      {tab === "exec" && (
        <Card title={`${year}년 과제별 학생인건비 집행`} extra={<span className="muted small">예산 학생인건비 비목과 연동</span>}>
          {(() => {
            // 통합학생인건비 누적 — 선택 연도까지 시작된 과제만 합산
            const groups: Record<string, Project[]> = {};
            projects.forEach((p) => {
              const [s] = projPeriod(p);
              if (s && s.slice(0, 4) > year) return;   // 선택 연도 이후 시작 과제 제외
              const k = String(p.meta?.payroll_pool || "").trim(); if (k) (groups[k] ||= []).push(p);
            });
            const entries = Object.entries(groups).filter(([, ps]) => ps.length >= 2);
            if (!entries.length) return null;
            return (
              <div style={{ marginBottom: 12 }}>
                <div className="muted small" style={{ marginBottom: 6 }}>통합학생인건비 그룹 — 연도 무관 누적 합산 한도(개별 과제 한도와 무관)</div>
                <table className="tbl" style={{ minWidth: 0 }}>
                  <thead><tr><th>통합 그룹</th><th>포함 과제</th><th>편성</th><th>집행</th><th>예정</th><th>잔여</th></tr></thead>
                  <tbody>
                    {entries.map(([k, ps]) => {
                      const alloc = ps.reduce((a, p) => a + stuBudget(p.id).allocated, 0);   // 편성 그대로
                      const spent = ps.reduce((a, p) => a + stuBudget(p.id).spent - projFuturePaid(p.id), 0) + equalSpentAll;   // 균등 포함, 미래 지급분 제외
                      const pend = ps.reduce((a, p) => a + projFutureAll(p.id), 0);   // 현재 월 다음달~연말(지급확정 포함)
                      // 포함 과제: 최근 순(시작 연도 내림차순) 정렬
                      const yrOf = (p: Project) => (projPeriod(p)[0]?.slice(0, 4)) || (p.code.match(/\((\d{4})\)/)?.[1]) || "0";
                      const codes = [...ps].sort((a, b) => yrOf(b).localeCompare(yrOf(a)) || b.code.localeCompare(a.code)).map((p) => p.code).join(", ");
                      return (
                        <tr key={k}>
                          <td><span className="badge s-pur">{k}</span></td>
                          <td className="small muted" title={codes} style={{ maxWidth: "min(460px, 30vw)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{codes}</td>
                          <td>{won(alloc)}</td><td title={equalSpentAll ? `과제 확정 집행 + 균등 ${won(equalSpentAll)}` : undefined}>{won(spent)}</td><td className="muted">{pend ? won(pend) : "—"}</td>
                          <td style={{ color: alloc - spent - pend < 0 ? "var(--bad)" : "inherit" }}><b>{won(alloc - spent - pend)}</b></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {equalSpentAll > 0 && <div className="muted small" style={{ marginTop: 4 }}>※ 균등(YYYY) 예산 {won(equalSpentAll)}은 통합학생인건비 확정 집행으로 처리(균등은 통합 재원으로 운영).</div>}
              </div>
            );
          })()}
          <table className="tbl" data-testid="exec-table">
            <thead><tr><th>과제</th><th>편성(학생인건비)</th><th>지급확정 집행</th><th>예정(미확정)</th><th>잔여</th><th>집행률</th></tr></thead>
            <tbody>
              {yearProjects.map((p) => { const b = stuBudget(p.id); const pend = projPend(p.id); const r = b.allocated ? Math.round(b.spent / b.allocated * 100) : 0; return (
                <tr key={p.id}>
                  <td><b>{p.code}</b></td>
                  <td>{won(b.allocated)}</td>
                  <td>{won(b.spent)}</td>
                  <td className="muted">{pend ? won(pend) : "—"}</td>
                  <td style={{ color: b.allocated - b.spent < 0 ? "var(--bad)" : "inherit" }}>{won(b.allocated - b.spent)}</td>
                  <td><div className="bar" style={{ width: 80, display: "inline-block", verticalAlign: "middle" }}><i style={{ width: `${Math.min(r, 100)}%`, background: r > 90 ? "var(--bad)" : "var(--brand)" }} /></div> {r}%</td>
                </tr>
              ); })}
            </tbody>
          </table>
          <div className="muted small" style={{ marginTop: 10 }}>지급확정 시 해당 과제 학생인건비 집행액이 자동 반영되며, [예산] 화면에서도 동일하게 표시됩니다.</div>
        </Card>
      )}

      <Card title="학력등급별 기준단가(월)">
        <table className="tbl"><thead><tr><th>등급</th><th>월 단가</th></tr></thead>
          <tbody>{Object.entries(GRADE_RATES).filter(([g]) => g !== "교수").map(([g, r]) => <tr key={g}><td>{g}</td><td>{won(r)}</td></tr>)}</tbody></table>
      </Card>

      {/* 과제별 분해 팝업 */}
      {detail && (() => {
        // 학생 연간 지급 — 가로 월·세로 과제코드
        const yr = detailYear || year;
        const my = detailSlips;
        const cell = (pid: string, mm: string) => {   // 예정 우선(없으면 지급) — 미확정 중복 이중계산 방지
          const rows = my.filter((s) => s.project_id === pid && s.month === `${yr}-${mm}`);
          if (!rows.length) return 0;
          return (rows.find((s) => s.status === "예정") || rows[0]).amount;
        };
        const rowTot = (pid: string) => MONTHS.reduce((a, mm) => a + cell(pid, mm), 0);
        const projIds = [...new Set(my.map((s) => s.project_id))].sort((a, b) => rowTot(b) - rowTot(a));
        const colTot = (mm: string) => projIds.reduce((a, pid) => a + cell(pid, mm), 0);
        const grand = projIds.reduce((a, pid) => a + rowTot(pid), 0);
        return (
          <div className="modal-ovl" onClick={(e) => { if (e.target === e.currentTarget) setDetail(null); }}>
            <div className="modal" data-testid="pay-detail" style={{ width: 1120, maxWidth: "96%" }}>
              <div className="modal-h"><b>{nameOf(detail)} · 과제별 지급</b>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <select data-testid="pay-detail-year" value={yr} onChange={(e) => setDetailYear(e.target.value)} style={{ width: "auto", margin: 0, fontWeight: 700 }}>{years.map((y) => <option key={y} value={y}>{y}년</option>)}</select>
                  <button className="btn ghost sm" onClick={() => setDetail(null)}>✕</button>
                </span>
              </div>
              <div className="modal-b" style={{ overflowX: "auto" }}>
                <table className="tbl pay-detail-tbl">
                  <thead><tr><th style={{ whiteSpace: "nowrap" }}>관리코드</th>{MONTHS.map((mm) => <th key={mm} style={{ textAlign: "right" }}>{Number(mm)}월</th>)}<th style={{ textAlign: "right" }}>합계</th></tr></thead>
                  <tbody>
                    {projIds.map((pid) => (
                      <tr key={pid}>
                        <td style={{ whiteSpace: "nowrap" }}><b>{codeOf(pid)}</b></td>
                        {MONTHS.map((mm) => { const v = cell(pid, mm); return <td key={mm} style={{ textAlign: "right", whiteSpace: "nowrap" }} className={v ? "" : "muted"}>{v ? won(v) : "–"}</td>; })}
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}><b>{won(rowTot(pid))}</b></td>
                      </tr>
                    ))}
                    {!projIds.length && <tr><td colSpan={14} className="muted" style={{ textAlign: "center", padding: 14 }}>지급 내역 없음</td></tr>}
                    <tr style={{ fontWeight: 700, background: "var(--soft)" }}>
                      <td>월 합계</td>
                      {MONTHS.map((mm) => <td key={mm} style={{ textAlign: "right", whiteSpace: "nowrap" }}>{colTot(mm) ? won(colTot(mm)) : "–"}</td>)}
                      <td style={{ textAlign: "right", color: "var(--brand)", whiteSpace: "nowrap" }}>{won(grand)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
