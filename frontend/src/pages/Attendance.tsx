import { useEffect, useState, useId } from "react";
import { Pager } from "../ui/pageTable";
import { todayKST } from "../lib/date";
import { api, apiError } from "../api/client";
import { formSnapshot, confirmDiscard } from "../ui/kit";
import { useAuth } from "../auth/AuthContext";
import { useConfig } from "../api/config";
import { useColumnResize, useTableSort } from "../ui/tableTools";

interface Att { id: string; uid: string; date: string; check_in: string; check_out: string; status: string; note: string; work_min?: number; session_start?: string; corrected?: boolean; }

const nowHM = () => new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" });
const minsBetween = (s: string, e: string) => { if (!s || !e) return 0; const d = (+e.slice(0, 2) * 60 + +e.slice(3, 5)) - (+s.slice(0, 2) * 60 + +s.slice(3, 5)); return d > 0 ? d : 0; };
// 근무시간 = 세션별 실근무 누적 + 지금 진행 중인 세션. 자리비움 구간은 빠진다.
const workMin = (a?: { check_in?: string; check_out?: string; work_min?: number; session_start?: string }) => {
  if (!a?.check_in) return 0;
  const acc = a.work_min || 0;
  const live = a.session_start ? minsBetween(a.session_start, nowHM()) : 0;
  if (acc || live) return acc + live;
  return minsBetween(a.check_in, a.check_out || "");   // 세션 기록 이전의 옛 자료
};
const fmtWork = (m: number) => m ? `${Math.floor(m / 60)}시간 ${m % 60}분` : "—";
interface Req { id: string; uid: string; date: string; check_in: string; check_out: string; requested_status: string; reason: string; status: string; decided_by: string; decided_at: string; decide_note: string; }

const REQB: Record<string, string> = { "대기": "s-wait", "승인": "s-ok", "반려": "s-bad" };

export default function Attendance() {
  const [reqSnap, setReqSnap] = useState("");   // 정정요청 모달 초기 상태
  const uid = useId();   // 라벨-입력 연결용 고유 접두사
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
  const attRef = useColumnResize("att-table");
  const reqRef = useColumnResize("att-myreqs");
  const attSort = useTableSort(null, "att-table");
  const reqSort = useTableSort(null, "att-myreqs");
  const sortedShown = attSort.apply(shownMine, {
    date: (a) => a.date, status: (a) => a.status, in: (a) => a.check_in || "",
    out: (a) => a.check_out || "", work: (a) => workMin(a), note: (a) => a.note || "",
  });
  const sortedReqs = reqSort.apply(myReqs, {
    date: (r) => r.date, req: (r) => r.requested_status, reason: (r) => r.reason, status: (r) => r.status,
  });
  const minePages = Math.max(1, Math.ceil(shownMine.length / 10)), mineCur = Math.min(minePage, minePages - 1);
  const mineView = sortedShown.slice(mineCur * 10, mineCur * 10 + 10);
  const reqPages = Math.max(1, Math.ceil(myReqs.length / 10)), reqCur = Math.min(reqPage, reqPages - 1);
  const reqView = sortedReqs.slice(reqCur * 10, reqCur * 10 + 10);

  async function checkIn() { try { await api.post("/attendance/attendance/check-in", { status: "업무 중", note: "" }); load(); } catch (e) { setErr(apiError(e)); } }
  async function checkOut() { try { await api.post("/attendance/attendance/check-out"); load(); } catch (e) { setErr(apiError(e)); } }
  async function goAway() { try { await api.post("/attendance/attendance/away"); load(); } catch (e) { setErr(apiError(e)); } }
  async function comeBack() { try { await api.post("/attendance/attendance/back"); load(); } catch (e) { setErr(apiError(e)); } }

  function openReq() {
    const a = mine.find((x) => x.date === today);
    const f = { date: today, check_in: a?.check_in || "", check_out: a?.check_out || "", requested_status: a?.status || "업무 중", reason: "" };
    setReqForm(f); setReqSnap(formSnapshot(f));
  }
  // 모달을 닫을 때 입력 중인 내용이 있으면 확인을 받는다
  async function closeReq() { if (!(await confirmDiscard(formSnapshot(reqForm) !== reqSnap))) return; setReqForm(null); setReqSnap(""); }
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
            {todayRec?.status === "자리비움" && <span className="muted small"> · 자리비움 중이라 근무시간이 늘지 않습니다</span>}
          </div>
          {(() => {
            const st = todayRec?.status || "미체크";
            const away = st === "자리비움";
            const inWork = st !== "미체크" && st !== "퇴근";
            return <>
              {/* 지금 가능한 동작을 강조한다 — 비활성 버튼이 더 진하면 어느 쪽을 눌러야 할지 반대로 읽힌다 */}
              <button className={"btn " + (inWork ? "ghost" : "primary")} data-testid="att-checkin" disabled={inWork} onClick={checkIn}>출근 체크</button>
              {away
                ? <button className="btn primary" data-testid="att-back" onClick={comeBack}>복귀</button>
                : <button className="btn ghost" data-testid="att-away" disabled={!inWork} onClick={goAway} title="잠시 자리를 비웁니다 — 비운 시간은 근무시간에서 빠집니다">자리비움</button>}
              <button className={"btn " + (inWork && !away ? "primary" : "ghost")} data-testid="att-checkout" disabled={!inWork} onClick={checkOut}>퇴근 체크</button>
            </>;
          })()}
        </div>
      </div>

      <div className="card">
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <b>내 출퇴근 기록</b>
            <button className="btn ghost sm" data-testid="att-req-open" onClick={openReq}>+ 출퇴근 시간 정정 요청</button>
          </span>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="date" data-testid="att-from" aria-label="조회 시작일" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150, margin: 0 }} />
            <span className="muted small">~</span>
            <input type="date" data-testid="att-to" aria-label="조회 종료일" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150, margin: 0 }} />
            {(from || to) ? <button type="button" className="btn ghost sm" onClick={() => { setFrom(""); setTo(""); }}>초기화</button> : <span className="muted small">{shownMine.length}건</span>}
          </span>
        </div>
        <table ref={attRef} className="tbl" data-testid="att-table">
          <thead><tr>
            <th {...attSort.th("date")}>일자{attSort.mark("date")}</th>
            <th {...attSort.th("status")}>상태{attSort.mark("status")}</th>
            <th {...attSort.th("in")}>출근{attSort.mark("in")}</th>
            <th {...attSort.th("out")}>퇴근{attSort.mark("out")}</th>
            <th {...attSort.th("work")}>근무{attSort.mark("work")}</th>
            <th {...attSort.th("note")}>비고{attSort.mark("note")}</th>
          </tr></thead>
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
        <table ref={reqRef} className="tbl" data-testid="att-myreqs">
          <thead><tr>
            <th {...reqSort.th("date")}>일자{reqSort.mark("date")}</th>
            <th {...reqSort.th("req")}>요청 (상태 / 출근~퇴근){reqSort.mark("req")}</th>
            <th {...reqSort.th("reason")}>사유{reqSort.mark("reason")}</th>
            <th {...reqSort.th("status")}>처리{reqSort.mark("status")}</th>
          </tr></thead>
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
        <div className="modal-ovl" onClick={(e) => { if (e.target === e.currentTarget) closeReq(); }}>
          <div className="modal" data-testid="att-req-form" style={{ width: 560, maxWidth: "92%" }}>
            <div className="modal-h"><b>출퇴근 시간 정정 요청</b><button className="btn ghost sm" aria-label="닫기" onClick={closeReq}>✕</button></div>
            <div className="modal-b">
              <div className="grid2">
                <div><label htmlFor={`${uid}-1`}>일자</label><input id={`${uid}-1`} data-testid="rq-date" type="date" value={reqForm.date} max={today} onChange={(e) => reqSetDate(e.target.value)} /></div>
                <div><label htmlFor={`${uid}-2`}>상태</label><select id={`${uid}-2`} data-testid="rq-status" value={reqForm.requested_status} onChange={(e) => setReqForm({ ...reqForm, requested_status: e.target.value })}>{STATES.map((s) => <option key={s}>{s}</option>)}</select></div>
                <div><label htmlFor={`${uid}-3`}>출근</label><input id={`${uid}-3`} data-testid="rq-in" type="time" value={reqForm.check_in} onChange={(e) => setReqForm({ ...reqForm, check_in: e.target.value })} /></div>
                <div><label htmlFor={`${uid}-4`}>퇴근</label><input id={`${uid}-4`} data-testid="rq-out" type="time" value={reqForm.check_out} onChange={(e) => setReqForm({ ...reqForm, check_out: e.target.value })} /></div>
              </div>
              <label htmlFor={`${uid}-5`}>정정 사유 *</label>
              <input id={`${uid}-5`} data-testid="rq-reason" value={reqForm.reason} onChange={(e) => setReqForm({ ...reqForm, reason: e.target.value })} placeholder="예: 출근 체크 누락" />
              <div className="muted small" style={{ marginTop: 8 }}>교수 승인 시 내 출퇴근 기록에 반영됩니다.</div>
            </div>
            <div className="modal-f">
              <button className="btn ghost" onClick={closeReq}>취소</button>
              <button className="btn primary" data-testid="att-req-submit" onClick={submitReq}>정정 요청</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
