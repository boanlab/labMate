import { useEffect, useState, useId } from "react";
import { todayKST } from "../lib/date";
import { api, apiError } from "../api/client";
import { Chips, formSnapshot, confirmDiscard } from "../ui/kit";
import { useColumnResize, useTableSort } from "../ui/tableTools";
import { useAuth } from "../auth/AuthContext";
import { useConfig } from "../api/config";
import { confirmDialog } from "../ui/dialog";

interface Bk { id: string; resource: string; date: string; start: string; end: string; purpose: string; by_id: string; }
const RESOURCES_FB = ["세미나실", "회의실", "GPU 서버", "공용 워크스테이션", "실험장비"];

export default function Booking() {
  const tableRef = useColumnResize("booking");   // 컬럼 폭 조절
  const sort = useTableSort();   // 머리글 클릭 정렬
  const uid = useId();   // 라벨-입력 연결용 고유 접두사
  const { me } = useAuth();
  const RESOURCE_MASTERS = useConfig<string[]>("booking_resources", RESOURCES_FB);
  const [items, setItems] = useState<Bk[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [bookableAssets, setBookableAssets] = useState<string[]>([]);   // 자산에서 '예약 대상'으로 표시한 장비
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState("");
  const today = todayKST();
  const empty = { resource: "세미나실", date: today, start: "10:00", end: "11:00", purpose: "" };
  const [form, setForm] = useState(empty);
  const [snap, setSnap] = useState("");   // 폼 초기 상태 — 작성 중 이탈 경고 판정용
  const [view, setView] = useState<"예정" | "지난" | "전체">("예정");   // 예약 화면의 관심사는 '앞으로'다
  const [resFilter, setResFilter] = useState("전체");
  const RESOURCES = [...new Set([...RESOURCE_MASTERS, ...bookableAssets])];
  const canEdit = (b: Bk) => !!me && (b.by_id === me.id || me.role === "prof");   // 본인 예약 또는 교수만
  const uname = (id: string) => users.find((u) => u.id === id)?.name || "—";

  // 예약은 "언제 비어 있나"를 보는 화면이다. 등록순으로 섞어 두면 지난 예약이 위에 남아 쓸모가 없다.
  // 예정은 가까운 순, 지난 예약은 최근 순으로 정렬하고 기본은 예정만 보여준다.
  const key = (b: Bk) => `${b.date} ${b.start}`;
  const isPast = (b: Bk) => key(b) < `${today} ${new Date().toTimeString().slice(0, 5)}`;
  const upcoming = items.filter((b) => !isPast(b)).sort((a, c) => key(a).localeCompare(key(c)));
  const past = items.filter(isPast).sort((a, c) => key(c).localeCompare(key(a)));
  const byView = view === "예정" ? upcoming : view === "지난" ? past : [...upcoming, ...past];
  const shown = sort.apply(byView.filter((b) => resFilter === "전체" || b.resource === resFilter),
    { resource: (b) => b.resource, date: (b) => `${b.date} ${b.start}`, time: (b) => b.start,
      by: (b) => uname(b.by_id), purpose: (b) => b.purpose });

  const [loaded, setLoaded] = useState(false);   // 첫 조회 완료 여부 — "없음"과 "불러오는 중"을 구분
  async function load() {
    try {
      setItems((await api.get<Bk[]>("/resource/bookings")).data);
      api.get<{ id: string; name: string }[]>("/members/users").then((r) => setUsers(r.data)).catch(() => {});
      // 예약 대상 = 마스터데이터 목록 + 자산에서 예약 가능으로 표시한 장비
      api.get<any[]>("/resource/assets")
        .then((r) => setBookableAssets((r.data || []).filter((a) => a.bookable).map((a) => a.name)))
        .catch(() => {});
    } catch (e) { setErr(apiError(e)); } finally { setLoaded(true); }
  }
  useEffect(() => { load(); }, []);

  function openNew() { setEditId(""); setForm(empty); setAdding(true); setSnap(formSnapshot(empty)); }
  function closeForm() { setAdding(false); setEditId(""); setForm(empty); setSnap(""); }
  // 상단 토글 — 작성 중이면 확인 후 닫는다
  async function toggleForm() {
    if (!adding) return openNew();
    if (!(await confirmDiscard(formSnapshot(form) !== snap))) return;
    closeForm();
  }
  function startEdit(b: Bk) { const f = { resource: b.resource, date: b.date, start: b.start, end: b.end, purpose: b.purpose }; setEditId(b.id); setForm(f); setAdding(true); setSnap(formSnapshot(f)); }

  async function add(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    // 종료가 시작보다 빠르면 길이가 음수인 예약이 만들어진다 — 저장 전에 막는다.
    if (!form.date) return setErr("일자를 선택하세요");
    if (!form.start || !form.end) return setErr("시작·종료 시간을 입력하세요");
    if (form.end <= form.start) return setErr("종료 시간이 시작 시간보다 빠르거나 같습니다");
    if (!editId && form.date < today) return setErr("지난 날짜는 예약할 수 없습니다");
    try {
      if (editId) await api.patch(`/resource/bookings/${editId}`, form);
      else await api.post("/resource/bookings", form);
      setAdding(false); setEditId(""); setForm(empty); load();
    } catch (e) { setErr(apiError(e)); }
  }
  async function del(b: Bk) {
    if (!await confirmDialog(`${b.resource} 예약(${b.date} ${b.start}~${b.end})을 삭제할까요?`, { danger: true })) return;
    try { await api.delete(`/resource/bookings/${b.id}`); load(); } catch (e) { setErr(apiError(e)); }
  }

  return (
    <div data-testid="page-booking">
      <div className="page-head">
        <div><div className="crumb">업무 › 자원예약</div><h1>자원예약</h1></div>
        <button className={"btn " + (adding ? "ghost" : "primary")} data-testid="booking-add-open" onClick={toggleForm}>{adding ? "닫기" : "+ 예약"}</button>
      </div>
      {err && <div className="form-err" data-testid="booking-error">{err}</div>}
      {adding && (
        <form className="card" onSubmit={add} data-testid="booking-form">
          {editId && <div className="card-h"><b>예약 수정</b></div>}
          <div className="bd grid2">
            <div><label htmlFor={`${uid}-1`}>자원</label><select id={`${uid}-1`} data-testid="bk-resource" value={form.resource} onChange={(e) => setForm({ ...form, resource: e.target.value })}>{RESOURCES.map((r) => <option key={r}>{r}</option>)}</select></div>
            <div><label htmlFor={`${uid}-2`}>일자</label><input id={`${uid}-2`} data-testid="bk-date" type="date" min={editId ? undefined : today} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            <div><label htmlFor={`${uid}-3`}>시작</label><input id={`${uid}-3`} type="time" data-testid="bk-start" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} required /></div>
            <div><label htmlFor={`${uid}-4`}>종료</label><input id={`${uid}-4`} type="time" data-testid="bk-end" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} required /></div>
            <div style={{ gridColumn: "1 / -1" }}><label htmlFor={`${uid}-5`}>용도</label><input id={`${uid}-5`} data-testid="bk-purpose" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></div>
          </div>
          <div className="bd" style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" data-testid="booking-add-submit">{editId ? "저장" : "예약"}</button>
            <button type="button" className="btn ghost" onClick={toggleForm}>취소</button>
          </div>
        </form>
      )}
      <div className="tbar">
        <Chips testid="bk-view" value={view} onChange={(v) => setView(v as any)}
          items={[{ key: "예정", count: upcoming.length }, { key: "지난", count: past.length }, { key: "전체", count: items.length }]} />
        <select aria-label="자원 필터" data-testid="bk-res-filter" value={resFilter} onChange={(e) => setResFilter(e.target.value)} style={{ width: "auto", margin: 0 }}>
          {["전체", ...RESOURCES].map((r) => <option key={r}>{r}</option>)}
        </select>
        <span className="muted small" style={{ marginLeft: "auto" }}>{shown.length}건</span>
      </div>
      <div className="card">
        <table ref={tableRef} className="tbl fit" data-testid="booking-table">
          <thead><tr>
            <th {...sort.th("resource")} style={{ width: 140 }}>자원{sort.mark("resource")}</th>
            <th {...sort.th("date")} style={{ width: 128 }}>일자{sort.mark("date")}</th>
            <th {...sort.th("time")} style={{ width: 116 }}>시간{sort.mark("time")}</th>
            <th {...sort.th("by", "hide-sm")} style={{ width: 92 }}>예약자{sort.mark("by")}</th>
            <th {...sort.th("purpose")}>용도{sort.mark("purpose")}</th>
            <th style={{ width: 124 }}>작업</th>
          </tr></thead>
          <tbody>
            {shown.map((b) => (
              <tr key={b.id} style={b.date === today ? { background: "var(--bsoft)" } : undefined}>
                <td>{b.resource}</td>
                <td>{b.date}{b.date === today && <span className="badge s-ok" style={{ marginLeft: 6 }}>오늘</span>}</td>
                <td>{b.start}~{b.end}</td><td className="hide-sm">{uname(b.by_id)}</td><td>{b.purpose}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {canEdit(b) ? <>
                    <button className="btn ghost sm" data-testid={`bk-edit-${b.id}`} onClick={() => startEdit(b)}>수정</button>{" "}
                    <button className="btn ghost sm" data-testid={`bk-del-${b.id}`} style={{ color: "var(--bad-text)" }} onClick={() => del(b)}>삭제</button>
                  </> : <span className="muted small">—</span>}
                </td>
              </tr>
            ))}
            {!shown.length && (
              <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 20 }}>
                {items.length === 0
                  ? <>아직 등록된 예약이 없습니다 — 위 <b>+ 예약</b>으로 세미나실·장비를 잡아보세요.</>
                  : view === "예정" ? "예정된 예약이 없습니다 — 지금 비어 있습니다." : "해당 조건의 예약이 없습니다."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
