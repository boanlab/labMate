import { useEffect, useRef, useState } from "react";
import { todayKST } from "../lib/date";
import { useSearchParams } from "react-router-dom";
import { api, apiError } from "../api/client";
import { confirmDialog, alertDialog, promptDialog } from "../ui/dialog";
import { useAuth } from "../auth/AuthContext";
import { PageHeader, Card, Chips, statusClass } from "../ui/kit";
import { Gauge, HBars } from "../ui/Charts";
import { useConfig, names } from "../api/config";
import HtmlEditor from "../ui/HtmlEditorLazy";

interface TFile { name: string; url: string; }

interface Project {
  id: string; kind: string; code: string; name: string; category: string; status: string;
  agency: string; program: string; agreement_no: string; goals: Record<string, number>;
  start: string | null; end: string | null; desc: string; lead_id: string; pm_id: string;
  members: string[]; meta: Record<string, any>;
}
interface Task { id: string; title: string; by_id?: string; assignee_id: string; status: string; start: string | null; due: string | null; done_date?: string | null; body: string; link?: string; files?: TFile[]; }
interface Pub { kind: string; project_id: string; scope: string; index_type: string; index_grade: string; funding: string; }
// 과제 성과 집계 조건 — project_id 연결 또는 사사에 과제 코드 포함
function pubFundsProject(u: Pub, p: Project): boolean {
  if (u.project_id === p.id) return true;
  if (!p.code) return false;
  return (u.funding || "").split(/[,;]/).map((s) => s.trim()).includes(p.code);
}
// 다중 사사 1/n 지분 카운트
function pubShare(u: Pub): number {
  const n = (u.funding || "").split(/[,;]/).map((s) => s.trim()).filter(Boolean).length;
  return n > 1 ? 1 / n : 1;
}

const ACT_CATS_FB = ["과제", "연구", "세미나", "인프라", "기타"];
const GOAL_INDICATORS = ["SCI", "KCI", "국제학술대회", "국내학술대회", "국내특허", "국외특허", "SW등록", "기술문서"];
// 상태는 기간으로 자동 정의 — 시작 전: 예정 / 기간 중: 진행 중 / 종료 후: 완료
function autoStatus(start: string, end: string): string {
  const today = todayKST();
  if (start && today < start) return "예정";
  if (end && today > end) return "완료";
  return "진행 중";
}
// 연구과제 상태는 해당 연도 기간으로 산정(미입력 시 총 과제기간 폴백)
function grantAutoStatus(yearStart: string, yearEnd: string, start: string, end: string): string {
  if (yearStart || yearEnd) return autoStatus(yearStart, yearEnd);
  return autoStatus(start, end);
}
// 구성원 선택 기준 기간 — 연구과제는 해당 연도 기간(폴백 총기간), 프로젝트는 총기간
function formPeriod(form: any, isGrant: boolean): [string, string] {
  if (isGrant && (form.year_start || form.year_end)) return [form.year_start, form.year_end];
  return [form.start, form.end];
}
// 구성원 선택: 기간과 재직기간이 겹치는 사람만(기간 미정이면 활성 구성원만)
function memberInProjectPeriod(u: any, start: string, end: string): boolean {
  if (!start && !end) return u.active !== false;
  const jd = u.join_date || "", xd = u.exit_date || "";
  if (end && jd && jd > end) return false;
  if (start && xd && xd < start) return false;
  return true;
}
const STC: Record<string, string> = { "예정": "#9aa3ad", "진행": "#3f5d7d", "완료": "#2e9e6b" };
const won = (x: any) => { const n = Number(String(x ?? "").replace(/[^0-9.]/g, "")); return n ? n.toLocaleString() : ""; };
const fmtWon = (v: string) => { const n = String(v).replace(/[^0-9]/g, ""); return n ? Number(n).toLocaleString() : ""; };

function pubMetric(p: Pub): string {
  if (p.kind === "논문") { const ix = p.index_grade || p.index_type; return /SCI|SSCI|SCOPUS/i.test(ix) ? "SCI" : "KCI"; }
  if (p.kind === "학술대회") return p.scope === "국외" ? "국제학술대회" : "국내학술대회";
  if (p.kind === "특허") return p.scope === "국외" ? "국외특허" : "국내특허";
  return p.kind;
}

// 모듈 레벨 정의 — 컴포넌트 내부면 매 렌더 새 타입으로 input 포커스 풀림
const Field = ({ label, children, full, style }: any) => <div style={{ ...(full ? { gridColumn: "1 / -1" } : {}), ...style }}><label>{label}</label>{children}</div>;
const KV = ({ k, v }: { k: string; v: any }) => <><div className="muted small" style={{ marginTop: 8 }}>{k}</div><div>{v || "—"}</div></>;

export default function Projects({ kind = "grant" }: { kind?: "grant" | "activity" }) {
  const isGrant = kind === "grant";
  const LABEL = isGrant ? "연구과제" : "프로젝트";
  const { me } = useAuth();
  // 권한 — 생성: 연구과제=교수·위임/활동=구성원 · 수정삭제: 연구과제=교수·위임/활동=+책임자·담당자
  const canManageProject = !!me && (me.role === "prof" || !!me.delegated_admin);
  const canCreate = !!me && (isGrant ? canManageProject : me.role !== "admin");
  const canManageWork = !!me && (["prof", "staff"].includes(me.role) || !!me.delegated_admin);
  const [items, setItems] = useState<Project[]>([]);
  const [pubs, setPubs] = useState<Pub[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [open, setOpen] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [taskOpen, setTaskOpen] = useState<Task | null>(null);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState("");
  const [taskForm, setTaskForm] = useState<any | null>(null);
  const [allInfo, setAllInfo] = useState(false);
  const [filter, setFilter] = useState("진행 중");
  const [taskBody, setTaskBody] = useState("");
  const kanbanRef = useRef<HTMLDivElement>(null);
  const [kbMax, setKbMax] = useState(420);
  const AGENCIES = names(useConfig("agencies", ["NRF", "IITP", "KEIT", "KIAT", "지자체", "교내", "기타"]));
  const ACT_CATS = useConfig<string[]>("project_types", ACT_CATS_FB);

  const emptyForm = {
    code: "", name: "", category: isGrant ? "과제" : "연구", status: "진행 중", agency: "NRF", program: "",
    start: "", end: "", pm_id: "",
    year_start: "", year_end: "", host_org: "", host_pi: "", partner_orgs: "", partner_pis: "",
    budget_total: "", budget_year: "", ack_ko: "", ack_en: "", link: "", extra: "", desc: "", payroll_pool: "",
    goals: {} as Record<string, number>, members: [] as string[],
  };
  const [form, setForm] = useState(emptyForm);

  const profUser = users.find((u) => u.role === "prof");
  const uname = (id: string) => users.find((u) => u.id === id)?.name || (id ? id.slice(0, 6) : "미지정");

  async function load() {
    try {
      setItems((await api.get<Project[]>(`/projects/projects?kind=${kind}`)).data);
      setPubs((await api.get<Pub[]>("/projects/publications")).data);
      api.get<any[]>("/members/users").then((r) => setUsers(r.data)).catch(() => {});
    } catch (e) { setErr(apiError(e)); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [kind]);

  // 칸반 높이를 창 하단까지 맞춤 — 안쪽 컬럼 스크롤만 남기고 페이지 스크롤은 없앰
  useEffect(() => {
    let r1 = 0, r2 = 0;
    function fit() {
      if (!kanbanRef.current) return;
      const top = kanbanRef.current.getBoundingClientRect().top;
      setKbMax(Math.max(140, Math.round(window.innerHeight - top - 108)));
      const scroller = kanbanRef.current.closest(".content") as HTMLElement | null;
      r1 = requestAnimationFrame(() => {
        r2 = requestAnimationFrame(() => {
          if (!scroller) return;
          const overflow = scroller.scrollHeight - scroller.clientHeight;
          if (overflow > 1) setKbMax((h) => Math.max(140, h - overflow - 2));
        });
      });
    }
    fit();
    const t = setTimeout(fit, 200);
    window.addEventListener("resize", fit);
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); clearTimeout(t); window.removeEventListener("resize", fit); };
  }, [open, tasks]);

  const [sp, setSp] = useSearchParams();
  useEffect(() => {
    const oid = sp.get("open");
    if (oid && items.length) {
      const p = items.find((x) => x.id === oid);
      if (p) { openDetail(p); setSp({}, { replace: true }); }
    }
  }, [sp, items]);

  async function openDetail(p: Project) {
    setOpen(p); setAllInfo(false);
    try {
      setTasks((await api.get<Task[]>(`/projects/projects/${p.id}/tasks`)).data);
    } catch (e) { setErr(apiError(e)); }
  }

  function fillForm(p: Project) {
    const mm = p.meta || {};
    setForm({
      code: p.code, name: p.name, category: p.category, status: p.status || "진행 중", agency: p.agency || "NRF", program: p.program || "",
      start: p.start || "", end: p.end || "", pm_id: p.pm_id || "",
      year_start: mm.year_start || "", year_end: mm.year_end || "", host_org: mm.host_org || "", host_pi: mm.host_pi || "",
      partner_orgs: mm.partner_orgs || "", partner_pis: mm.partner_pis || "",
      budget_total: fmtWon(mm.budget_total || ""), budget_year: fmtWon(mm.budget_year || ""),
      ack_ko: mm.ack_ko || "", ack_en: mm.ack_en || "", payroll_pool: mm.payroll_pool || "", link: mm.link || "", extra: mm.extra || "", desc: p.desc || "",
      goals: p.goals || {}, members: p.members || [],
    });
  }
  function startEdit(p: Project) { fillForm(p); setEditId(p.id); setOpen(null); setAdding(true); }
  function openNew() { setEditId(""); setForm(emptyForm); setAdding(true); }
  function toggleMember(uid: string) { setForm((f) => ({ ...f, members: f.members.includes(uid) ? f.members.filter((x) => x !== uid) : [...f.members, uid] })); }

  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    const piId = profUser?.id || "";
    const payload = isGrant ? {
      kind: "grant", code: form.code, name: form.name, category: "과제", status: grantAutoStatus(form.year_start, form.year_end, form.start, form.end),
      agency: form.agency, program: form.program,
      start: form.start || null, end: form.end || null,
      lead_id: piId, pm_id: form.pm_id, members: form.members,
      goals: Object.fromEntries(Object.entries(form.goals).filter(([, v]) => Number(v) > 0)),
      meta: {
        year_start: form.year_start, year_end: form.year_end,
        host_org: form.host_org, host_pi: form.host_pi,
        partner_orgs: form.partner_orgs, partner_pis: form.partner_pis,
        budget_total: form.budget_total, budget_year: form.budget_year,
        ack_ko: form.ack_ko, ack_en: form.ack_en, payroll_pool: form.payroll_pool,
      },
    } : {
      kind: "activity", code: form.code, name: form.name, category: form.category, status: autoStatus(form.start, form.end),
      start: form.start || null, end: form.end || null,
      lead_id: piId, pm_id: form.pm_id, members: form.members, desc: form.desc,
      meta: { link: form.link, extra: form.extra },
    };
    try {
      if (editId) await api.patch(`/projects/projects/${editId}`, payload);
      else {
        const r = await api.post<Project>("/projects/projects", payload);
        if (isGrant && r.data?.id) { try { await api.post(`/funds/budgets/ensure/${r.data.id}`); } catch { /* 예산 자동생성 실패 무시 */ } }
      }
      setAdding(false); setEditId(""); setForm(emptyForm); load();
    } catch (e) { setErr(apiError(e)); }
  }
  async function delDetail() {
    if (!open) return;
    const typed = await promptDialog(`이 ${LABEL}을(를) 삭제하려면 관리코드 "${open.code}" 를 입력하세요. (실수 방지)`);
    if (typed === null) return;
    if (typed.trim() !== open.code) { await alertDialog("관리코드가 일치하지 않아 삭제가 취소되었습니다."); return; }
    try { await api.delete(`/projects/projects/${open.id}`); setOpen(null); load(); } catch (e) { setErr(apiError(e)); }
  }
  async function reloadTasks() { if (open) try { setTasks((await api.get<Task[]>(`/projects/projects/${open.id}/tasks`)).data); } catch { /* */ } }
  function newTask() { setTaskOpen(null); setTaskForm({ title: "", assignee_id: "", status: "예정", start: "", due: "", done_date: "", link: "", files: [] }); setTaskBody(""); }
  function editTask(t: Task) { setTaskOpen(null); setTaskForm({ id: t.id, title: t.title, assignee_id: t.assignee_id || "", status: t.status, start: t.start || "", due: t.due || "", done_date: t.done_date || "", link: t.link || "", files: t.files || [] }); setTaskBody(t.body || ""); }
  async function uploadTaskFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const fl = e.target.files; if (!fl || !fl.length) return;
    const fd = new FormData(); Array.from(fl).forEach((f) => fd.append("files", f));
    try {
      const r = await api.post<TFile[]>("/projects/uploads", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setTaskForm((tf: any) => ({ ...tf, files: [...(tf.files || []), ...r.data] }));
    } catch (err) { setErr(apiError(err)); }
    e.target.value = "";
  }
  async function saveTask(e: React.FormEvent) {
    e.preventDefault(); if (!open || !taskForm) return;
    // 실제 마감일: 입력값 우선, 미입력+완료면 오늘 자동
    const done_date = (taskForm.done_date || (taskForm.status === "완료" ? todayKST() : "")) || null;
    const payload = { title: taskForm.title, assignee_id: taskForm.assignee_id, status: taskForm.status, start: taskForm.start || null, due: taskForm.due || null, done_date, body: taskBody, link: taskForm.link, files: taskForm.files || [] };
    try {
      if (taskForm.id) await api.patch(`/projects/tasks/${taskForm.id}`, payload);
      else await api.post(`/projects/projects/${open.id}/tasks`, payload);
      setTaskForm(null); reloadTasks();
    } catch (e) { setErr(apiError(e)); }
  }
  async function delTask(t: Task) {
    if (!await confirmDialog("이 업무를 삭제할까요?")) return;
    try { await api.delete(`/projects/tasks/${t.id}`); setTaskOpen(null); reloadTasks(); } catch (e) { setErr(apiError(e)); }
  }
  async function moveTask(t: Task, status: string) {
    if (!t || t.status === status) return;
    // 낙관적 업데이트 후 서버 반영 — 완료 이동 시 실제 마감일 자동 기록
    const done_date = status === "완료" ? (t.done_date || todayKST()) : (t.done_date || null);
    setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, status, done_date } : x)));
    try {
      await api.patch(`/projects/tasks/${t.id}`, { title: t.title, assignee_id: t.assignee_id, status, start: t.start || null, due: t.due || null, done_date, body: t.body || "", link: t.link || "", files: t.files || [] });
      reloadTasks();
    } catch (e) { setErr(apiError(e)); reloadTasks(); }
  }

  function goalBars(p: Project) {
    const g = p.goals || {};
    const counts: Record<string, number> = {};
    pubs.filter((u) => pubFundsProject(u, p)).forEach((u) => { const mk = pubMetric(u); counts[mk] = (counts[mk] || 0) + pubShare(u); });
    // 목표 미설정 지표도 실적 있으면 목표 0으로 표시(목표+실적 지표 합집합)
    const keys = Array.from(new Set([...Object.keys(g), ...Object.keys(counts)]));
    return keys.map((k) => {
      const tg = g[k] || 0, ac = counts[k] || 0; const av = +ac.toFixed(1);
      const pct = tg ? Math.round(Math.min(ac, tg) / tg * 100) : (ac > 0 ? 100 : 0);
      return { label: k, pct, text: `달성 ${av} / 목표 ${tg}${tg > 0 && ac >= tg ? " ✓" : ""}`, color: tg === 0 ? "#3a9b9b" : ac >= tg ? "#2e9e6b" : pct >= 50 ? "#3f5d7d" : "#c2891b" };
    });
  }
  const progress = (p: Project) => { const ts = tasks; if (!ts.length) return 0; return Math.round(ts.filter((t) => t.status === "완료").length / ts.length * 100); };
  const canTasks = canManageWork || (!!open && !!me && [open.lead_id, open.pm_id, ...(open.members || [])].includes(me.id));
  // 수정·삭제·이동: 교수·행정·위임·책임자·담당자, 참여 연구원은 본인이 추가한 업무만
  const canEditTask = (t: Task) => canManageWork || (!!open && !!me && [open.lead_id, open.pm_id].includes(me.id)) || t.by_id === me?.id;
  // 수정·삭제: 연구과제=교수·위임 / 활동=교수·위임·책임자·담당자
  const canEdit = canManageProject || (!isGrant && !!open && !!me && [open.lead_id, open.pm_id].includes(me.id));
  // 상태 산정: 연구과제=해당 연도 기간 / 활동=총 기간
  const liveStatus = (p: Project) => isGrant
    ? grantAutoStatus(p.meta?.year_start || "", p.meta?.year_end || "", p.start || "", p.end || "")
    : autoStatus(p.start || "", p.end || "");
  const shown = filter === "전체" ? items : items.filter((p) => liveStatus(p) === filter);
  // 담당자·구성원 후보 — 기간 내 재직자. 수정 시 기존 담당자는 후보에서 빠져도 유지
  const memberOpts = users.filter((u) => u.role !== "admin" && memberInProjectPeriod(u, ...formPeriod(form, isGrant)));
  const pmOpts = (form.pm_id && !memberOpts.some((u) => u.id === form.pm_id) && users.find((u) => u.id === form.pm_id))
    ? [users.find((u) => u.id === form.pm_id)!, ...memberOpts] : memberOpts;

  if (open) {
    const cols = ["예정", "진행", "완료"];
    const m = open.meta || {};
    return (
      <div data-testid="page-project-detail">
        <PageHeader crumb={`업무 › ${LABEL}`} title={`${open.code} · ${open.name}`} action={
          <span style={{ display: "flex", gap: 6 }}>
            {canEdit && <button className="btn ghost" data-testid="proj-edit" onClick={() => startEdit(open)}>수정</button>}
            <button className="btn ghost" data-testid="proj-back" onClick={() => setOpen(null)}>목록</button>
          </span>
        } />
        {err && <div className="form-err">{err}</div>}

        <div className={isGrant ? "pdgrid" : ""} style={{ marginBottom: 14 }}>
          <Card title={`${LABEL} 정보`} extra={<a style={{ cursor: "pointer", fontSize: 12 }} data-testid="proj-allinfo" onClick={() => setAllInfo(true)}>모두 보기 →</a>}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {isGrant ? <>
                  <KV k="전담기관 / 분류" v={<><b>{open.agency || "—"}</b> · {open.category}</>} />
                  <KV k="해당 연도 기간" v={(m.year_start || m.year_end) ? `${m.year_start || "—"} ~ ${m.year_end || "—"}` : "—"} />
                  <KV k="책임자(PI) / 실무 담당자" v={`${uname(open.lead_id)} · ${uname(open.pm_id)}`} />
                </> : <>
                  <KV k="분류" v={open.category} />
                  <KV k="기간" v={`${open.start || "—"} ~ ${open.end || "—"}`} />
                  <KV k="담당자" v={uname(open.pm_id)} />
                  <KV k="참여 구성원" v={(open.members && open.members.length) ? open.members.map(uname).join(", ") : "—"} />
                </>}
              </div>
              <Gauge pct={progress(open)} label="진척률" size={92} />
            </div>
            {isGrant && (m.ack_ko || m.ack_en) && (
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--line2)" }}>
                {m.ack_ko && <>
                  <div className="muted small">국문 사사</div>
                  <div className="small" style={{ marginTop: 3, lineHeight: 1.55, whiteSpace: "pre-wrap" }} data-testid="proj-detail-ack-ko">{m.ack_ko}</div>
                </>}
                {m.ack_en && <>
                  <div className="muted small" style={{ marginTop: m.ack_ko ? 8 : 0 }}>영문 사사</div>
                  <div className="small" style={{ marginTop: 3, lineHeight: 1.55, whiteSpace: "pre-wrap" }} data-testid="proj-detail-ack-en">{m.ack_en}</div>
                </>}
              </div>
            )}
          </Card>
          {isGrant && (
            <Card title="연구성과 목표 대비 달성" testid="proj-goalcard">
              {goalBars(open).length ? <HBars bars={goalBars(open)} /> : <div className="muted">성과목표 미설정</div>}
            </Card>
          )}
        </div>

        <Card title="세부 업무" extra={
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="pill">{tasks.length}건</span>
            {canTasks && <button className="btn primary sm" data-testid="task-add" onClick={newTask}>+ 업무 추가</button>}
          </span>
        }>
          <div className="kanban" data-testid="kanban" ref={kanbanRef}>
            {cols.map((st) => {
              const list = tasks.filter((t) => t.status === st);
              return (
                <div className={"kbcol" + (overCol === st ? " kbcol-over" : "")} key={st} style={{ ["--kc" as any]: STC[st] }}
                  onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverCol(st); } }}
                  onDragLeave={() => setOverCol((c) => (c === st ? null : c))}
                  onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain") || dragId; const t = tasks.find((x) => x.id === id); setOverCol(null); setDragId(null); if (t) moveTask(t, st); }}>
                  <div className="kbh"><span>{st}</span><span className="kbh-n">{list.length}</span></div>
                  <div style={{ maxHeight: kbMax, overflowY: "auto", marginRight: -4, paddingRight: 4 }}>
                    {list.map((t) => {
                      // 마감 경과 강조: 미완료+마감 경과, 또는 완료지만 실제 마감이 늦음
                      const late = t.status !== "완료" ? !!(t.due && t.due < todayKST()) : !!(t.done_date && t.due && t.done_date > t.due);
                      const canMove = canEditTask(t);
                      return (
                        <div className={"kbcard" + (late ? " late" : "") + (dragId === t.id ? " kbcard-drag" : "")} key={t.id}
                          style={{ ["--kc" as any]: STC[st], cursor: canMove ? "grab" : "pointer" }} data-testid={`task-${t.id}`}
                          draggable={canMove}
                          onDragStart={(e) => { setDragId(t.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", t.id); }}
                          onDragEnd={() => { setDragId(null); setOverCol(null); }}
                          onClick={() => setTaskOpen(t)}>
                          <div className="kbc-t">{t.title}</div>
                          <div className="kbc-m"><span>🗓 {t.due || "—"}{t.status === "완료" && t.done_date ? ` · ✅ ${t.done_date}` : ""}</span>{t.assignee_id && <span>· {uname(t.assignee_id)}</span>}</div>
                        </div>
                      );
                    })}
                    {!list.length && <div className="kbempty">{dragId ? "여기로 이동" : "업무 없음"}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {canEdit && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <button data-testid="proj-detail-del" onClick={delDetail}
              style={{ background: "none", border: "none", color: "var(--bad)", fontSize: 11.5, padding: "2px 4px", textDecoration: "underline", opacity: 0.8 }}>{LABEL} 삭제</button>
          </div>
        )}

        {taskOpen && (
          <div className="modal-ovl" onClick={(e) => { if (e.target === e.currentTarget) setTaskOpen(null); }}>
            <div className="modal" data-testid="task-modal" style={{ width: 840, maxWidth: "90%" }}>
              <div className="modal-h">
                <b>세부 업무</b>
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {canEditTask(taskOpen) && <>
                    <button className="btn ghost sm" data-testid="task-edit" onClick={() => editTask(taskOpen)}>수정</button>
                    <button className="btn ghost sm" data-testid="task-del" onClick={() => delTask(taskOpen)}>삭제</button>
                  </>}
                  <button className="btn ghost sm" onClick={() => setTaskOpen(null)}>✕</button>
                </span>
              </div>
              <div className="modal-b">
                <div style={{ fontWeight: 800, fontSize: 17, lineHeight: 1.3 }}>{taskOpen.title}</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 9, flexWrap: "wrap" }}>
                  <span className="badge" style={{ background: (STC[taskOpen.status] || "#5a6478") + "1f", color: STC[taskOpen.status] || "#5a6478" }}>{taskOpen.status}</span>
                  <span className="small"><span className="muted">담당</span> {uname(taskOpen.assignee_id)}</span>
                  <span className="small"><span className="muted">기간</span> {taskOpen.start || "—"} ~ {taskOpen.due || "—"}</span>
                  {taskOpen.done_date && <span className="small"><span className="muted">실제 마감</span> <b style={{ color: (taskOpen.due && taskOpen.done_date > taskOpen.due) ? "var(--bad)" : "inherit" }}>{taskOpen.done_date}</b></span>}
                  {taskOpen.status !== "완료" && taskOpen.due && taskOpen.due < todayKST() && <span className="badge s-bad">마감 초과</span>}
                </div>

                {taskOpen.link && (
                  <div style={{ marginTop: 14 }}>
                    <div className="muted small" style={{ marginBottom: 4 }}>링크</div>
                    <a className="lnk small" href={taskOpen.link} target="_blank" rel="noreferrer">🔗 {taskOpen.link}</a>
                  </div>
                )}

                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line2)" }}>
                  <div className="muted small" style={{ marginBottom: 6 }}>내용</div>
                  {taskOpen.body
                    ? <div style={{ fontSize: 13.5, lineHeight: 1.75 }} dangerouslySetInnerHTML={{ __html: taskOpen.body }} />
                    : <div className="muted small">등록된 내용이 없습니다</div>}
                </div>

                {!!(taskOpen.files && taskOpen.files.length) && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line2)" }}>
                    <div className="muted small" style={{ marginBottom: 6 }}>첨부파일 ({taskOpen.files.length})</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {taskOpen.files.map((f, i) => <a key={i} className="badge s-info" href={f.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", padding: "5px 10px" }}>📎 {f.name}</a>)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {taskForm && (
          <div className="modal-ovl" onClick={(e) => { if (e.target === e.currentTarget) setTaskForm(null); }}>
            <form className="modal" data-testid="task-form" onSubmit={saveTask} style={{ width: 960, maxWidth: "90%" }}>
              <div className="modal-h"><b>{taskForm.id ? "업무 수정" : "업무 추가"}</b><button type="button" className="btn ghost sm" onClick={() => setTaskForm(null)}>✕</button></div>
              <div className="modal-b">
                <label>제목</label>
                <input data-testid="tf-title" value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} required />
                <div className="grid2">
                  <div><label>상태</label><select value={taskForm.status} onChange={(e) => setTaskForm({ ...taskForm, status: e.target.value })}>{["예정", "진행", "완료"].map((s) => <option key={s}>{s}</option>)}</select></div>
                  <div><label>담당자</label><select value={taskForm.assignee_id} onChange={(e) => setTaskForm({ ...taskForm, assignee_id: e.target.value })}><option value="">미지정</option>{users.filter((u) => u.role !== "admin").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
                  <div><label>시작일</label><input type="date" min={open.start || undefined} max={taskForm.due || open.end || undefined} value={taskForm.start} onChange={(e) => setTaskForm({ ...taskForm, start: e.target.value })} /></div>
                  <div><label>마감일</label><input type="date" min={taskForm.start || open.start || undefined} max={open.end || undefined} value={taskForm.due} onChange={(e) => setTaskForm({ ...taskForm, due: e.target.value })} /></div>
                  <div><label>실제 마감일 <span className="muted small">(완료 시 자동)</span></label><input type="date" data-testid="tf-donedate" value={taskForm.done_date} onChange={(e) => setTaskForm({ ...taskForm, done_date: e.target.value })} /></div>
                </div>
                {(open.start || open.end) && <div className="muted small" style={{ marginTop: 2 }}>과제 기간: {open.start || "—"} ~ {open.end || "—"} 내로 지정</div>}
                <label>링크 (선택)</label>
                <input type="url" placeholder="https://…" value={taskForm.link} onChange={(e) => setTaskForm({ ...taskForm, link: e.target.value })} />
                <label>내용</label>
                <HtmlEditor value={taskBody} onChange={setTaskBody} testid="tf-body" minHeight={120} />
                <label>첨부파일 (선택)</label>
                <input type="file" multiple data-testid="tf-files" onChange={uploadTaskFiles} />
                {!!(taskForm.files && taskForm.files.length) && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                    {taskForm.files.map((f: TFile, i: number) => (
                      <span key={i} className="badge s-info">📎 {f.name}
                        <button type="button" onClick={() => setTaskForm((tf: any) => ({ ...tf, files: tf.files.filter((_: any, j: number) => j !== i) }))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", marginLeft: 4 }}>✕</button>
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                  <button className="btn primary" data-testid="tf-submit">{taskForm.id ? "저장" : "추가"}</button>
                  <button type="button" className="btn ghost" onClick={() => setTaskForm(null)}>취소</button>
                </div>
              </div>
            </form>
          </div>
        )}

        {allInfo && (
          <div className="modal-ovl" onClick={(e) => { if (e.target === e.currentTarget) setAllInfo(false); }}>
            <div className="modal" data-testid="proj-info-modal" style={{ maxWidth: 580 }}>
              <div className="modal-h"><b>{open.code} · 전체 정보</b><button className="btn ghost sm" onClick={() => setAllInfo(false)}>✕</button></div>
              <div className="modal-b">
                {!isGrant ? <>
                  <KV k="분류" v={open.category} />
                  <KV k="기간" v={`${open.start || "—"} ~ ${open.end || "—"}`} />
                  <KV k="담당자" v={uname(open.pm_id)} />
                  <KV k="참여 구성원" v={(open.members && open.members.length) ? open.members.map(uname).join(", ") : "—"} />
                  <KV k="상태" v={liveStatus(open)} />
                  <KV k="설명" v={open.desc ? <span style={{ whiteSpace: "pre-wrap" }}>{open.desc}</span> : "—"} />
                </> : <>
                <KV k="전담기관 / 분류" v={<><b>{open.agency || "—"}</b> · {open.category}</>} />
                <KV k="사업명 / 협약번호" v={`${open.program || "—"}${open.agreement_no ? ` · ${open.agreement_no}` : ""}`} />
                <KV k="총 과제 기간" v={`${open.start || "—"} ~ ${open.end || "—"}`} />
                <KV k="해당 연도 기간" v={(m.year_start || m.year_end) ? `${m.year_start || "—"} ~ ${m.year_end || "—"}` : "—"} />
                <KV k="주관기관 / 책임자" v={`${m.host_org || "—"}${m.host_pi ? ` · ${m.host_pi}` : ""}`} />
                <KV k="참여기관 / 책임자" v={(m.partner_orgs || m.partner_pis) ? `${m.partner_orgs || "—"}${m.partner_pis ? ` · ${m.partner_pis}` : ""}` : "—"} />
                <KV k="총 연구비 / 해당연도" v={`${won(m.budget_total) ? won(m.budget_total) + "원" : "—"} / ${won(m.budget_year) ? won(m.budget_year) + "원" : "—"}`} />
                <KV k="책임자(PI) / 실무 담당자" v={`${uname(open.lead_id)} · ${uname(open.pm_id)}`} />
                <KV k="참여 연구원" v={(open.members && open.members.length) ? open.members.map(uname).join(", ") : "—"} />
                <KV k="상태" v={liveStatus(open)} />
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--line2)" }}>
                  <div className="muted small">국문 사사</div>
                  <div className="small" style={{ marginTop: 3, lineHeight: 1.55 }} data-testid="proj-ack">{m.ack_ko || "-"}</div>
                  <div className="muted small" style={{ marginTop: 8 }}>영문 사사</div>
                  <div className="small" style={{ marginTop: 3, lineHeight: 1.55 }} data-testid="proj-ack-en">{m.ack_en || "-"}</div>
                </div>
                </>}
              </div>
            </div>
          </div>
        )}

      </div>
    );
  }

  return (
    <div data-testid="page-projects">
      <PageHeader crumb={`업무 › ${LABEL}`} title={LABEL} action={
        canCreate ? <button className="btn primary" data-testid="project-add-open" onClick={() => (adding ? (setAdding(false), setEditId("")) : openNew())}>+ {LABEL} 추가</button> : undefined
      } />
      {err && <div className="form-err" data-testid="project-error">{err}</div>}
      {adding && (
        <form className="card" onSubmit={save} data-testid="project-form">
          {editId && <div className="io" style={{ margin: "12px 14px 0" }}>수정 중 — 관리코드 <b>{form.code}</b></div>}
          {isGrant ? (
            <div className="bd grid2">
              <Field label="관리코드"><input data-testid="p-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
              <Field label="과제명"><input data-testid="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="전담기관"><select data-testid="p-agency" value={form.agency} onChange={(e) => setForm({ ...form, agency: e.target.value })}>{AGENCIES.map((a) => <option key={a}>{a}</option>)}</select></Field>
              <Field label="사업명"><input value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })} /></Field>
              <Field label="총 과제기간 (시작)"><input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></Field>
              <Field label="총 과제기간 (종료)"><input type="date" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></Field>
              <Field label="해당 연도 기간 (시작)"><input type="date" value={form.year_start} onChange={(e) => setForm({ ...form, year_start: e.target.value })} /></Field>
              <Field label="해당 연도 기간 (종료)"><input type="date" value={form.year_end} onChange={(e) => setForm({ ...form, year_end: e.target.value })} /></Field>
              <Field label="주관기관"><input value={form.host_org} onChange={(e) => setForm({ ...form, host_org: e.target.value })} /></Field>
              <Field label="주관기관 연구책임자"><input value={form.host_pi} onChange={(e) => setForm({ ...form, host_pi: e.target.value })} /></Field>
              <Field label="참여기관 (선택)"><input value={form.partner_orgs} onChange={(e) => setForm({ ...form, partner_orgs: e.target.value })} /></Field>
              <Field label="참여기관 연구책임자 (선택)"><input value={form.partner_pis} onChange={(e) => setForm({ ...form, partner_pis: e.target.value })} /></Field>
              <Field label="총 연구비 (원)"><input inputMode="numeric" value={form.budget_total} onChange={(e) => setForm({ ...form, budget_total: fmtWon(e.target.value) })} /></Field>
              <Field label="해당 연도 연구비 (원)"><input inputMode="numeric" value={form.budget_year} onChange={(e) => setForm({ ...form, budget_year: fmtWon(e.target.value) })} /></Field>
              <Field label="프로젝트 책임자(PI)"><div style={{ padding: "9px 0" }}>{profUser?.name || "지도교수"} <span className="muted small">· 지도교수 자동 지정</span></div></Field>
              <Field label="실무 담당자"><select data-testid="p-pm" value={form.pm_id} onChange={(e) => setForm({ ...form, pm_id: e.target.value })}><option value="">선택</option>{pmOpts.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
              <Field label="통합학생인건비 그룹 (선택)" full><input data-testid="p-pool" value={form.payroll_pool} onChange={(e) => setForm({ ...form, payroll_pool: e.target.value })} placeholder="예: 2025-통합A · 같은 값을 가진 과제끼리 학생인건비 예산을 합산" /></Field>
              <Field label={`참여 연구원${form.members.length ? ` · ${form.members.length}명` : ""}`} full>
                <div className="fchips" data-testid="p-members">
                  {memberOpts.map((u) => <button type="button" key={u.id} className={"chip" + (form.members.includes(u.id) ? " on" : "")} onClick={() => toggleMember(u.id)}>{u.name}</button>)}
                </div>
              </Field>
              {editId && <Field label="연구성과 목표 (지표별 목표 건수)" full style={{ marginTop: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "4px 14px" }}>
                  {GOAL_INDICATORS.map((ind) => (
                    <div key={ind} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="small muted" style={{ width: 82, flexShrink: 0 }}>{ind}</span>
                      <input type="number" min={0} style={{ width: 62, margin: 0 }} value={form.goals[ind] ?? ""} onChange={(e) => setForm({ ...form, goals: { ...form.goals, [ind]: Number(e.target.value) } })} />
                    </div>
                  ))}
                </div>
              </Field>}
              {editId && <Field label="국문 사사 (선택)" full><textarea value={form.ack_ko} onChange={(e) => setForm({ ...form, ack_ko: e.target.value })} style={{ minHeight: 54 }} /></Field>}
              {editId && <Field label="영문 사사 (선택)" full><textarea value={form.ack_en} onChange={(e) => setForm({ ...form, ack_en: e.target.value })} style={{ minHeight: 54 }} /></Field>}
            </div>
          ) : (
            <div className="bd grid2">
              <Field label="관리코드"><input data-testid="p-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
              <Field label="분류"><select data-testid="p-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{ACT_CATS.filter((c) => c !== "과제").map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="프로젝트명"><input data-testid="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="담당자"><select data-testid="p-pm" value={form.pm_id} onChange={(e) => setForm({ ...form, pm_id: e.target.value })}><option value="">선택</option>{pmOpts.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
              <Field label="시작일"><input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></Field>
              <Field label="종료일 (선택)"><input type="date" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></Field>
              <Field label={`구성원 선택${form.members.length ? ` · ${form.members.length}명` : ""}`} full>
                <div className="fchips" data-testid="p-members">
                  {memberOpts.map((u) => <button type="button" key={u.id} className={"chip" + (form.members.includes(u.id) ? " on" : "")} onClick={() => toggleMember(u.id)}>{u.name}</button>)}
                </div>
              </Field>
              <Field label="설명" full><textarea value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} style={{ minHeight: 60 }} /></Field>
            </div>
          )}
          <div className="bd" style={{ display: "flex", gap: 6 }}>
            <button className="btn primary" data-testid="project-add-submit">{editId ? "저장" : "추가"}</button>
            <button type="button" className="btn ghost" onClick={() => { setAdding(false); setEditId(""); setForm(emptyForm); }}>취소</button>
          </div>
        </form>
      )}
      <div style={{ marginBottom: 10 }}>
        <Chips testid="proj-filter" value={filter} onChange={setFilter}
          items={["진행 중", "예정", "완료", "전체"].map((f) => ({ key: f, count: f === "전체" ? items.length : items.filter((p) => liveStatus(p) === f).length }))} />
      </div>
      <div className="card scroll">
        <table className="tbl" data-testid="project-table">
          {isGrant
            ? <thead><tr><th>관리코드</th><th>과제명</th><th>전담기관</th><th>사업명</th><th>기간</th><th>상태</th></tr></thead>
            : <thead><tr><th>관리코드</th><th>명칭</th><th>분류</th><th>담당자</th><th>기간</th><th>상태</th></tr></thead>}
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => openDetail(p)}>
                <td><a style={{ cursor: "pointer", fontWeight: 700 }} data-testid={`proj-open-${p.code}`} onClick={(e) => { e.stopPropagation(); openDetail(p); }}>{p.code}</a></td>
                <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }} title={p.name}>{p.name}</td>
                {isGrant ? <><td>{p.agency || "—"}</td><td style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }} title={p.program || ""}>{p.program || "—"}</td></> : <><td>{p.category}</td><td>{uname(p.pm_id)}</td></>}
                <td className="small muted">{p.start || "—"}{p.end ? ` ~ ${p.end}` : ""}</td>
                <td><span className={statusClass(liveStatus(p))}>{liveStatus(p)}</span></td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 16 }}>{filter === "전체" ? `${LABEL} 없음` : `${filter} ${LABEL} 없음`}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
