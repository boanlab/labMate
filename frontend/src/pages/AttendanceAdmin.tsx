import { useEffect, useState } from "react";
import { api, apiError } from "../api/client";
import { dateKST } from "../lib/date";
import { useAuth } from "../auth/AuthContext";

interface Att { id: string; uid: string; date: string; check_in: string; check_out: string; status: string; note: string; work_min?: number; session_start?: string; corrected?: boolean; }

const nowHM = () => new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" });
const minsBetween = (s: string, e: string) => { if (!s || !e) return 0; const d = (+e.slice(0, 2) * 60 + +e.slice(3, 5)) - (+s.slice(0, 2) * 60 + +s.slice(3, 5)); return d > 0 ? d : 0; };
// 근무시간 = 출근~퇴근(근무 중이면 현재까지)
const workMin = (a: { status?: string; check_in?: string; check_out?: string }) => {
  if (!a.check_in) return 0;
  const end = (!a.check_out && a.status !== "퇴근") ? nowHM() : (a.check_out || "");
  return minsBetween(a.check_in, end);
};
const fmtWork = (m: number) => m ? `${Math.floor(m / 60)}시간 ${m % 60}분` : "—";
interface Log { id: string; att_id: string; target_uid: string; by_id: string; before: any; after: any; reason: string; at?: string; }
interface Req { id: string; uid: string; date: string; check_in: string; check_out: string; requested_status: string; reason: string; status: string; decided_by: string; decided_at: string; decide_note: string; }

const REQB: Record<string, string> = { "대기": "s-wait", "승인": "s-ok", "반려": "s-bad" };

export default function AttendanceAdmin() {
  const { me } = useAuth();
  const isProf = me?.role === "prof";
  const [users, setUsers] = useState<any[]>([]);
  const [atts, setAtts] = useState<Att[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [uid, setUid] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [err, setErr] = useState("");

  const members = users.filter((u) => u.role !== "admin");
  const uname = (id: string) => users.find((u) => u.id === id)?.name || id.slice(0, 6);
  const pendingReqs = reqs.filter((r) => r.status === "대기");

  async function loadBase() {
    try {
      setUsers((await api.get<any[]>("/members/users")).data);
      setReqs((await api.get<Req[]>("/attendance/attendance/correct-requests")).data);
      setLogs((await api.get<Log[]>("/attendance/attendance/logs")).data);
    } catch (e) { setErr(apiError(e)); }
  }
  async function loadAtts() {
    try {
      const qs = new URLSearchParams();
      if (uid) qs.set("uid", uid);
      if (from) qs.set("date_from", from);
      if (to) qs.set("date_to", to);
      setAtts((await api.get<Att[]>(`/attendance/attendance/all?${qs.toString()}`)).data);
    } catch (e) { setErr(apiError(e)); }
  }
  useEffect(() => { if (isProf) { loadBase(); } }, [isProf]);
  useEffect(() => { if (isProf) loadAtts(); /* eslint-disable-next-line */ }, [uid, from, to, isProf]);

  async function decideReq(r: Req, decision: string) {
    try { await api.post(`/attendance/attendance/correct-requests/${r.id}/decide?decision=${encodeURIComponent(decision)}`); loadBase(); loadAtts(); }
    catch (e) { setErr(apiError(e)); }
  }

  const logDate = (l: Log) => dateKST(l.at);
  const sortedLogs = [...logs].sort((a, b) => logDate(b).localeCompare(logDate(a)));
  const shownAtts = (from || to || uid) ? atts : atts.slice(0, 30);

  if (!isProf) {
    return (
      <div data-testid="page-att-admin">
        <div className="page-head"><div><div className="crumb">인사 › 근태 관리</div><h1>근태 관리</h1></div></div>
        <div className="card"><div className="bd muted">교수만 접근할 수 있습니다.</div></div>
      </div>
    );
  }

  return (
    <div data-testid="page-att-admin">
      <div className="page-head"><div><div className="crumb">인사 › 근태 관리</div><h1>근태 관리</h1></div></div>
      {err && <div className="form-err">{err}</div>}

      <div className="card">
        <div className="card-h"><b>출퇴근 시간 정정 요청</b>{pendingReqs.length > 0 ? <span className="badge s-wait">{pendingReqs.length} 대기</span> : <span className="muted small">대기 중인 요청 없음</span>}</div>
        <table className="tbl" data-testid="aa-pending">
          <thead><tr><th>신청자</th><th>일자</th><th>요청 (상태 / 출근~퇴근)</th><th>사유</th><th>처리</th></tr></thead>
          <tbody>
            {pendingReqs.map((r) => (
              <tr key={r.id}>
                <td><b>{uname(r.uid)}</b></td>
                <td>{r.date}</td>
                <td className="muted small">{r.requested_status} · {r.check_in || "—"}~{r.check_out || "—"}</td>
                <td>{r.reason}</td>
                <td>
                  <button className="btn ghost sm" data-testid={`aa-ok-${r.id}`} onClick={() => decideReq(r, "승인")}>승인</button>{" "}
                  <button className="btn ghost sm" style={{ color: "var(--bad)" }} onClick={() => decideReq(r, "반려")}>반려</button>
                </td>
              </tr>
            ))}
            {!pendingReqs.length && <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 12 }}>대기 중인 정정 요청이 없습니다</td></tr>}
          </tbody>
        </table>
      </div>

      {reqs.filter((r) => r.status !== "대기").length > 0 && (
        <div className="card">
          <div className="card-h"><b>정정 요청 처리 이력</b><span className="muted small">{reqs.filter((r) => r.status !== "대기").length}건</span></div>
          <table className="tbl" data-testid="aa-req-history">
            <thead><tr><th>신청자</th><th>일자</th><th>요청 (상태 / 출근~퇴근)</th><th>사유</th><th>결과</th></tr></thead>
            <tbody>
              {reqs.filter((r) => r.status !== "대기").map((r) => (
                <tr key={r.id}>
                  <td>{uname(r.uid)}</td>
                  <td>{r.date}</td>
                  <td className="muted small">{r.requested_status} · {r.check_in || "—"}~{r.check_out || "—"}</td>
                  <td>{r.reason}</td>
                  <td><span className={"badge " + (REQB[r.status] || "s-mute")}>{r.status}</span> <span className="muted small">{r.decided_at}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <b>구성원 근태 현황 · 이력</b>
          <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <select data-testid="aa-uid" value={uid} onChange={(e) => setUid(e.target.value)} style={{ width: "auto", margin: 0 }}>
              <option value="">전체 구성원</option>
              {members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <input type="date" data-testid="aa-from" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150, margin: 0 }} />
            <span className="muted small">~</span>
            <input type="date" data-testid="aa-to" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150, margin: 0 }} />
            {(from || to || uid) ? <button type="button" className="btn ghost sm" onClick={() => { setFrom(""); setTo(""); setUid(""); }}>초기화</button> : <span className="muted small">최근 30건</span>}
          </span>
        </div>
        <table className="tbl" data-testid="aa-table">
          <thead><tr><th>일자</th><th>구성원</th><th>상태</th><th>출근</th><th>퇴근</th><th>근무</th><th>비고</th></tr></thead>
          <tbody>
            {shownAtts.map((a) => (
              <tr key={a.id}>
                <td>{a.date}{a.corrected && <span className="badge s-wait" style={{ marginLeft: 6 }}>보정</span>}</td>
                <td><b>{uname(a.uid)}</b></td>
                <td>{a.status}</td><td>{a.check_in || "—"}</td><td>{a.check_out || "—"}</td>
                <td className="small">{fmtWork(workMin(a))}</td>
                <td className="muted small">{a.note}</td>
              </tr>
            ))}
            {!shownAtts.length && <tr><td colSpan={7} className="muted">근태 기록 없음</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-h"><b>출퇴근 시간 보정 이력</b><span className="muted small">{sortedLogs.length}건</span></div>
        <table className="tbl" data-testid="aa-logs">
          <thead><tr><th>보정일</th><th>대상</th><th>보정자</th><th>변경 전 → 후</th><th>사유</th></tr></thead>
          <tbody>
            {sortedLogs.slice(0, 30).map((l) => (
              <tr key={l.id}>
                <td className="small muted">{logDate(l) || "—"}</td>
                <td>{uname(l.target_uid)}</td><td>{uname(l.by_id)}</td>
                <td className="muted small">{l.before?.status || "—"} {l.before?.check_in || ""}~{l.before?.check_out || ""} → <b>{l.after?.status}</b> {l.after?.check_in}~{l.after?.check_out}</td>
                <td>{l.reason}</td>
              </tr>
            ))}
            {!sortedLogs.length && <tr><td colSpan={5} className="muted">보정 이력 없음</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
