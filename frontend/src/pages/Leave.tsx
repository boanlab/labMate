import { useEffect, useState, useId } from "react";
import { useDirectory } from "../api/directory";
import { Pager } from "../ui/pageTable";
import { todayKST, dateKST } from "../lib/date";
import { api, apiError } from "../api/client";
import { confirmDialog } from "../ui/dialog";
import { useAuth } from "../auth/AuthContext";
import { useConfig, names } from "../api/config";
import { Req } from "../ui/kit";
import { useColumnResize, useTableSort } from "../ui/tableTools";

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
  const tableRef = useColumnResize("leave");   // 컬럼 폭 조절
  const sort = useTableSort(null, "leave");   // 머리글 클릭 정렬
  const uid = useId();   // 라벨-입력 연결용 고유 접두사
  const { me } = useAuth();
  const [mine, setMine] = useState<Lv[]>([]);
  const [bal, setBal] = useState<Bal | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const today = todayKST();
  const TYPE_RULES = useConfig<{ name: string; deduct?: boolean; fraction?: number }[]>(
    "leave_types", TYPES_FB.map((n) => ({ name: n, deduct: n === "연차" || n === "반차", fraction: n === "반차" ? 0.5 : 1 })));
  const TYPES = names(TYPE_RULES);
  const ruleOf = (t: string) => TYPE_RULES.find((r) => r.name === t) || { name: t, deduct: true, fraction: 1 };
  const [form, setForm] = useState({ type: "연차", start_date: today, end_date: today, days: 1, reason: "" });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const SB: Record<string, string> = { "대기": "s-wait", "승인": "s-ok", "반려": "s-bad", "취소": "s-mute" };
  const uname = useDirectory();
  const sortedMine = [...mine].sort((a, b) => b.start_date.localeCompare(a.start_date));
  const shownMine = sort.apply(
    (from || to) ? sortedMine.filter((l) => (!from || l.end_date >= from) && (!to || l.start_date <= to)) : sortedMine,
    { type: (l) => l.type, period: (l) => l.start_date, days: (l) => l.days, reason: (l) => l.reason,
      created: (l) => l.created_at || "", status: (l) => l.status, approver: (l) => uname(l.approver_id || "") });
  const [minePage, setMinePage] = useState(0);
  useEffect(() => setMinePage(0), [from, to]);
  const minePages = Math.max(1, Math.ceil(shownMine.length / 10)), mineCur = Math.min(minePage, minePages - 1);
  const mineView = shownMine.slice(mineCur * 10, mineCur * 10 + 10);

  const [loaded, setLoaded] = useState(false);   // 첫 조회 완료 여부 — "없음"과 "불러오는 중"을 구분
  async function load() {
    try {
      setMine((await api.get<Lv[]>("/attendance/leaves/me")).data);
      setBal((await api.get<Bal>("/attendance/leaves/balance")).data);
      api.get<any[]>("/members/users").then((r) => setUsers(r.data)).catch(() => {});
    } catch (e) { setErr(apiError(e)); } finally { setLoaded(true); }
  }
  useEffect(() => { load(); }, []);

  // 신청 전 잔여 일수 미리보기 — 서버도 초과를 막지만(409) 제출 전에 알려 준다.
  const curRule = ruleOf(form.type);
  const deducts = curRule.deduct !== false;
  const remain = bal ? bal.granted - bal.used : null;
  const after = remain === null ? null : remain - (deducts ? Number(form.days) || 0 : 0);

  async function apply(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    if (!form.start_date) return setErr("시작일을 입력하세요");
    if (!form.end_date) return setErr("종료일을 입력하세요");
    if (!form.reason.trim()) return setErr("사유를 입력하세요");
    if (deducts && after !== null && after < 0) return setErr(`잔여 연차 ${remain}일을 ${Math.abs(after)}일 초과합니다 — 기간을 줄이거나 다른 휴가 종류를 선택하세요`);
    // 사후 신청은 정상적인 경우가 있으므로 막지 않되, 오타로 몇 해 전 날짜가 들어가는 것은 걸러낸다.
    if (form.start_date < today && !(await confirmDialog(`시작일이 오늘(${today})보다 이전입니다.\n${form.start_date} 로 신청할까요?`, { title: "지난 날짜 신청" }))) return;
    try {
      const lv = (await api.post<Lv>("/attendance/leaves", { ...form, days: Number(form.days) })).data;
      // 휴가 → 전자결재 자동 상신 (승인자: 지도교수, 없으면 행정/관리자)
      const approver = users.find((u) => u.role === "prof" && u.id !== me?.id) || users.find((u) => ["staff", "admin"].includes(u.role) && u.id !== me?.id);
      if (approver) {
        await api.post("/boards/approvals", {
          type: "휴가",
          title: `휴가 신청 · ${form.type} (${form.start_date}~${form.end_date}, ${form.days}일)`,
          content: `<p>${form.reason || "(사유 없음)"}</p>`,
          approver_ids: [approver.id],
          source_ref: `leave:${lv.id}`,
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
            <div><label htmlFor={`${uid}-1`}>종류</label><select id={`${uid}-1`} data-testid="l-type" value={form.type} onChange={(e) => { const type = e.target.value; setForm({ ...form, type, days: calcDays(form.start_date, form.end_date, type) }); }}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
            <div>
              <label htmlFor={`${uid}-2`}>일수 <span className="muted small">(자동 계산)</span></label>
              <input id={`${uid}-2`} data-testid="l-days" type="number" step="0.5" value={form.days} readOnly tabIndex={-1} style={{ background: "var(--soft)" }} />
              <div className="small" data-testid="l-balance-hint">
                {!deducts
                  ? <span className="muted">{form.type}는 연차를 차감하지 않습니다</span>
                  : remain === null
                    ? <span className="muted">&nbsp;</span>
                    : after! < 0
                      ? <span className="badge s-bad">잔여 {remain}일 — {Math.abs(after!)}일 초과라 신청할 수 없습니다</span>
                      : <span className="muted">잔여 {remain}일 · 이 신청 {form.days}일 → <b>남는 잔여 {after}일</b></span>}
              </div>
            </div>
            <div><label htmlFor={`${uid}-3`}>시작<Req/></label><input id={`${uid}-3`} data-testid="l-start_date" type="date" value={form.start_date} onChange={(e) => { const start_date = e.target.value; setForm({ ...form, start_date, days: calcDays(start_date, form.end_date, form.type) }); }} /></div>
            <div><label htmlFor={`${uid}-4`}>종료<Req/></label><input id={`${uid}-4`} data-testid="l-end_date" type="date" value={form.end_date} onChange={(e) => { const end_date = e.target.value; setForm({ ...form, end_date, days: calcDays(form.start_date, end_date, form.type) }); }} /></div>
            <div style={{ gridColumn: "1 / -1" }}><label htmlFor={`${uid}-5`}>사유<Req/></label><input id={`${uid}-5`} data-testid="l-reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
          </div>
          <div className="bd" style={{ display: "flex", gap: 8 }}><button className="btn primary" data-testid="leave-add-submit">신청</button><button type="button" className="btn ghost" data-testid="leave-cancel" onClick={() => setAdding(false)}>취소</button></div>
        </form>
      )}
      <div className="card">
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <b>내 신청 내역</b>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="date" data-testid="lv-from" aria-label="조회 시작일" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150, margin: 0 }} />
            <span className="muted small">~</span>
            <input type="date" data-testid="lv-to" aria-label="조회 종료일" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150, margin: 0 }} />
            {(from || to) ? <button type="button" className="btn ghost sm" onClick={() => { setFrom(""); setTo(""); }}>초기화</button> : <span className="muted small">{shownMine.length}건</span>}
          </span>
        </div>
        <table ref={tableRef} className="tbl fit" data-testid="leave-table">
          <thead><tr>
            <th {...sort.th("type")} style={{ width: 72 }}>종류{sort.mark("type")}</th>
            <th {...sort.th("period")}>기간{sort.mark("period")}</th>
            <th {...sort.th("days")} style={{ width: 56 }}>일수{sort.mark("days")}</th>
            <th {...sort.th("reason", "hide-sm")}>사유{sort.mark("reason")}</th>
            <th {...sort.th("created", "hide-sm")} style={{ width: 92 }}>신청일{sort.mark("created")}</th>
            <th {...sort.th("status")} style={{ width: 78 }}>상태{sort.mark("status")}</th>
            <th {...sort.th("approver", "hide-sm")} style={{ width: 84 }}>승인자{sort.mark("approver")}</th>
          </tr></thead>
          <tbody>
            {mineView.map((l) => <tr key={l.id}><td>{l.type}</td><td>{l.start_date}~{l.end_date}</td><td>{l.days}일</td><td className="muted hide-sm">{l.reason}</td><td className="muted small hide-sm">{dateKST(l.created_at) || "—"}</td><td><span className={"badge " + (SB[l.status] || "s-mute")}>{l.status}</span></td><td className="muted hide-sm">{l.status === "승인" || l.status === "반려" ? uname(l.approver_id || "") : "—"}</td></tr>)}
            {!shownMine.length && <tr><td colSpan={7} className="muted">{!loaded ? "불러오는 중…" : (from || to) ? "해당 기간 신청 내역 없음" : "신청 내역이 없습니다"}</td></tr>}
          </tbody>
        </table>
        <Pager page={mineCur} pages={minePages} set={setMinePage} />
      </div>
    </div>
  );
}
