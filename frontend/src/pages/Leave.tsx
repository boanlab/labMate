import { useEffect, useState } from "react";
import { todayKST, dateKST } from "../lib/date";
import { api, apiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useConfig, names } from "../api/config";

interface Lv { id: string; uid: string; type: string; start_date: string; end_date: string; days: number; reason: string; status: string; approver_id?: string; created_at?: string; }
interface Bal { uid: string; granted: number; used: number; }
const TYPES_FB = ["연차", "반차", "병가", "공가", "학회", "출장"];
// 일수 자동 계산 (반차=0.5, 그 외 시작~종료 양끝 포함)
function calcDays(start_date: string, end_date: string, type: string): number {
  if (type === "반차") return 0.5;
  if (!start_date || !end_date || end_date < start_date) return 0;
  return Math.floor((new Date(end_date).getTime() - new Date(start_date).getTime()) / 86400000) + 1;
}

export default function Leave() {
  const { me } = useAuth();
  const [mine, setMine] = useState<Lv[]>([]);
  const [bal, setBal] = useState<Bal | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const today = todayKST();
  const TYPES = names(useConfig("leave_types", TYPES_FB.map((n) => ({ name: n }))));
  const [form, setForm] = useState({ type: "연차", start_date: today, end_date: today, days: 1, reason: "" });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const SB: Record<string, string> = { "대기": "s-wait", "승인": "s-ok", "반려": "s-bad", "취소": "s-mute" };
  const uname = (id: string) => users.find((u) => u.id === id)?.name || "—";
  const sortedMine = [...mine].sort((a, b) => b.start_date.localeCompare(a.start_date));
  const shownMine = (from || to) ? sortedMine.filter((l) => (!from || l.end_date >= from) && (!to || l.start_date <= to)) : sortedMine.slice(0, 10);

  async function load() {
    try {
      setMine((await api.get<Lv[]>("/attendance/leaves/me")).data);
      setBal((await api.get<Bal>("/attendance/leaves/balance")).data);
      api.get<any[]>("/members/users").then((r) => setUsers(r.data)).catch(() => {});
    } catch (e) { setErr(apiError(e)); }
  }
  useEffect(() => { load(); }, []);

  async function apply(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    try {
      const lv = (await api.post<Lv>("/attendance/leaves", { ...form, days: Number(form.days) })).data;
      // 휴가 → 전자결재 자동 상신 (승인자: 지도교수, 없으면 행정/관리자)
      const approver = users.find((u) => u.role === "prof" && u.id !== me?.id) || users.find((u) => ["staff", "admin"].includes(u.role) && u.id !== me?.id);
      if (approver) {
        await api.post("/boards/approvals", {
          type: "휴가",
          title: `휴가 신청 · ${form.type} (${form.start_date}~${form.end_date}, ${form.days}일)`,
          doc: `<p>${form.reason || "(사유 없음)"}</p>`,
          approver_ids: [approver.id],
          ref: `leave:${lv.id}`,
        });
      }
      setAdding(false); load();
    } catch (e) { setErr(apiError(e)); }
  }

  return (
    <div data-testid="page-leave">
      <div className="page-head">
        <div><div className="crumb">인사 › 휴가</div><h1>휴가</h1></div>
        <button className="btn primary" data-testid="leave-add-open" onClick={() => setAdding((v) => !v)}>+ 휴가 신청</button>
      </div>
      {err && <div className="form-err" data-testid="leave-error">{err}</div>}
      <div className="io">휴가 신청 시 <b>전자결재로 자동 상신</b>됩니다.</div>
      {bal && <div className="card"><div className="bd" data-testid="leave-balance">부여 {bal.granted}일 · 사용 {bal.used}일 · 잔여 {bal.granted - bal.used}일</div></div>}
      {adding && (
        <form className="card" onSubmit={apply} data-testid="leave-form">
          <div className="bd grid2">
            <div><label>종류</label><select data-testid="l-type" value={form.type} onChange={(e) => { const type = e.target.value; setForm({ ...form, type, days: calcDays(form.start_date, form.end_date, type) }); }}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
            <div><label>일수 <span className="muted small">(자동 계산)</span></label><input data-testid="l-days" type="number" step="0.5" value={form.days} readOnly tabIndex={-1} style={{ background: "var(--soft)" }} /></div>
            <div><label>시작</label><input data-testid="l-start_date" type="date" value={form.start_date} onChange={(e) => { const start_date = e.target.value; setForm({ ...form, start_date, days: calcDays(start_date, form.end_date, form.type) }); }} /></div>
            <div><label>종료</label><input data-testid="l-end_date" type="date" value={form.end_date} onChange={(e) => { const end_date = e.target.value; setForm({ ...form, end_date, days: calcDays(form.start_date, end_date, form.type) }); }} /></div>
            <div style={{ gridColumn: "1 / -1" }}><label>사유</label><input data-testid="l-reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
          </div>
          <div className="bd" style={{ display: "flex", gap: 8 }}><button className="btn primary" data-testid="leave-add-submit">신청</button><button type="button" className="btn ghost" data-testid="leave-cancel" onClick={() => setAdding(false)}>취소</button></div>
        </form>
      )}
      <div className="card">
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <b>내 신청 내역</b>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="date" data-testid="lv-from" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150, margin: 0 }} />
            <span className="muted small">~</span>
            <input type="date" data-testid="lv-to" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150, margin: 0 }} />
            {(from || to) ? <button type="button" className="btn ghost sm" onClick={() => { setFrom(""); setTo(""); }}>초기화</button> : <span className="muted small">최근 10건</span>}
          </span>
        </div>
        <table className="tbl" data-testid="leave-table">
          <thead><tr><th>종류</th><th>기간</th><th>일수</th><th>사유</th><th>신청일</th><th>상태</th><th>승인자</th></tr></thead>
          <tbody>
            {shownMine.map((l) => <tr key={l.id}><td>{l.type}</td><td>{l.start_date}~{l.end_date}</td><td>{l.days}일</td><td className="muted">{l.reason}</td><td className="muted small">{dateKST(l.created_at) || "—"}</td><td><span className={"badge " + (SB[l.status] || "s-mute")}>{l.status}</span></td><td className="muted">{l.status === "승인" || l.status === "반려" ? uname(l.approver_id || "") : "—"}</td></tr>)}
            {!shownMine.length && <tr><td colSpan={7} className="muted">{(from || to) ? "해당 기간 신청 내역 없음" : "신청 내역 없음"}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
