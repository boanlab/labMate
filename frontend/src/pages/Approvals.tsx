import { useEffect, useState, useId } from "react";
import { Pager } from "../ui/pageTable";
import { richHtml } from "../ui/richHtml";
import { api, apiError } from "../api/client";
import { confirmDialog } from "../ui/dialog";
import { confirmDiscard } from "../ui/kit";
import { useAuth } from "../auth/AuthContext";
import { useConfig, names } from "../api/config";
import HtmlEditor from "../ui/HtmlEditorLazy";
import { printDoc } from "../ui/pdf";
import { todayKST, dateKST } from "../lib/date";

interface Step { uid: string; decision: string | null; at: string; comment?: string; }
interface Appr { id: string; doc_no: string; type: string; title: string; by_id: string; project_id: string; content: string; steps: Step[]; status: string; source_ref?: string; created_at?: string; }
interface Project { id: string; code: string; name: string; kind: string; start?: string | null; end?: string | null; meta?: Record<string, any>; lead_id?: string; pm_id?: string; members?: string[]; }
// 진행 중 여부 — 연구과제는 해당 연도 기간(미입력 시 총 기간), 프로젝트는 총 기간 기준.
function isOngoing(p: Project): boolean {
  const t = todayKST();
  const m = p.meta || {};
  const [s, e] = (p.kind === "grant" && (m.year_start || m.year_end)) ? [m.year_start || "", m.year_end || ""] : [p.start || "", p.end || ""];
  if (s && t < s) return false;   // 예정
  if (e && t > e) return false;   // 완료
  return true;                    // 진행 중
}

const SBADGE: Record<string, string> = { "임시저장": "s-wait", "진행": "s-info", "승인": "s-ok", "반려": "s-bad", "회수": "s-mute" };
// 금액·산출내역은 본문 양식에 포함(별도 필드 없음), 예산 차감은 연구비집행에서 처리
const TEMPLATES_FB: Record<string, string> = {
  "주간보고": "<h3>주간 업무 보고</h3><ul><li>금주 수행 내용: </li><li>진척도 / 이슈: </li><li>차주 계획: </li></ul>",
  "월간보고": "<h3>월간 업무 보고</h3><ul><li>주요 성과: </li><li>실적 대비 계획: </li><li>다음 달 계획: </li></ul>",
  "일반보고": "<h3>보고</h3><p>내용을 입력하세요.</p>",
  "구매": "<h3>구매 품의</h3><ul><li>품목 / 규격: </li><li>수량: </li><li>단가 / 금액: </li><li>차감 비목: </li><li>구매 사유: </li><li>희망 납기: </li></ul>",
  "지출결의": "<h3>지출 결의</h3><ul><li>지출 항목: </li><li>금액(산출내역): </li><li>차감 비목: </li><li>지출 사유: </li><li>증빙: </li></ul>",
  "출장": "<h3>출장 신청</h3><ul><li>기간: </li><li>출장지: </li><li>목적: </li><li>예상 경비(산출내역): </li><li>동행자: </li></ul>",
};

function currentIdx(steps: Step[]): number {
  for (let i = 0; i < steps.length; i++) {
    if (!steps[i].decision) return i;
    if (steps[i].decision === "반려") return -1;
  }
  return -1;
}

export default function Approvals() {
  const uid = useId();   // 라벨-입력 연결용 고유 접두사
  const { me } = useAuth();
  const isApprover = !!me && (["prof", "staff", "admin"].includes(me.role) || !!me.delegated_admin);
  const TYPES = names(useConfig<any[]>("approval_types", []));
  const TEMPLATES = useConfig<Record<string, string>>("approval_templates", TEMPLATES_FB);
  const [mine, setMine] = useState<Appr[]>([]);
  const [inbox, setInbox] = useState<Appr[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<null | { id?: string; resubmit?: boolean; status?: string }>(null);
  const [viewing, setViewing] = useState<Appr | null>(null);
  const [inPage, setInPage] = useState(0);
  const [minePage, setMinePage] = useState(0);
  const [reject, setReject] = useState<null | Appr>(null);
  const [rejectMsg, setRejectMsg] = useState("");
  const [addApprover, setAddApprover] = useState("");
  const [form, setForm] = useState({ type: "구매", title: "", project_id: "", approver_ids: [] as string[] });
  const [body, setBody] = useState("");

  const approverPool = users.filter((u) => ["prof", "staff"].includes(u.role) || u.delegated_admin || u.role === "admin");
  const uname = (id: string) => users.find((u) => u.id === id)?.name || "?";
  const ROLE_KO: Record<string, string> = { prof: "교수", staff: "행정", admin: "관리", phd: "박사과정", master: "석사과정", under: "학사과정" };
  const urole = (id: string) => { const r = users.find((u) => u.id === id)?.role; return ROLE_KO[r] || r; };
  const projName = (id: string) => projects.find((p) => p.id === id)?.name || "-";
  // 기안 대상: 본인 PI·담당·참여 진행 중 과제(편집 중 기존 선택 유지)
  const mineProj = (p: Project) => !!me && (p.lead_id === me.id || p.pm_id === me.id || (p.members || []).includes(me.id));
  const selectableProj = (p: Project) => (isOngoing(p) && mineProj(p)) || p.id === form.project_id;

  async function load() {
    try {
      setMine((await api.get<Appr[]>("/boards/approvals/mine")).data);
      setUsers((await api.get<any[]>("/members/users")).data);
      try {
        const gr = (await api.get<Project[]>("/projects/projects?kind=grant")).data;
        const ac = (await api.get<Project[]>("/projects/projects?kind=activity")).data;
        setProjects([...gr.map((p) => ({ ...p, kind: "grant" })), ...ac.map((p) => ({ ...p, kind: "activity" }))]);
      } catch { /* optional */ }
      if (isApprover) setInbox((await api.get<Appr[]>("/boards/approvals/inbox")).data);
    } catch (e) { setErr(apiError(e)); }
  }
  useEffect(() => { load(); }, []);

  // 기본 결재선은 지도교수 — 다만 교수 본인이 기안하면 자기 자신을 결재자로 넣지 않는다
  function defaultLine(): string[] { const prof = users.find((u) => u.role === "prof" && u.id !== me?.id); return prof ? [prof.id] : []; }
  function openNew() {
    const t0 = TYPES[0] || "구매";
    setForm({ type: t0, title: "", project_id: "", approver_ids: defaultLine() });
    setEditing({}); setAddApprover(""); setErr("");
    setBody(TEMPLATES[t0] || "");
  }
  function openEdit(a: Appr, resubmit = false) {
    setForm({ type: a.type, title: a.title, project_id: a.project_id, approver_ids: a.steps.map((s) => s.uid) });
    setEditing({ id: a.id, resubmit, status: a.status }); setAddApprover(""); setErr("");
    setBody(a.content || "");
  }
  // 고르는 즉시 결재선에 넣는다(예전에는 선택 후 '추가' 버튼을 또 눌러야 해서 자주 빠뜨렸다)
  function addStep(uid?: string) {
    const pick = uid ?? addApprover;
    if (pick && !form.approver_ids.includes(pick) && pick !== me?.id)
      setForm({ ...form, approver_ids: [...form.approver_ids, pick] });
    setAddApprover("");
  }
  function removeStep(uid: string) { setForm({ ...form, approver_ids: form.approver_ids.filter((x) => x !== uid) }); }
  function moveStep(i: number, dir: -1 | 1) {
    const ids = [...form.approver_ids]; const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setForm({ ...form, approver_ids: ids });
  }
  function loadTemplate() { setBody(TEMPLATES[form.type] || ""); }

  async function save(draft = false) {
    setErr("");
    if (!form.title.trim()) { setErr("제목을 입력하세요"); return; }
    if (!draft && !form.approver_ids.length) { setErr("결재선에 최소 1명의 결재자를 지정하세요"); return; }
    const content = body;
    const payload = { type: form.type, title: form.title, project_id: form.project_id, amount: 0, deduct_account: "", content, draft, approver_ids: form.approver_ids };
    try {
      if (editing?.resubmit && editing.id) await api.post(`/boards/approvals/${editing.id}/resubmit`, payload);
      else if (editing?.id) await api.put(`/boards/approvals/${editing.id}`, payload);
      else await api.post("/boards/approvals", payload);
      setEditing(null); load();
    } catch (e) { setErr(apiError(e)); }
  }
  // 반려 사유를 쓰던 중 닫으면 내용이 사라지므로 확인을 받는다
  async function closeReject() {
    if (rejectMsg.trim() && !(await confirmDiscard(true))) return;
    setReject(null); setRejectMsg("");
  }
  // 승인은 되돌리기 어려운 처리다. 반려·삭제와 마찬가지로 확인을 받는다.
  async function approveWithConfirm(a: Appr, opened = false) {
    const msg = opened
      ? `"${a.title}" 문서를 승인할까요?`
      : `"${a.title}" 문서를 내용 확인 없이 승인합니다.\n승인하면 다음 결재 단계로 넘어갑니다. 계속할까요?`;
    if (!(await confirmDialog(msg, { title: "결재 승인" }))) return;
    decide(a, "승인");
  }
  async function decide(a: Appr, decision: string, comment = "") {
    try {
      const upd = (await api.post<Appr>(`/boards/approvals/${a.id}/decide`, { decision, comment })).data;
      // 최종 종결 시 연결된 도메인 동기화 (휴가·연구비 청구)
      if (upd.status === "승인" || upd.status === "반려") {
        if (upd.source_ref?.startsWith("leave:")) {
          try { await api.post(`/attendance/leaves/${upd.source_ref.slice(6)}/decide`, { decision: upd.status }); } catch { /* 무시 */ }
        } else if (upd.source_ref?.startsWith("expense:")) {
          try { await api.post(`/funds/expenses/${upd.source_ref.slice(8)}/decide?decision=${encodeURIComponent(upd.status)}`); } catch { /* 무시 */ }
        }
      }
      setViewing((v) => (v && v.id === a.id ? upd : v));
      load();
    } catch (e) { setErr(apiError(e)); }
  }
  async function undo(a: Appr) {
    try {
      const upd = (await api.post<Appr>(`/boards/approvals/${a.id}/undo`, {})).data;
      if (upd.source_ref?.startsWith("leave:")) {   // 연결 휴가를 대기로 되돌림(캘린더에서 제거)
        try { await api.post(`/attendance/leaves/${upd.source_ref.slice(6)}/reopen`); } catch { /* 무시 */ }
      }
      setViewing((v) => (v && v.id === a.id ? upd : v));   // 팝업 갱신 → 진행 상태로 재결재
      load();
    } catch (e) { setErr(apiError(e)); }
  }
  async function recall(a: Appr) {
    try { await api.post(`/boards/approvals/${a.id}/recall`, {}); load(); } catch (e) { setErr(apiError(e)); }
  }
  async function del(a: Appr) {
    if (!await confirmDialog(`문서 "${a.title}"을(를) 삭제할까요?`)) return;
    try { await api.delete(`/boards/approvals/${a.id}`); load(); } catch (e) { setErr(apiError(e)); }
  }
  function submitReject() {
    if (!reject) return;
    if (!rejectMsg.trim()) { setErr("반려 사유를 입력하세요"); return; }
    decide(reject, "반려", rejectMsg); setReject(null); setRejectMsg("");
  }
  const lineSummary = (a: Appr) => a.steps.map((s) => uname(s.uid) + (s.decision ? `(${s.decision})` : "")).join(" → ");

  function exportPdf(a: Appr) {
    const boxes = a.steps.map((s) => {
      const cls = s.decision === "승인" ? "ok" : s.decision === "반려" ? "no" : "wait";
      return `<div class="box"><div class="h">${urole(s.uid)}</div><div class="b"><div>${uname(s.uid)}</div><div class="${cls}">${s.decision || "대기"}</div><div style="color:#9aa3ad;font-size:10px">${s.at || ""}</div></div></div>`;
    }).join("");
    const html = `
      <div style="display:flex;justify-content:space-between;align-items:flex-end">
        <div><div class="doc-title">${a.title}</div><div class="doc-sub">전자결재 문서 · ${a.doc_no}</div></div>
        <div class="sign">${boxes}</div>
      </div>
      <table class="kv"><tbody>
        <tr><th>문서번호</th><td>${a.doc_no}</td><th>문서유형</th><td>${a.type}</td></tr>
        <tr><th>기안자</th><td>${uname(a.by_id)}</td><th>관련 프로젝트</th><td>${projName(a.project_id)}</td></tr>
        <tr><th>상태</th><td>${a.status}</td><th>결재선</th><td>${lineSummary(a)}</td></tr>
      </tbody></table>
      <div class="doc-body">${a.content || "<span style='color:#9aa3ad'>본문 없음</span>"}</div>`;
    printDoc(`${a.doc_no} ${a.title}`, html);
  }

  // ── 기안/재상신: 페이지형 작성 화면 ──
  if (editing) {
    return (
      <div data-testid="page-approvals">
        <div className="page-head">
          <div>
            <div className="crumb">업무 › 전자결재 › {editing.resubmit ? "재상신" : editing.id ? "수정" : "기안 작성"}</div>
            <h1>{editing.resubmit ? "결재 재상신" : editing.id ? "결재 수정" : "결재 기안"}</h1>
          </div>
          <button className="btn ghost" onClick={() => setEditing(null)}>목록</button>
        </div>
        {err && <div className="form-err" data-testid="appr-error">{err}</div>}
        <div className="card" data-testid="appr-form">
          <div className="bd">
            <div className="grid2">
              <div><label htmlFor={`${uid}-1`}>문서유형</label><select id={`${uid}-1`} data-testid="a-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
              <div><label htmlFor={`${uid}-2`}>관련 프로젝트</label><select id={`${uid}-2`} data-testid="a-project" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
                <option value="">(없음)</option>
                <optgroup label="연구과제">{projects.filter((p) => p.kind === "grant" && selectableProj(p)).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</optgroup>
                <optgroup label="프로젝트">{projects.filter((p) => p.kind === "activity" && selectableProj(p)).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</optgroup>
              </select></div>
            </div>
            <label htmlFor={`${uid}-3`}>제목</label><input id={`${uid}-3`} data-testid="a-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />

            <label>결재선 <span className="muted small" style={{ fontWeight: 400 }}>(위에서 아래 순서로 순차 결재)</span></label>
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="bd" style={{ padding: 10 }}>
                {!form.approver_ids.length && <div className="muted small">결재자가 없습니다 — 아래에서 고르면 위에서 아래 순서로 결재됩니다.</div>}
                {form.approver_ids.map((uid, i) => (
                  <div key={uid} data-testid={`a-step-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                    <span className="badge s-info">{i + 1}</span>
                    <span style={{ flex: 1 }}>{uname(uid)} <span className="muted small">({urole(uid)})</span></span>
                    <button type="button" className="btn ghost sm" onClick={() => moveStep(i, -1)} disabled={i === 0}>↑</button>
                    <button type="button" className="btn ghost sm" onClick={() => moveStep(i, 1)} disabled={i === form.approver_ids.length - 1}>↓</button>
                    <button type="button" className="btn ghost sm" data-testid={`a-step-del-${i}`} onClick={() => removeStep(uid)}>✕</button>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <select data-testid="a-approver" aria-label="결재자 추가" value=""
                    onChange={(e) => { if (e.target.value) addStep(e.target.value); }} style={{ margin: 0, flex: 1 }}>
                    <option value="">결재자 추가…</option>
                    {approverPool.filter((u) => u.id !== me?.id && !form.approver_ids.includes(u.id)).map((u) => <option key={u.id} value={u.id}>{u.name} ({urole(u.id)})</option>)}
                  </select>
                </div>
              </div>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>결재 문서 본문
              <button type="button" className="btn ghost sm" data-testid="a-template" onClick={loadTemplate} style={{ fontWeight: 400, marginLeft: "auto" }}>문서유형 양식 불러오기</button>
            </label>
            <HtmlEditor value={body} onChange={setBody} testid="a-doc" minHeight={300} />
          </div>
          <div className="bd" style={{ display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--line2)" }}>
            <button className="btn ghost" onClick={() => setEditing(null)}>취소</button>
            {editing.resubmit ? (
              <button className="btn primary" data-testid="appr-add-submit" onClick={() => save()}>재상신</button>
            ) : (!editing.id || editing.status === "임시저장") ? (<>
              <button className="btn ghost" data-testid="appr-draft" onClick={() => save(true)}>임시저장</button>
              <button className="btn primary" data-testid="appr-add-submit" onClick={() => save(false)}>상신</button>
            </>) : (
              <button className="btn primary" data-testid="appr-add-submit" onClick={() => save(false)}>저장</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 상세 팝업 결재 상태 — 내 차례(재결재 가능) / 내가 결재했고 다음 결재자가 아직 미결재(승인취소 가능)
  const vIdx = viewing ? currentIdx(viewing.steps) : -1;
  const vMyTurn = !!viewing && viewing.status === "진행" && vIdx >= 0 && viewing.steps[vIdx]?.uid === me?.id;
  const vUndoIdx = viewing ? viewing.steps.findIndex((s) => s.uid === me?.id && !!s.decision) : -1;
  const vCanUndo = !!viewing && vUndoIdx >= 0 && !viewing.steps.slice(vUndoIdx + 1).some((s) => !!s.decision);
  const inPages = Math.max(1, Math.ceil(inbox.length / 10)), inCur = Math.min(inPage, inPages - 1);
  const inView = inbox.slice(inCur * 10, inCur * 10 + 10);
  const minePages = Math.max(1, Math.ceil(mine.length / 10)), mineCur = Math.min(minePage, minePages - 1);
  const mineView = mine.slice(mineCur * 10, mineCur * 10 + 10);

  // ── 목록(수신함·상신함) ──
  return (
    <div data-testid="page-approvals">
      <div className="page-head">
        <div><div className="crumb">업무 › 전자결재</div><h1>전자결재</h1></div>
        <button className="btn primary" data-testid="appr-add-open" onClick={openNew}>+ 기안 작성</button>
      </div>
      {err && <div className="form-err" data-testid="appr-error">{err}</div>}

      {isApprover && (
        <div className="card">
          <div className="card-h"><b>결재 수신함</b></div>
          <table className="tbl fit" data-testid="appr-inbox">
            <thead><tr><th className="hide-sm" style={{ width: 118 }}>문서번호</th><th style={{ width: 80 }}>유형</th><th>제목</th><th className="hide-sm" style={{ width: 90 }}>기안자</th><th className="hide-sm" style={{ width: 96 }}>상신일</th><th className="hide-sm" style={{ width: 140 }}>결재선</th><th style={{ width: 78 }}>상태</th><th style={{ width: 124 }}>처리</th></tr></thead>
            <tbody>
              {inView.map((a) => {
                const idx = currentIdx(a.steps);
                const myTurn = idx >= 0 && a.steps[idx]?.uid === me?.id;
                const iAmPending = a.steps.some((s) => s.uid === me?.id && !s.decision);
                return (
                  <tr key={a.id}>
                    <td className="hide-sm">{a.doc_no}</td><td title={a.type}>{a.type}</td>
                    <td title={a.title}><a className="lnk" onClick={() => setViewing(a)}>{a.title}</a></td>
                    <td className="hide-sm">{uname(a.by_id)}</td>
                    <td className="muted small hide-sm">{dateKST(a.created_at) || "—"}</td>
                    <td className="muted small hide-sm" title={lineSummary(a)}>{lineSummary(a)}</td>
                    <td><span className={"badge " + (SBADGE[a.status] || "s-mute")}>{a.status}</span></td>
                    <td>{a.status === "진행" && iAmPending ? (myTurn ? (<>
                      <button className="btn ghost sm" data-testid={`a-approve-${a.id}`} onClick={() => approveWithConfirm(a)}>승인</button>{" "}
                      <button className="btn ghost sm" onClick={() => { setReject(a); setRejectMsg(""); }}>반려</button>
                    </>) : <span className="muted small">이전 결재 대기</span>) : <span className="muted small">-</span>}</td>
                  </tr>
                );
              })}
              {!inbox.length && <tr><td colSpan={8} className="muted">수신 결재 없음</td></tr>}
            </tbody>
          </table>
          <Pager page={inCur} pages={inPages} set={setInPage} />
        </div>
      )}

      <div className="card">
        <div className="card-h"><b>내 상신함</b></div>
        <table className="tbl fit" data-testid="appr-mine">
          <thead><tr><th className="hide-sm" style={{ width: 118 }}>문서번호</th><th style={{ width: 80 }}>유형</th><th>제목</th><th className="hide-sm" style={{ width: 96 }}>상신일</th><th className="hide-sm" style={{ width: 140 }}>결재선</th><th style={{ width: 78 }}>상태</th><th style={{ width: 224 }}>처리</th></tr></thead>
          <tbody>
            {mineView.map((a) => {
              const started = a.steps.some((s) => s.decision);
              return (
                <tr key={a.id}>
                  <td className="hide-sm">{a.doc_no}</td><td title={a.type}>{a.type}</td><td title={a.title}>{a.title}</td>
                  <td className="muted small hide-sm">{dateKST(a.created_at) || "—"}</td>
                  <td className="muted small hide-sm" title={lineSummary(a)}>{lineSummary(a)}</td>
                  <td><span className={"badge " + (SBADGE[a.status] || "s-mute")}>{a.status}</span></td>
                  <td>
                    <button className="btn ghost sm" data-testid={`a-view-${a.id}`} onClick={() => setViewing(a)}>문서</button>{" "}
                    {!started && a.status !== "반려" && <button className="btn ghost sm" data-testid={`a-edit-${a.id}`} onClick={() => openEdit(a)}>수정</button>}{" "}
                    {a.status === "진행" && !started && <button className="btn ghost sm" data-testid={`a-recall-${a.id}`} onClick={() => recall(a)}>회수</button>}{" "}
                    {(a.status === "반려" || a.status === "회수") && <button className="btn ghost sm" data-testid={`a-resubmit-${a.id}`} onClick={() => openEdit(a, true)}>재상신</button>}{" "}
                    {!started && <button className="btn ghost sm" data-testid={`a-del-${a.id}`} style={{ color: "var(--bad-text)" }} onClick={() => del(a)}>삭제</button>}
                  </td>
                </tr>
              );
            })}
            {!mine.length && <tr><td colSpan={7} className="muted">상신 문서 없음</td></tr>}
          </tbody>
        </table>
        <Pager page={mineCur} pages={minePages} set={setMinePage} />
      </div>

      {reject && (
        <div className="modal-ovl" onClick={(e) => { if (e.target === e.currentTarget) closeReject(); }}>
          <div className="modal" style={{ width: 460 }} data-testid="appr-reject">
            <div className="modal-h"><b>반려 사유</b><button className="btn ghost sm" aria-label="닫기" onClick={closeReject}>✕</button></div>
            <div className="modal-b">
              <div className="muted small" style={{ marginBottom: 6 }}>{reject.doc_no} · {reject.title}</div>
              <textarea data-testid="reject-comment" value={rejectMsg} onChange={(e) => setRejectMsg(e.target.value)} style={{ width: "100%", minHeight: 90 }} placeholder="반려 사유를 입력하세요" />
            </div>
            <div className="modal-f">
              <button className="btn ghost" onClick={() => setReject(null)}>취소</button>
              <button className="btn primary" data-testid="reject-submit" onClick={submitReject}>반려</button>
            </div>
          </div>
        </div>
      )}

      {viewing && (
        <div className="modal-ovl" onClick={(e) => { if (e.target === e.currentTarget) setViewing(null); }}>
          <div className="modal" data-testid="appr-view" style={{ width: 1020, maxWidth: "90%" }}>
            <div className="modal-h"><span><span className={"badge " + (SBADGE[viewing.status] || "s-mute")} style={{ marginRight: 8 }}>{viewing.status}</span><b>{viewing.title}</b></span><span style={{ display: "flex", gap: 6 }}><button className="btn ghost sm" data-testid="appr-pdf" onClick={() => exportPdf(viewing)}>📄 PDF 저장</button><button className="btn ghost sm" onClick={() => setViewing(null)}>✕</button></span></div>
            <div className="modal-b">
              <div className="grid2" style={{ marginBottom: 12 }}>
                <div className="muted small">문서번호 · <b>{viewing.doc_no}</b></div>
                <div className="muted small">유형 · <b>{viewing.type}</b></div>
                <div className="muted small">관련 프로젝트 · <b>{projName(viewing.project_id)}</b></div>
                <div className="muted small">기안자 · <b>{uname(viewing.by_id)}</b></div>
              </div>
              <div className="card" style={{ marginBottom: 12 }}>
                <div className="bd" style={{ padding: 10 }}>
                  {viewing.steps.map((s, i) => (
                    <div key={i} style={{ padding: "3px 0" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="badge s-info">{i + 1}</span>
                        <span style={{ flex: 1 }}>{uname(s.uid)} <span className="muted small">({urole(s.uid)})</span></span>
                        <span className={"badge " + (s.decision === "승인" ? "s-ok" : s.decision === "반려" ? "s-bad" : "s-mute")}>{s.decision || "대기"}</span>
                        {s.at && <span className="muted small">{s.at}</span>}
                      </div>
                      {s.comment && (
                        <div className="small" data-testid={`a-step-comment-${i}`} style={{ margin: "5px 0 2px 30px", padding: "7px 10px", borderRadius: 8, background: "var(--soft)", border: "1px solid var(--line2)", overflowWrap: "anywhere", lineHeight: 1.5 }}>
                          <span className="muted">{s.decision === "반려" ? "반려 사유" : "의견"}</span> · {s.comment}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: richHtml(viewing.content) || "<span class='muted'>본문 없음</span>" }} />
            </div>
            {(vMyTurn || vCanUndo) && (
              <div className="modal-f" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ display: "flex", gap: 6 }}>
                  {vMyTurn && <>
                    <button className="btn ghost sm" data-testid="v-approve" onClick={() => approveWithConfirm(viewing, true)}>승인</button>
                    <button className="btn ghost sm" style={{ color: "var(--bad-text)" }} onClick={() => { setReject(viewing); setRejectMsg(""); }}>반려</button>
                  </>}
                </span>
                {vCanUndo && <a className="lnk small" data-testid="v-undo" style={{ cursor: "pointer", color: "var(--sub)" }} onClick={() => undo(viewing)}>승인취소</a>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
