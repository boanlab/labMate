import { useEffect, useState } from "react";
import { useDirectory } from "../api/directory";
import { usePref } from "../api/prefs";
import { richHtml } from "../ui/richHtml";
import { todayKST, workdayKST, dtKST } from "../lib/date";
import { FIXED_KINDS, seriesOf } from "../lib/pubClass";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { confirmDialog } from "../ui/dialog";
import { Kpi, Card } from "../ui/kit";
import { useColumnResize, useTableSort } from "../ui/tableTools";
import { MentorNudge, collectSignals } from "../components/MentorNudge";
import { WeeklyReview, collectWeekFacts } from "../components/WeeklyReview";
import { sortMembers } from "./Members";


interface Project { id: string; code: string; name: string; agency: string; status: string; goals: Record<string, number>; start: string | null; end: string | null; lead_id: string; pm_id: string; members: string[]; meta?: Record<string, any>; }
interface Budget { project_id: string; category: string; allocated: number; spent: number; }
interface Pub { kind: string; project_id: string; scope: string; index_type: string; index_grade: string; funding: string; }
// 과제 성과 집계 조건: project_id 연결 또는 사사에 과제 코드 포함(다중 사사)
function pubFundsProject(u: Pub, p: Project): boolean {
  if (u.project_id === p.id) return true;
  if (!p.code) return false;
  return (u.funding || "").split(/[,;]/).map((s) => s.trim()).includes(p.code);
}
// 다중 사사 실적은 1/n 지분으로 카운트(n = 사사 개수).
function pubShare(u: Pub): number {
  const n = (u.funding || "").split(/[,;]/).map((s) => s.trim()).filter(Boolean).length;
  return n > 1 ? 1 / n : 1;
}
interface Notice { id: string; acked_user_ids: string[]; target_user_ids?: string[]; }
interface DayLog { id: string; date: string; title: string; project_id: string; done: boolean; note: string; order: number }
interface Activity { id: string; code: string; name: string; category: string; status: string; start: string | null; end: string | null; pm_id: string; members: string[]; }
// 기간 기반 자동 상태(예정/진행 중/완료)
function liveStatus(start: string | null, end: string | null): string {
  const t = todayKST();
  if (start && t < start) return "예정";
  if (end && t > end) return "완료";
  return "진행 중";
}
// 연구과제 상태·기한은 해당 연도 기간 기준(미입력 시 총 과제기간)
function grantStatus(p: Project): string {
  const m = p.meta || {};
  if (m.year_start || m.year_end) return liveStatus(m.year_start || null, m.year_end || null);
  return liveStatus(p.start, p.end);
}
const grantEnd = (p: Project): string | null => (p.meta?.year_end) || p.end;
interface DTask { id: string; project_id: string; title: string; status: string; due: string | null; assignee_id: string; }
interface Att { uid: string; status: string; check_in: string; check_out: string; }
interface Appr { id: string; doc_no: string; type: string; title: string; by_id: string; amount: number; steps: any[]; status: string; }
interface User { id: string; name: string; role: string; active: boolean; join_date?: string | null; }

// 근태 상태색 — 테마별로 대비를 맞추기 위해 CSS 토큰을 참조한다(styles.css --st-*)
const STCOL: Record<string, string> = { "업무 중": "var(--st-work)", "외근": "var(--st-out)", "출장": "var(--st-trip)", "휴가": "var(--st-leave)", "퇴근": "var(--st-off)", "미체크": "var(--st-none)" };
const ROLE_KO: Record<string, string> = { prof: "교수", phd: "박사과정", master: "석사과정", under: "학사과정", staff: "행정", admin: "관리" };

// 포트폴리오 성과 지표 = 실적 분류(국제/국내논문지·학술대회·특허). 실적·과제 목표와 동일 기준.
const PORT_INDS: [string, string][] = FIXED_KINDS.map((k) => [k, k]);
// 표에 넣기 위한 짧은 지표명 — 원래 이름은 셀 title 로 남는다
const SHORT_IND: Record<string, string> = { "국제논문지": "국제논문", "국내논문지": "국내논문", "국제학술대회": "국제학회", "국내학술대회": "국내학회", "국제특허": "국제특허", "국내특허": "국내특허" };
const nfNum = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(1);
function currentIdx(line: any[]): number {
  for (let i = 0; i < line.length; i++) { if (!line[i].decision) return i; if (line[i].decision === "반려") return -1; }
  return -1;
}

export default function Dashboard() {
  const dirName = useDirectory();   // 퇴사·삭제된 구성원도 이름으로 보이게
  const { me } = useAuth();
  const nav = useNavigate();
  const isMgr = !!me && (["prof", "staff", "admin"].includes(me.role) || !!me.delegated_admin);
  const isProf = me?.role === "prof";      // 지도교수는 근태 기록 대상이 아니다
  const canBudget = !!me && (["prof", "staff"].includes(me.role) || !!me.delegated_admin);   // 예산 조회 권한(학생 차단)
  const [projects, setProjects] = useState<Project[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [pubs, setPubs] = useState<Pub[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [allTasks, setAllTasks] = useState<DTask[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [att, setAtt] = useState<Att[]>([]);
  const [inbox, setInbox] = useState<Appr[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  // 대시보드에서 바로 적는 오늘 업무일지 — 화면을 옮기지 않고 한 줄 남길 수 있게.
  const [dayLogs, setDayLogs] = useState<DayLog[]>([]);
  const [logTitle, setLogTitle] = useState("");
  useEffect(() => { api.get<DayLog[]>("/projects/dailylogs").then((r) => setDayLogs(r.data)).catch(() => {}); }, []);
  async function addLog(e: React.FormEvent) {
    e.preventDefault();
    if (!logTitle.trim()) return;
    try {
      const { data } = await api.post<DayLog>("/projects/dailylogs", { date: todayKST(), title: logTitle.trim(), order: dayLogs.length });
      setDayLogs((ls) => [...ls, data]); setLogTitle("");
    } catch { /* 대시보드에서 실패는 조용히 넘긴다 — 업무일지 화면에서 다시 시도할 수 있다 */ }
  }
  const setLogLocal = (id: string, body: Partial<DayLog>) => setDayLogs((ls) => ls.map((x) => x.id === id ? { ...x, ...body } : x));
  async function saveLog(l: DayLog, body: Partial<DayLog>) {
    setLogLocal(l.id, body);
    try { await api.patch(`/projects/dailylogs/${l.id}`, body); } catch { setLogLocal(l.id, l); }
  }
  async function delLog(l: DayLog) {
    if (!await confirmDialog(`"${l.title}"을(를) 지울까요?`, { danger: true })) return;
    try { await api.delete(`/projects/dailylogs/${l.id}`); setDayLogs((ls) => ls.filter((x) => x.id !== l.id)); } catch { /* 무시 */ }
  }

  const [pfShut, setPfShut] = usePref<boolean>("dash_portfolio_shut", false);   // 과제 포트폴리오 접힘
  const [selEv, setSelEv] = useState<any>(null);
  const [myAppr, setMyAppr] = useState<any[]>([]);
  const [myMeetings, setMyMeetings] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);

  // 퇴근을 안 찍고 넘어간 날 찾기 — 본인 기록과 정정요청을 함께 본다.
  const [myAtt, setMyAtt] = useState<any[]>([]);
  const [myReqs, setMyReqs] = useState<any[]>([]);
  useEffect(() => {
    api.get<any[]>("/attendance/attendance/me").then((r) => setMyAtt(r.data)).catch(() => {});
    api.get<any[]>("/attendance/attendance/correct-requests").then((r) => setMyReqs(r.data)).catch(() => {});
  }, []);

  // 지난 근무일 중 출근만 있고 퇴근이 없는 날. 이미 보정 신청(대기·승인)이 있으면 뺀다.
  const workday = workdayKST();
  const handled = new Set(myReqs.filter((r) => r.status === "대기" || r.status === "승인").map((r) => r.date));
  const missingOut = myAtt
    .filter((a) => a.date < workday && a.check_in && !a.check_out && !handled.has(a.date))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);


  async function reloadAtt() { try { setAtt((await api.get("/attendance/attendance/today")).data); } catch { /* */ } }
  async function checkIn() { try { await api.post("/attendance/attendance/check-in", { status: "업무 중", note: "" }); reloadAtt(); } catch { /* */ } }
  async function checkOut() { try { await api.post("/attendance/attendance/check-out"); reloadAtt(); } catch { /* */ } }
  // 자리비움·복귀도 대시보드에서 — 잠깐 자리를 비울 때마다 출퇴근 화면을 여는 건 번거롭다.
  async function goAway() { try { await api.post("/attendance/attendance/away"); reloadAtt(); } catch { /* */ } }
  async function comeBack() { try { await api.post("/attendance/attendance/back"); reloadAtt(); } catch { /* */ } }

  useEffect(() => {
    if (me?.role === "admin") {
      api.get("/members/users").then((r) => setUsers(r.data)).catch(() => {});
      (async () => {
        const all: any[] = [];
        for (const s of ["members", "projects", "funds", "attendance", "boards", "resource"]) {
          try { const r = await api.get(`/${s}/admin/audit?skip=0&limit=50`); all.push(...(r.data.items || [])); } catch { /* */ }
        }
        all.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
        setAudit(all);
      })();
      return;
    }
    api.get("/projects/projects?kind=grant").then((r) => setProjects(r.data)).catch(() => {});
    api.get("/projects/projects?kind=activity").then((r) => setActivities(r.data)).catch(() => {});
    api.get("/projects/tasks").then((r) => setAllTasks(r.data)).catch(() => {});
    api.get("/boards/notices").then((r) => setNotices(r.data)).catch(() => {});
    api.get("/projects/publications").then((r) => setPubs(r.data)).catch(() => {});
    if (canBudget) api.get("/funds/budgets").then((r) => setBudgets(r.data)).catch(() => {});
    api.get("/attendance/attendance/today").then((r) => setAtt(r.data)).catch(() => {});
    api.get("/boards/events").then((r) => setEvents(r.data)).catch(() => {});
    api.get("/boards/approvals/mine").then((r) => setMyAppr(r.data)).catch(() => {});
    api.get("/boards/meetings").then((r) => setMyMeetings(r.data)).catch(() => {});
    if (isMgr) {
      api.get("/boards/approvals/inbox").then((r) => setInbox(r.data)).catch(() => {});
      api.get("/members/users").then((r) => setUsers(r.data)).catch(() => {});
    }
  }, [isMgr]);

  // 포트폴리오: 관리자급(교수·행정·위임)은 연구실 전체 과제, 학생은 본인 참여 과제만
  const seesAll = isMgr;
  const isMine = (p: Project) => p.lead_id === me?.id || p.pm_id === me?.id || (p.members || []).includes(me?.id || "");
  // 균등(YYYY) 과제는 수행 과제 카운트·포트폴리오에서 제외.
  const ps = projects.filter((p) => grantStatus(p) !== "완료" && !/균등\s*\(\d{4}\)/.test(p.code || "") && (seesAll || isMine(p)));
  const budgetOf = (pid: string) => {
    const b = budgets.filter((x) => x.project_id === pid).reduce((a, x) => ({ allocated: a.allocated + x.allocated, spent: a.spent + x.spent }), { allocated: 0, spent: 0 });
    return b.allocated ? Math.round((b.spent / b.allocated) * 100) : 0;
  };
  const achievedOf = (p: Project) => {
    const g = p.goals || {};
    const tg = Object.values(g).reduce((a, v) => a + v, 0);
    const counts: Record<string, number> = {};
    pubs.filter((u) => pubFundsProject(u, p)).forEach((u) => { const m = seriesOf(u); counts[m] = (counts[m] || 0) + pubShare(u); });
    const ta = +Object.keys(g).reduce((a, k) => a + Math.min(counts[k] || 0, g[k]), 0).toFixed(1);
    const tot = +Object.values(counts).reduce((a, v) => a + v, 0).toFixed(1);   // 목표 미설정이어도 실적 총 달성수
    return { ta, tg, tot, counts };
  };
  const dday = (end: string | null) => end ? Math.ceil((+new Date(end) - Date.now()) / 86400000) : null;
  const pfRef = useColumnResize("dash-portfolio");
  const pfSort = useTableSort(null, "dash-portfolio");

  // 결재 — 내 차례인 문서
  const myTurn = inbox.filter((a) => a.status === "진행" && a.steps[currentIdx(a.steps)]?.uid === me?.id);

  // 연구원 근태 — 기록 대상(지도교수·관리자 제외)만 센다. 아래 카드 목록은 본인도 뺀다.
  const attBy = (uid: string) => att.find((a) => a.uid === uid);
  const members = users.filter((u) => u.active !== false && !["admin", "prof"].includes(u.role)).sort(sortMembers);
  const memberIds = new Set(members.map((u) => u.id));
  const attCount: Record<string, number> = {};
  att.filter((a) => memberIds.has(a.uid)).forEach((a) => { attCount[a.status] = (attCount[a.status] || 0) + 1; });
  const attSegs = Object.keys(attCount).map((s) => ({ label: s, value: attCount[s], color: STCOL[s] || "var(--sub)" }));
  const uncheckCount = members.filter((m) => !att.some((a) => a.uid === m.id)).length;

  // 연구원(학생) 개인 현황 데이터
  const myToday = att.find((a) => a.uid === me?.id) || null;   // 본인 기록만 — 없으면 미체크(타인 폴백 금지)
  const myInWork = !!myToday?.status && myToday.status !== "미체크" && myToday.status !== "퇴근";
  const myAway = myToday?.status === "자리비움";
  const myActions = myMeetings.flatMap((m: any) => (m.actions || []).filter((a: any) => a.assignee_id === me?.id && !a.done).map((a: any) => ({ ...a, mt: m.title })));
  const myPendingAppr = myAppr.filter((a: any) => a.status === "진행");
  // '내 할 일' — 세부업무·회의록 액션·결재·필독 공지를 한자리에 모은다.
  const myOpenTasks = allTasks.filter((t) => t.assignee_id === me?.id && t.status !== "완료");
  const myUnackNotices = notices.filter((n: any) => n.required && !(n.acked_user_ids || []).includes(me?.id || ""));
  const todoCount = myActions.length + myPendingAppr.length + myOpenTasks.length + myUnackNotices.length;

  const today0 = todayKST();
  const todayEvents = events.filter((e: any) => e.date === today0).sort((a: any, b: any) => (a.time || "").localeCompare(b.time || ""));
  const futureEvents = events.filter((e: any) => e.date > today0).sort((a: any, b: any) => a.date.localeCompare(b.date)).slice(0, 4);

  // 프로젝트(활동)·세부 업무 현황
  const projCode = (pid: string) => [...projects, ...activities].find((p) => p.id === pid)?.code || pid.slice(0, 6);
  // 세부 업무 현황: 본인 담당 업무만
  const myTasks = allTasks.filter((t) => t.assignee_id === me?.id);
  const taskCount: Record<string, number> = {}; myTasks.forEach((t) => { taskCount[t.status] = (taskCount[t.status] || 0) + 1; });
  const overdueTasks = myTasks.filter((t) => t.status !== "완료" && t.due && t.due < today0);
  const openTasks = myTasks.filter((t) => t.status !== "완료").sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));

  // 멘토가 짚어 줄 '밀린 일' — 이미 불러 둔 데이터에서 뽑는다(추가 요청 없음).
  const lastReport = myAppr
    .filter((a: any) => /주간/.test(a.type || "") && a.created_at)
    .map((a: any) => String(a.created_at).slice(0, 10))
    .sort().pop() || "";
  const weekFacts = collectWeekFacts({ tasks: myTasks, actions: myActions, meetings: myMeetings });
  const nudgeSignals = collectSignals({
    tasks: myTasks, actions: myActions, unackNotices: myUnackNotices.length,
    pendingAppr: myPendingAppr.length, lastReportAt: lastReport,
  });
  const unackNotices = notices.filter((n) => (!(n.target_user_ids || []).length || (n.target_user_ids || []).includes(me?.id || "")) && !(n.acked_user_ids || []).includes(me?.id || "")).length;

  // ── 관리자(admin) 전용 대시보드 — 구성원 현황 · 최근 감사 로그 ──
  if (me?.role === "admin") {
    const mem = users.filter((u) => u.role !== "admin");
    const activeN = mem.filter((u) => u.active !== false).length;
    const roleOrder = ["prof", "phd", "master", "under", "staff"];
    const byRole: Record<string, number> = {};        // 역할 표시 여부용(전체)
    const byRoleActive: Record<string, number> = {};   // 재직(활성)
    const byRoleInactive: Record<string, number> = {}; // 비활성
    mem.forEach((u) => {
      byRole[u.role] = (byRole[u.role] || 0) + 1;
      const map = u.active !== false ? byRoleActive : byRoleInactive;
      map[u.role] = (map[u.role] || 0) + 1;
    });
    return (
      <div data-testid="page-dashboard">
        <h1 style={{ marginBottom: 8 }}>관리자 현황 <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>· 한눈에 보기</span></h1>
        <div className="grid g3" style={{ marginBottom: 12 }}>
          <Kpi label="전체 구성원" value={mem.length} sub="관리자 제외" onClick={() => nav("/members")} />
          <Kpi label="재직" value={activeN} sub={`휴직/비활성 ${mem.length - activeN}`} tone="green" />
          <Kpi label="감사 로그" value={audit.length} sub="최근 활동" onClick={() => nav("/audit")} />
        </div>
        <div className="grid g2">
          <Card title="구성원 현황" extra={<button className="btn ghost sm" onClick={() => nav("/members")}>구성원 관리</button>}>
            <table className="tbl">
              <thead><tr><th>직급</th><th>인원</th></tr></thead>
              <tbody>
                {roleOrder.filter((r) => byRole[r]).map((r) => (
                  <tr key={r}><td>{ROLE_KO[r] || r}</td><td><b>{byRoleActive[r] || 0}</b>명{byRoleInactive[r] ? <span className="muted small"> (비활성 {byRoleInactive[r]})</span> : ""}</td></tr>
                ))}
                <tr><td><b>합계</b></td><td><b>{activeN}</b>명{mem.length - activeN ? <span className="muted small"> (비활성 {mem.length - activeN})</span> : ""}</td></tr>
              </tbody>
            </table>
          </Card>
          <Card title="최근 감사 로그" extra={<button className="btn ghost sm" onClick={() => nav("/audit")}>전체 보기</button>}>
            <table className="tbl" data-preview="최근 15건">
              <thead><tr><th>시각</th><th>행위자</th><th>행위</th><th>대상</th><th>서비스</th></tr></thead>
              <tbody>
                {audit.slice(0, 15).map((a, i) => (
                  <tr key={i}>
                    <td className="muted small" style={{ whiteSpace: "nowrap" }}>{dtKST(a.at).slice(5)}</td>
                    <td className="small"><b>{a.actor}</b></td>
                    <td><span className="badge s-info">{a.action}</span></td>
                    <td className="small">{a.entity || "—"}</td>
                    <td className="muted small">{a.service}</td>
                  </tr>
                ))}
                {!audit.length && <tr><td colSpan={5} className="muted">감사 로그 없음</td></tr>}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    );
  }

  // 공통 대시보드 (교수 기준, 역할별 일부 분기)
  return (
    <div data-testid="page-dashboard">
      <h1 style={{ marginBottom: 10 }}>{me?.name}{me?.role === "prof" ? " 교수님" : ""} {isMgr ? "연구실 현황" : "현황"} <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>· 한눈에 보기</span></h1>

      {!isProf && missingOut.length > 0 && (
        <div className="card dash-warn" data-testid="dash-missing-out">
          <div>
            <b>퇴근 체크가 빠진 날이 있습니다</b>
            <div className="muted small">{missingOut.map((a) => a.date).join(", ")} — 출근만 기록되어 근무시간이 계산되지 않습니다.</div>
          </div>
          <button className="btn primary sm" data-testid="dash-correct" style={{ marginLeft: "auto" }}
            onClick={() => nav(`/attendance?correct=${missingOut[0].date}`)}>출퇴근 시간 보정</button>
        </div>
      )}

      <div className="dash-top">
        <div className="kpi dash-att" data-testid="dash-attendance" style={{ gridColumn: "span 2", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="l">내 근태</div>
            <div className="n" style={{ fontSize: 18, color: isProf ? "var(--sub)" : (STCOL[myToday?.status || "미체크"] || "var(--ink)") }}>● {isProf ? "해당 없음" : (myToday?.status || "미체크")}</div>
            <div className="sub">{isProf ? "지도교수는 근태 대상이 아닙니다"
              : `${myToday?.check_in ? `출근 ${myToday.check_in}` : "출근 전"}${myToday?.check_out ? ` · 퇴근 ${myToday.check_out}` : ""}`}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
            {/* 지금 가능한 동작을 강조한다 — 비활성 버튼이 더 진하면 어느 쪽을 눌러야 할지 반대로 읽힌다 */}
            {/* 출근한 뒤에는 출근 버튼이 할 일이 없다 — 그 자리를 자리비움(비운 동안은 복귀)이 대신한다. */}
            {!myInWork
              ? <button className="btn sm primary" data-testid="dash-checkin" disabled={isProf}
                  title={isProf ? "지도교수는 근태 대상이 아닙니다" : undefined} onClick={checkIn}>출근</button>
              : myAway
                ? <button className="btn sm primary" data-testid="dash-back" onClick={comeBack}>복귀</button>
                : <button className="btn sm ghost" data-testid="dash-away" onClick={goAway}
                    title="잠시 자리를 비웁니다 — 비운 시간은 근무시간에서 빠집니다">자리비움</button>}
            <button className={"btn sm " + (myInWork && !myAway ? "primary" : "ghost")} data-testid="dash-checkout" disabled={isProf || !myInWork}
              title={isProf ? "지도교수는 근태 대상이 아닙니다" : undefined} onClick={checkOut}>퇴근</button>
          </div>
        </div>
        <div className={"kpi " + (unackNotices ? "k-amber" : "k-green")} style={{ gridColumn: "span 2", cursor: "pointer" }} data-testid="kpi-notices" onClick={() => nav("/notices")} title="공지사항으로 이동">
          <div className="l">미확인 공지</div>
          <div className="n">{unackNotices}</div>
          <div className="sub">{unackNotices ? "확인 필요" : "모두 확인"}</div>
        </div>
        <div className="kpi k-blue" style={{ gridColumn: "span 2", cursor: "pointer" }} data-testid="kpi-projects" onClick={() => nav("/grants")} title="연구과제로 이동">
          <div className="l">수행 과제</div>
          <div className="n">{ps.length}</div>
          <div className="sub">{seesAll ? "연구실 전체 · 진행 중" : "내 참여 · 진행 중"}</div>
        </div>
        {isMgr ? (
          <div className={"kpi " + (myTurn.length ? "k-amber" : "k-green")} style={{ gridColumn: "span 2", cursor: "pointer" }} data-testid="kpi-approvals" onClick={() => nav("/approvals")} title="전자결재로 이동">
            <div className="l">결재 대기</div>
            <div className="n">{myTurn.length}</div>
            <div className="sub">{myTurn.length ? "내 결재 차례 (휴가 포함)" : "없음"}</div>
          </div>
        ) : (
          <div className={"kpi " + (todoCount ? "k-amber" : "k-green")} style={{ gridColumn: "span 2" }} data-testid="kpi-todo">
            <div className="l">할 일</div>
            <div className="n">{todoCount}</div>
            <div className="sub">{todoCount ? "처리 필요" : "없음"}</div>
          </div>
        )}
        <div className="kpi dash-today" style={{ gridColumn: "span 2" }} data-testid="dash-today">
          <div className="l" style={{ marginBottom: 6 }}>오늘 일정 <a className="lnk" style={{ float: "right", fontSize: 11, fontWeight: 400 }} onClick={() => nav("/calendar")}>캘린더 →</a></div>
          {(todayEvents.length || futureEvents.length) ? (
            <>
              {todayEvents.length ? todayEvents.map((e: any, i: number) => (
                <div key={"t" + i} className="small dash-ev" onClick={() => setSelEv(e)} data-testid={`dash-ev-${i}`}>
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.recurring ? "🔁 " : ""}{e.title}</span>
                  <span className="muted" style={{ flexShrink: 0 }}>{e.time || "오늘"}</span>
                </div>
              )) : <div className="muted small" style={{ padding: "3px 0" }}>오늘 일정 없음</div>}
              {futureEvents.length > 0 && <div className="dash-ev-div"><span>다가오는 일정</span></div>}
              {futureEvents.map((e: any, i: number) => (
                <div key={"f" + i} className="small dash-ev" onClick={() => setSelEv(e)} data-testid={`dash-ev-f-${i}`}>
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.recurring ? "🔁 " : ""}{e.title}</span>
                  <span className="muted" style={{ flexShrink: 0 }}>{e.date.slice(5)}</span>
                </div>
              ))}
            </>
          ) : <div className="muted small">예정된 일정 없음</div>}
        </div>
        {/* 밀린 일이 있으면 맨 위에서 멘토가 먼저 짚는다(없으면 렌더되지 않는다) */}
        {!isMgr && !!nudgeSignals.length && (
          <div style={{ gridColumn: "span 6" }}><MentorNudge signals={nudgeSignals} /></div>
        )}

        {!isMgr && (
          <div style={{ gridColumn: "span 6" }}><WeeklyReview facts={weekFacts} /></div>
        )}

        {isMgr ? (
          <div className="dash-rs" style={{ gridColumn: "span 6" }}>
            <Card title="연구원 현황" extra={<a style={{ cursor: "pointer", fontSize: 12 }} onClick={() => nav("/members")}>구성원 →</a>} testid="dash-members">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 18px", marginBottom: 8 }} data-testid="dash-attdist">
                {attSegs.map((s) => (
                  <span key={s.label} className="small"><b style={{ color: s.color }}>●</b> {s.label} <b>{s.value}명</b></span>
                ))}
                {uncheckCount > 0 && <span className="small"><b style={{ color: "var(--sub)" }}>●</b> 미체크 <b>{uncheckCount}명</b></span>}
                {!attSegs.length && uncheckCount === 0 && <span className="muted small">근태 데이터 없음</span>}
              </div>
              <div className="memgrid" data-testid="dash-member-cards">
                {members.filter((u) => u.id !== me?.id).map((u) => {
                  const a = attBy(u.id); const st = a?.status || "미체크";
                  return (
                    <div key={u.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "9px 11px", background: "var(--soft)" }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.name} <span className="muted small">{ROLE_KO[u.role] || u.role}</span></div>
                      <div className="small" style={{ color: STCOL[st] || "var(--sub)", fontWeight: 600, marginTop: 2 }}>● {st}{a?.check_in ? <span className="muted" style={{ fontWeight: 400 }}> {a.check_in}{a.check_out ? `~${a.check_out}` : ""}</span> : ""}</div>
                    </div>
                  );
                })}
                {!members.length && <div className="muted">구성원 없음</div>}
              </div>
            </Card>
          </div>
        ) : (
          <div style={{ gridColumn: "span 6" }}>
            <Card title="내 할 일" testid="dash-todo-card">
              {myActions.map((a: any, i: number) => (
                <div key={"act" + i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line2)" }}>
                  <span><span className="badge s-pur" style={{ marginRight: 6 }}>액션</span>{a.title}<div className="muted small">{a.mt}</div></span>
                  <span className="muted small">{a.due ? `~${a.due}` : ""}</span>
                </div>
              ))}
              {[...myOpenTasks].sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999")).map((t: any) => {
                const over = t.due && t.due < today0;
                return (
                  <div key={"tk" + t.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line2)" }}>
                    <span><span className="badge s-info" style={{ marginRight: 6 }}>업무</span>{t.title}<div className="muted small">{projCode(t.project_id)} · {t.status}</div></span>
                    <a className="lnk small" style={{ cursor: "pointer", whiteSpace: "nowrap", color: over ? "var(--bad-text)" : undefined }}
                       onClick={() => nav(`/projects?open=${t.project_id}`)}>{t.due ? (over ? `${t.due} 지남` : `~${t.due}`) : "보기"}</a>
                  </div>
                );
              })}
              {myUnackNotices.map((n: any) => (
                <div key={"nt" + n.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line2)" }}>
                  <span><span className="badge s-bad" style={{ marginRight: 6 }}>필독</span>{n.title}<div className="muted small">아직 확인하지 않았습니다</div></span>
                  <a className="lnk small" style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => nav(`/notices?open=${n.id}`)}>확인</a>
                </div>
              ))}
              {myPendingAppr.map((a: any) => (
                <div key={a.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line2)" }}>
                  <span><span className="badge s-info" style={{ marginRight: 6 }}>결재</span>{a.title}<div className="muted small">{a.doc_no} · 진행 중</div></span>
                  <a className="lnk small" onClick={() => nav("/approvals")}>보기</a>
                </div>
              ))}
              {!todoCount && <div className="muted" style={{ padding: 12, textAlign: "center" }}>처리할 일이 없습니다 🎉</div>}
            </Card>
          </div>
        )}
      </div>

      <Card title="과제 포트폴리오" extra={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <a style={{ cursor: "pointer", fontSize: 12 }} onClick={() => nav("/grants")}>과제관리 →</a>
          <button className="btn ghost sm" data-testid="dash-pf-toggle" aria-expanded={!pfShut}
            onClick={() => setPfShut(!pfShut)}>{pfShut ? "펼치기" : "접기"}</button>
        </span>}>
        {pfShut ? <div className="muted small">수행 중 과제 {ps.length}건 — 펼치기를 눌러 보세요</div> : (
        <div className="card scroll" style={{ margin: 0, border: "none" }}>
          <table ref={pfRef} className="tbl fit" data-testid="dash-portfolio" style={{ width: "100%" }}>
            <thead><tr>
              <th {...pfSort.th("name")}>과제{pfSort.mark("name")}</th>
              <th {...pfSort.th("agency", "hide-sm")} style={{ width: 84 }}>기관{pfSort.mark("agency")}</th>
              {canBudget && <th {...pfSort.th("exec", "hide-sm")} style={{ width: 158 }}>예산 집행률{pfSort.mark("exec")}</th>}
              <th {...pfSort.th("ach")} style={{ width: 132 }}>성과{pfSort.mark("ach")}</th>
              <th {...pfSort.th("dday")} style={{ width: 78 }}>기한{pfSort.mark("dday")}</th>
            </tr></thead>
            <tbody>
              {pfSort.apply(ps, {
                name: (p) => p.code, agency: (p) => p.agency || "",
                exec: (p) => budgetOf(p.id), ach: (p) => achievedOf(p).tot,
                dday: (p) => dday(grantEnd(p)) ?? 99999,
              }).map((p) => {
                const ex = budgetOf(p.id); const ach = achievedOf(p); const dd = dday(grantEnd(p));
                return (
                  <tr key={p.id}>
                    <td style={{ overflow: "hidden" }}><a className="lnk" style={{ cursor: "pointer", fontWeight: 700, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} onClick={() => nav(`/grants?open=${p.id}`)}>{p.code}</a><div className="muted small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.name}>{p.name}</div></td>
                    <td className="hide-sm">{p.agency}</td>
                    {canBudget && <td className="hide-sm"><div className="bar" style={{ width: 88, display: "inline-block", verticalAlign: "middle" }}><i style={{ width: `${Math.min(ex, 100)}%`, background: ex > 90 ? "var(--bad)" : ex > 75 ? "var(--warn)" : "var(--brand)" }} /></div> <span className="small muted">{ex}%</span></td>}
                    <td title={PORT_INDS.map(([k, l]) => `${l} ${nfNum(ach.counts[k] || 0)}/${p.goals?.[k] || 0}`).join(" · ")}>
                      <div className="small"><b>달성 {nfNum(ach.tot)}</b><span className="muted"> / 목표 {ach.tg}</span></div>
                      <div className="small muted hide-sm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {PORT_INDS.filter(([k]) => (ach.counts[k] || 0) || (p.goals?.[k] || 0))
                          .map(([k, l]) => `${SHORT_IND[l] || l} ${nfNum(ach.counts[k] || 0)}/${p.goals?.[k] || 0}`).join(" · ") || "지표 미설정"}
                      </div>
                    </td>
                    <td>{dd != null
                      // 남은 기간에 따라 경고 수위를 올린다 — 30일 안쪽이면 정산·실적 정리를 시작할 시점이다
                      ? (dd < 0 ? <span className="badge s-bad" title="종료일이 지났습니다">D+{-dd}</span>
                        : dd <= 7 ? <span className="badge s-bad" title="일주일 안에 종료됩니다">D-{dd}</span>
                        : dd <= 30 ? <span className="badge s-wait" title="한 달 안에 종료됩니다 — 정산·실적을 정리하세요">D-{dd}</span>
                        : <span className="badge s-info">D-{dd}</span>)
                      : "—"}</td>
                  </tr>
                );
              })}
              {!ps.length && <tr><td colSpan={canBudget ? 5 : 4} className="muted" style={{ textAlign: "center", padding: 14 }}>수행 중 과제 없음</td></tr>}
            </tbody>
          </table>
        </div>
        )}
      </Card>

      {isMgr && (
        <div className="grid g2">
          <Card title="세부 업무 현황" extra={<span className="muted small">내 업무 {myTasks.length}건</span>} testid="dash-tasks">
            <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 16px", marginBottom: 8 }}>
              <span className="small"><b style={{ color: "var(--sub)" }}>●</b> 예정 <b>{taskCount["예정"] || 0}</b></span>
              <span className="small"><b style={{ color: "var(--brand)" }}>●</b> 진행 중 <b>{taskCount["진행 중"] || 0}</b></span>
              <span className="small"><b style={{ color: "var(--ok-text)" }}>●</b> 완료 <b>{taskCount["완료"] || 0}</b></span>
              {overdueTasks.length > 0 && <span className="small"><b style={{ color: "var(--bad-text)" }}>●</b> 지연 <b>{overdueTasks.length}</b></span>}
            </div>
            <table className="tbl" data-preview="상위 6건" style={{ tableLayout: "fixed", width: "100%", minWidth: 0 }}>
              <thead><tr><th style={{ width: 84 }}>과제</th><th>업무</th><th style={{ width: 96 }}>마감</th></tr></thead>
              <tbody>
                {openTasks.slice(0, 6).map((t) => {
                  const late = t.due && t.due < today0;
                  return (
                    <tr key={t.id}>
                      <td className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", fontWeight: 700 }} title={projCode(t.project_id)}>{projCode(t.project_id)}</td>
                      <td className="small" style={{ overflow: "hidden", textOverflow: "ellipsis" }} title={t.title}>{t.title}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{t.due ? <span className={"badge " + (late ? "s-bad" : "s-info")}>{t.due}</span> : <span className="muted small">—</span>}</td>
                    </tr>
                  );
                })}
                {!openTasks.length && <tr><td colSpan={3} className="muted" style={{ textAlign: "center", padding: 12 }}>진행할 업무 없음</td></tr>}
              </tbody>
            </table>
          </Card>

          {/* 오늘 일지를 화면을 옮기지 않고 바로 적는다. 과제 연결·메모 같은 나머지는 업무일지 화면에서. */}
          <Card title="업무일지" testid="dash-daily"
            extra={<a style={{ cursor: "pointer", fontSize: 12 }} onClick={() => nav("/daily")}>업무일지 →</a>}>
            <form onSubmit={addLog} style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <input value={logTitle} onChange={(e) => setLogTitle(e.target.value)} data-testid="dash-daily-title"
                placeholder="오늘 할 일" aria-label="오늘 할 일" style={{ margin: 0, flex: 1 }} />
              <button className="btn primary sm" type="submit" data-testid="dash-daily-add">추가</button>
            </form>
            {dayLogs.map((l) => (
              <div key={l.id} className="daily-row" data-testid={`dash-daily-${l.id}`}>
                <input type="checkbox" checked={l.done} onChange={(e) => saveLog(l, { done: e.target.checked })}
                  aria-label={`${l.title} 완료`} style={{ margin: 0 }} />
                <input value={l.title} onChange={(e) => setLogLocal(l.id, { title: e.target.value })}
                  onBlur={(e) => saveLog(l, { title: e.target.value })} aria-label="할 일"
                  className={l.done ? "daily-done" : ""} style={{ margin: 0, flex: 1, minWidth: 0 }} />
                <button className="btn ghost sm" onClick={() => delLog(l)} aria-label="삭제" style={{ color: "var(--bad-text)" }}>✕</button>
              </div>
            ))}
            {!dayLogs.length && <div className="muted small">오늘 적은 일이 없습니다</div>}
          </Card>
        </div>
      )}
      {selEv && (
        <div className="modal-ovl" onClick={(e) => { if (e.target === e.currentTarget) setSelEv(null); }}>
          <div className="modal" style={{ width: 460, maxWidth: "94%" }} data-testid="dash-ev-modal">
            <div className="modal-h"><b>{selEv.recurring ? "🔁 " : ""}{selEv.title}</b><button className="btn ghost sm" onClick={() => setSelEv(null)}>✕</button></div>
            <div className="modal-b">
              <table className="metatbl"><tbody>
                <tr><th>일시</th><td>{selEv.date}{selEv.end_date && selEv.end_date !== selEv.date ? ` ~ ${selEv.end_date}` : ""}{selEv.time ? ` · ${selEv.time}` : ""}</td></tr>
                {selEv.type && <tr><th>유형</th><td>{selEv.type}</td></tr>}
                {selEv.repeat && selEv.repeat !== "없음" && <tr><th>반복</th><td>{selEv.repeat}{selEv.until ? ` (~${selEv.until})` : ""}</td></tr>}
                {selEv.attendees?.length ? <tr><th>참석</th><td>{selEv.attendees.map((uid: string) => dirName(uid)).join(", ")}</td></tr> : null}
                {selEv.link && <tr><th>링크</th><td><a className="lnk" href={selEv.link} target="_blank" rel="noreferrer">{selEv.link}</a></td></tr>}
              </tbody></table>
              {selEv.detail && <div style={{ marginTop: 10, lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: richHtml(selEv.detail) }} />}
            </div>
            <div className="modal-f"><button className="btn ghost" onClick={() => { setSelEv(null); nav("/calendar"); }}>캘린더에서 보기</button><button className="btn primary" onClick={() => setSelEv(null)}>닫기</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
