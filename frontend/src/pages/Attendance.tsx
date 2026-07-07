import { useEffect, useState } from "react";
import { Pager } from "../ui/pageTable";
import { todayKST } from "../lib/date";
import { api, apiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useConfig } from "../api/config";

interface Att { id: string; uid: string; date: string; check_in: string; check_out: string; status: string; note: string; work_min?: number; session_start?: string; corrected?: boolean; }

const nowHM = () => new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" });
const minsBetween = (s: string, e: string) => { if (!s || !e) return 0; const d = (+e.slice(0, 2) * 60 + +e.slice(3, 5)) - (+s.slice(0, 2) * 60 + +s.slice(3, 5)); return d > 0 ? d : 0; };
// 근무시간 = 출근~퇴근(근무 중이면 현재까지)
const workMin = (a?: { status?: string; check_in?: string; check_out?: string }) => {
  if (!a?.check_in) return 0;
  const end = (!a.check_out && a.status !== "퇴근") ? nowHM() : (a.check_out || "");
  return minsBetween(a.check_in, end);
};
const fmtWork = (m: number) => m ? `${Math.floor(m / 60)}시간 ${m % 60}분` : "—";
interface Req { id: string; uid: string; date: string; check_in: string; check_out: string; requested_status: string; reason: string; status: string; decided_by: string; decided_at: string; decide_note: string; }

const REQB: Record<string, string> = { "대기": "s-wait", "승인": "s-ok", "반려": "s-bad" };

export default function Attendance() {
  const { me } = useAuth();
  const STATES = useConfig<string[]>("attendance_states", ["업무 중", "외근", "출장", "휴가", "퇴근", "미체크"]);
  const [mine, setMine] = useState<Att[]>([]);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [err, setErr] = useState("");
  const today = todayKST();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reqForm, setReqForm] = useState<null | { date: string; check_in: string; check_out: string; requested_status: string; reason: string }>(null);

  async function load() {
    try {
      setMine((await api.get<Att[]>("/attendance/attendance/me")).data);
      setReqs((await api.get<Req[]>("/attendance/attendance/correct-requests")).data);
    } catch (e) { setErr(apiError(e)); }
  }
  useEffect(() => { load(); }, []);

  const todayRec = mine.find((a) => a.date === today);
  const sortedMine = [...mine].sort((a, b) => b.date.localeCompare(a.date));
  const shownMine = (from || to) ? sortedMine.filter((a) => (!from || a.date >= from) && (!to || a.date <= to)) : sortedMine;
  const myReqs = reqs.filter((r) => r.uid === me?.id);
  const [minePage, setMinePage] = useState(0);
  const [reqPage, setReqPage] = useState(0);
  useEffect(() => setMinePage(0), [from, to]);
  const minePages = Math.max(1, Math.ceil(shownMine.length / 10)), mineCur = Math.min(minePage, minePages - 1);
  const mineView = shownMine.slice(mineCur * 10, mineCur * 10 + 10);
  const reqPages = Math.max(1, Math.ceil(myReqs.length / 10)), reqCur = Math.min(reqPage, reqPages - 1);
  const reqView = myReqs.slice(reqCur * 10, reqCur * 10 + 10);

  async function checkIn() { try { await api.post("/attendance/attendance/check-in", { status: "업무 중", note: "" }); load(); } catch (e) { setErr(apiError(e)); } }
  async function checkOut() { try { await api.post("/attendance/attendance/check-out"); load(); } catch (e) { setErr(apiError(e)); } }

  function openReq() { const a = mine.find((x) => x.date === today); setReqForm({ date: today, check_in: a?.check_in || "", check_out: a?.check_out || "", requested_status: a?.status || "업무 중", reason: "" }); }
  function reqSetDate(date: string) { const a = mine.find((x) => x.date === date); setReqForm((f) => f ? { ...f, date, check_in: a?.check_in || "", check_out: a?.check_out || "", requested_status: a?.status || "업무 중" } : f); }
  async function submitReq() {
    if (!reqForm) return; setErr("");
    if (!reqForm.reason.trim()) { setErr("정정 사유는 필수입니다"); return; }
    try { await api.post("/attendance/attendance/correct-requests", reqForm); setReqForm(null); load(); }
    catch (e) { setErr(apiError(e)); }
  }

  return (
    <div data-testid="page-attendance">
      <div className="page-head">
        <div><div className="crumb">인사 › 출퇴근</div><h1>출퇴근</h1></div>
      </div>
      {err && <div className="form-err" data-testid="att-error">{err}</div>}

      <div className="card">
        <div className="card-h"><b>오늘 내 출퇴근</b></div>
        <div className="bd" style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ flex: 1 }} data-testid="att-today">
            상태: <b>{todayRec?.status || "미체크"}</b> · 출근 {todayRec?.check_in || "—"} / 퇴근 {todayRec?.check_out || "—"} · 근무 <b>{fmtWork(workMin(todayRec))}</b>
          </div>
          {(() => { const st = todayRec?.status || "미체크"; const inWork = st !== "미체크" && st !== "퇴근"; return <>
            <button className="btn primary" data-testid="att-checkin" disabled={inWork} onClick={checkIn}>출근 체크</button>
            <button className="btn ghost" data-testid="att-checkout" disabled={!inWork} onClick={checkOut}>퇴근 체크</button>
          </>; })()}
        </div>
      </div>

      <div className="card">
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <b>내 출퇴근 기록</b>
            <button className="btn ghost sm" data-testid="att-req-open" onClick={openReq}>+ 출퇴근 시간 정정 요청</button>
          </span>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="date" data-testid="att-from" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150, margin: 0 }} />
            <span className="muted small">~</span>
            <input type="date" data-testid="att-to" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150, margin: 0 }} />
            {(from || to) ? <button type="button" className="btn ghost sm" onClick={() => { setFrom(""); setTo(""); }}>초기화</button> : <span className="muted small">{shownMine.length}건</span>}
          </span>
        </div>
        <table className="tbl" data-testid="att-table">
          <thead><tr><th>일자</th><th>상태</th><th>출근</th><th>퇴근</th><th>근무</th><th>비고</th></tr></thead>
          <tbody>
            {mineView.map((a) => (
              <tr key={a.id}><td>{a.date}{a.corrected && <span className="badge s-wait" style={{ marginLeft: 6 }}>보정</span>}</td><td>{a.status}</td><td>{a.check_in || "—"}</td><td>{a.check_out || "—"}</td><td className="small">{fmtWork(workMin(a))}</td><td className="muted small">{a.note}</td></tr>
            ))}
            {!shownMine.length && <tr><td colSpan={5} className="muted">{(from || to) ? "해당 기간 기록 없음" : "기록 없음"}</td></tr>}
          </tbody>
        </table>
        <Pager page={mineCur} pages={minePages} set={setMinePage} />
      </div>

      <div className="card">
        <div className="card-h"><b>내 출퇴근 정정 요청</b><span className="muted small">{myReqs.length}건</span></div>
        <table className="tbl" data-testid="att-myreqs">
          <thead><tr><th>일자</th><th>요청 (상태 / 출근~퇴근)</th><th>사유</th><th>처리</th></tr></thead>
          <tbody>
            {reqView.map((r) => (
              <tr key={r.id}>
                <td>{r.date}</td>
                <td className="muted small">{r.requested_status} · {r.check_in || "—"}~{r.check_out || "—"}</td>
                <td>{r.reason}</td>
                <td><span className={"badge " + (REQB[r.status] || "s-mute")}>{r.status}</span>{r.decide_note && <span className="muted small"> · {r.decide_note}</span>}</td>
              </tr>
            ))}
            {!myReqs.length && <tr><td colSpan={4} className="muted">정정 요청 없음</td></tr>}
          </tbody>
        </table>
        <Pager page={reqCur} pages={reqPages} set={setReqPage} />
      </div>

      {reqForm && (
        <div className="modal-ovl" onClick={(e) => { if (e.target === e.currentTarget) setReqForm(null); }}>
          <div className="modal" data-testid="att-req-form" style={{ width: 560, maxWidth: "92%" }}>
            <div className="modal-h"><b>출퇴근 시간 정정 요청</b><button className="btn ghost sm" onClick={() => setReqForm(null)}>✕</button></div>
            <div className="modal-b">
              <div className="grid2">
                <div><label>일자</label><input data-testid="rq-date" type="date" value={reqForm.date} max={today} onChange={(e) => reqSetDate(e.target.value)} /></div>
                <div><label>상태</label><select data-testid="rq-status" value={reqForm.requested_status} onChange={(e) => setReqForm({ ...reqForm, requested_status: e.target.value })}>{STATES.map((s) => <option key={s}>{s}</option>)}</select></div>
                <div><label>출근</label><input data-testid="rq-in" type="time" value={reqForm.check_in} onChange={(e) => setReqForm({ ...reqForm, check_in: e.target.value })} /></div>
                <div><label>퇴근</label><input data-testid="rq-out" type="time" value={reqForm.check_out} onChange={(e) => setReqForm({ ...reqForm, check_out: e.target.value })} /></div>
              </div>
              <label>정정 사유 *</label>
              <input data-testid="rq-reason" value={reqForm.reason} onChange={(e) => setReqForm({ ...reqForm, reason: e.target.value })} placeholder="예: 출근 체크 누락" />
              <div className="muted small" style={{ marginTop: 8 }}>교수 승인 시 내 출퇴근 기록에 반영됩니다.</div>
            </div>
            <div className="modal-f">
              <button className="btn ghost" onClick={() => setReqForm(null)}>취소</button>
              <button className="btn primary" data-testid="att-req-submit" onClick={submitReq}>정정 요청</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
