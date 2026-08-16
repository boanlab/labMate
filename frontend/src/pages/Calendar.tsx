import { useEffect, useState } from "react";
import { richHtml } from "../ui/richHtml";
import { api, apiError } from "../api/client";
import { confirmDialog } from "../ui/dialog";
import { useAuth } from "../auth/AuthContext";
import { PageHeader, Card } from "../ui/kit";
import { useConfig, names } from "../api/config";
import HtmlEditor from "../ui/HtmlEditorLazy";

interface Item { id: string; title: string; date: string; time?: string; type: string; scope?: string; detail?: string; link?: string; attendees?: string[]; start?: string; end?: string; src: string; recurring?: boolean; by_id?: string; }
const SCOPES = ["개인", "전체 구성원", "구성원 선택"];
const REPEATS = ["없음", "매주", "격주", "매월"];
const LAYERS = ["업무", "회의", "마감", "예약", "출장", "휴가", "개인", "기타"];
const TCOL: Record<string, string> = {
  "업무": "#3f5d7d", "회의": "#284072", "마감": "#d8584f", "출장": "#3a9b9b", "개인": "#7b66c4", "기타": "#5a6478",
  "휴가": "#caa53d", "예약": "#2e9e6b",
};

const leaveLayer = (t: string) => (LAYERS.includes(t) ? t : "휴가");

// 로컬 날짜 기준 yyyy-mm-dd (toISOString의 UTC 변환은 KST에서 하루 밀림)
function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function eachDay(start: string, end: string): string[] {
  const out: string[] = []; const s = new Date(start); const e = new Date(end);
  for (let d = new Date(s); d <= e && out.length < 92; d.setDate(d.getDate() + 1)) out.push(ymd(new Date(d)));
  return out;
}
function monthDays(year: number, month: number) {
  const first = new Date(year, month, 1);
  const start = new Date(first); start.setDate(1 - first.getDay());
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(d); }
  return days;
}

export default function Calendar() {
  const { me } = useAuth();
  const today = new Date();
  const EVTYPES = names(useConfig<any[]>("event_types", ["업무", "회의", "마감", "출장", "개인", "기타"]));
  // 일정 수정/삭제: 교수·행정은 전부 / 개인=작성자 / 구성원 선택=참석(담당)자 / 전체 구성원=관리자만
  const isMgr = !!me && (["prof", "staff"].includes(me.role) || !!me.delegated_admin);
  const canEditEvent = (e: Item) => isMgr
    || (e.scope === "개인" && e.by_id === me?.id)
    || (e.scope === "구성원 선택" && (e.attendees || []).includes(me?.id || ""));
  const [items, setItems] = useState<Item[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const [ref, setRef] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [dayModal, setDayModal] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const empty = { id: "", title: "", date: ymd(today), end: "", time: "", type: "업무", scope: "개인", attendees: [] as string[], link: "", repeat: "없음", until: "" };
  const [form, setForm] = useState(empty);
  const [detail, setDetail] = useState("");

  function toggleAttendee(uid: string) {
    setForm((f) => ({ ...f, attendees: f.attendees.includes(uid) ? f.attendees.filter((x) => x !== uid) : [...f.attendees, uid] }));
  }
  const uname = (id: string) => users.find((u) => u.id === id)?.name || "";
  const evLabel = (e: Item) => {
    const n = uname(e.by_id || "");
    if (!n) return e.title;
    if (e.src === "leave") return `${n} · ${e.title}`;
    if (e.src === "booking") return `${e.title} · ${n}`;
    return e.title;
  };
  const canSeeLeaveReason = (uid: string) => isMgr || uid === me?.id;

  async function load() {
    setErr("");
    try {
      const out: Item[] = [];
      const evs = (await api.get<any[]>("/boards/events")).data;
      evs.forEach((e) => {
        const span = e.end_date && e.end_date > e.date ? eachDay(e.date, e.end_date) : [e.date];
        span.forEach((d) => out.push({ id: e.id, title: e.title, date: d, time: e.time, type: e.type, scope: e.scope, detail: e.detail, link: e.link, attendees: e.attendees, start: e.date, end: e.end_date || "", src: "event", recurring: e.recurring, by_id: e.by_id }));
      });
      try {
        const lvs = (await api.get<any[]>("/attendance/leaves/approved")).data;
        lvs.forEach((l) => eachDay(l.start_date, l.end_date).forEach((d) => out.push({
          id: `lv-${l.id}-${d}`, title: l.type, date: d, type: leaveLayer(l.type), src: "leave",
          by_id: l.uid, start: l.start_date, end: l.end_date,
          detail: canSeeLeaveReason(l.uid) ? l.reason : "",
        })));
      } catch { /* optional */ }
      try {
        const bks = (await api.get<any[]>("/resource/bookings")).data;
        bks.forEach((b) => out.push({
          id: `bk-${b.id}`, title: b.resource, date: b.date, type: "예약", src: "booking",
          time: b.end ? `${b.start}~${b.end}` : b.start, by_id: b.by_id, detail: b.purpose,
        }));
      } catch { /* optional */ }
      setItems(out);
    } catch (e) { setErr(apiError(e)); }
  }
  useEffect(() => { load(); api.get<any[]>("/members/users").then((r) => setUsers(r.data)).catch(() => {}); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    const payload = { title: form.title, date: form.date, end_date: form.end && form.end > form.date ? form.end : null, time: form.time, type: form.type, scope: form.scope, detail, link: form.link, repeat: form.repeat, until: form.until || null, attendees: form.scope === "구성원 선택" ? form.attendees : [] };
    try {
      if (form.id) await api.put(`/boards/events/${form.id}`, payload);
      else await api.post("/boards/events", payload);
      setAdding(false); setForm(empty); load();
    } catch (e) { setErr(apiError(e)); }
  }
  async function delEvent(id: string) {
    if (!await confirmDialog("일정을 삭제할까요?")) return;
    try { await api.delete(`/boards/events/${id}`); setDayModal(null); load(); } catch (e) { setErr(apiError(e)); }
  }
  function openNew(date?: string) { setForm({ ...empty, date: date || empty.date }); setDayModal(null); setAdding(true); setDetail(""); }
  function editEvent(it: Item) {
    setForm({ id: it.id, title: it.title, date: it.start || it.date, end: it.end || "", time: it.time || "", type: it.type, scope: it.scope || "개인", attendees: it.attendees || [], link: it.link || "", repeat: "없음", until: "" });
    setDayModal(null); setAdding(true); setDetail(it.detail || "");
  }

  const visible = items.filter((e) => !hidden[e.type]);
  const byDate: Record<string, Item[]> = {};
  visible.forEach((e) => { (byDate[e.date] = byDate[e.date] || []).push(e); });

  const y = ref.getFullYear(), m = ref.getMonth();
  const days = monthDays(y, m);
  const todayStr = ymd(today);

  return (
    <div data-testid="page-calendar">
      <PageHeader crumb="메인 › 캘린더" title="캘린더" action={
        <button className="btn primary" data-testid="event-add-open" onClick={() => (adding ? setAdding(false) : openNew())}>+ 일정 추가</button>
      } />
      {err && <div className="form-err" data-testid="event-error">{err}</div>}
      {adding && (
        <form className="card" onSubmit={save} data-testid="event-form">
          <div className="bd grid3">
            <div><label>구분</label><select data-testid="ev-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{EVTYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
            <div style={{ gridColumn: "span 2" }}><label>제목</label><input data-testid="ev-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><label>시작일</label><input data-testid="ev-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            <div><label>종료일(선택)</label><input data-testid="ev-end" type="date" min={form.date} value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></div>
            <div><label>시간(선택)</label><input data-testid="ev-time" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></div>
            <div style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
              <div><label>반복</label><select data-testid="ev-repeat" value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value })}>{REPEATS.map((r) => <option key={r}>{r}</option>)}</select></div>
              <div><label>참석·공유</label><select data-testid="ev-scope" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>{SCOPES.map((s) => <option key={s}>{s}</option>)}</select></div>
            </div>
            {form.repeat !== "없음" && (
              <div style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
                <div><label>반복 종료일</label><input data-testid="ev-until" type="date" value={form.until} onChange={(e) => setForm({ ...form, until: e.target.value })} /></div>
              </div>
            )}
            {form.scope === "구성원 선택" && (
              <div style={{ gridColumn: "1 / -1" }}>
                <label>구성원 선택{form.attendees.length ? ` · ${form.attendees.length}명` : ""}</label>
                <div className="fchips" data-testid="ev-attendees">
                  {users.filter((u) => u.role !== "admin").map((u) => <button type="button" key={u.id} className={"chip" + (form.attendees.includes(u.id) ? " on" : "")} onClick={() => toggleAttendee(u.id)}>{u.name}</button>)}
                  {!users.length && <span className="muted small">구성원 목록을 불러오는 중…</span>}
                </div>
              </div>
            )}
            <div style={{ gridColumn: "1 / -1" }}><label>링크(선택)</label><input data-testid="ev-link" type="url" placeholder="https://… 관련 자료·회의 링크" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} /></div>
            <div style={{ gridColumn: "1 / -1" }}><label>상세(선택)</label><HtmlEditor value={detail} onChange={setDetail} testid="ev-detail" minHeight={120} /></div>
          </div>
          <div className="bd" style={{ display: "flex", gap: 6 }}>
            <button className="btn primary" data-testid="event-add-submit">{form.id ? "저장" : "추가"}</button>
            <button type="button" className="btn ghost" onClick={() => { setAdding(false); setForm(empty); }}>취소</button>
          </div>
        </form>
      )}

      <div className="callayout">
        <Card title="레이어 표시">
          {LAYERS.map((t) => (
            <div className="layer-row" key={t}>
              <span className="layer-dot" style={{ background: TCOL[t] || "#5a6478" }} />
              <span>{t}</span>
              <button className={"switch" + (!hidden[t] ? " on" : "")} data-testid={`layer-${t}`} onClick={() => setHidden((l) => ({ ...l, [t]: !l[t] }))} />
            </div>
          ))}
        </Card>

        <Card title={`${y}년 ${m + 1}월`} extra={
          <span style={{ display: "flex", gap: 6 }}>
            <button className="btn ghost sm" data-testid="cal-prev" onClick={() => setRef(new Date(y, m - 1, 1))}>◀</button>
            <button className="btn ghost sm" onClick={() => setRef(new Date(today.getFullYear(), today.getMonth(), 1))}>오늘</button>
            <button className="btn ghost sm" data-testid="cal-next" onClick={() => setRef(new Date(y, m + 1, 1))}>▶</button>
          </span>
        }>
          <div className="cal" data-testid="cal-grid">
            {["일", "월", "화", "수", "목", "금", "토"].map((d) => <div className="dow" key={d}>{d}</div>)}
            {days.map((d, i) => {
              const ds = ymd(d); const inMonth = d.getMonth() === m; const evs = byDate[ds] || [];
              return (
                <div key={i} className={"day" + (!inMonth ? " off" : "") + (ds === todayStr ? " today" : "")} onClick={() => inMonth && setDayModal(ds)}>
                  <div className="dn">{d.getDate()}</div>
                  {evs.slice(0, 4).map((e) => <span key={e.id} className="ev" style={{ background: TCOL[e.type] || "#5a6478" }} title={evLabel(e)}>{e.recurring ? "🔁 " : ""}{evLabel(e)}</span>)}
                  {evs.length > 4 && <span className="more">+{evs.length - 4}건</span>}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {dayModal && (
        <div className="modal-ovl" onClick={(e) => { if (e.target === e.currentTarget) setDayModal(null); }}>
          <div className="modal" data-testid="day-modal">
            <div className="modal-h"><b>{dayModal} 일정 <span className="muted small" style={{ fontWeight: 400 }}>· {(byDate[dayModal] || []).length}건</span></b><button className="btn ghost sm" onClick={() => setDayModal(null)}>✕</button></div>
            <div className="modal-b" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {(byDate[dayModal] || []).map((e) => {
                const col = TCOL[e.type] || "#5a6478";
                return (
                  <div key={e.id} style={{ border: "1px solid var(--line)", borderLeft: `3px solid ${col}`, borderRadius: 10, padding: "12px 14px", background: "var(--soft)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14.5, lineHeight: 1.3 }}>{e.recurring ? "🔁 " : ""}{evLabel(e)}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                          <span className="badge" style={{ background: col + "1f", color: col }}>{e.type}</span>
                          {e.time && <span className="muted small">🕘 {e.time}</span>}
                          {e.scope && <span className="muted small">{e.scope}</span>}
                        </div>
                        {e.end && e.start && e.end > e.start && <div className="muted small" style={{ marginTop: 4 }}>📅 {e.start} ~ {e.end}</div>}
                        {e.attendees && e.attendees.length > 0 && <div className="muted small" style={{ marginTop: 4 }}>👥 {e.attendees.map((id) => uname(id) || id.slice(0, 6)).join(", ")}</div>}
                      </div>
                      {e.src === "event" && canEditEvent(e) && <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button className="btn ghost sm" data-testid={`ev-edit-${e.id}`} onClick={() => editEvent(e)}>수정</button>
                        <button className="btn ghost sm" data-testid={`ev-del-${e.id}`} onClick={() => delEvent(e.id)}>삭제</button>
                      </div>}
                    </div>
                    {e.detail && <div className="small" style={{ marginTop: 10, lineHeight: 1.6, color: "var(--ink)" }} dangerouslySetInnerHTML={{ __html: richHtml(e.detail) }} />}
                    {e.link && <div style={{ marginTop: 10 }}><a className="btn ghost sm" href={e.link} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>🔗 링크 열기</a></div>}
                  </div>
                );
              })}
              {!(byDate[dayModal] || []).length && <div className="muted" style={{ padding: 24, textAlign: "center" }}>등록된 일정이 없습니다</div>}
              <button className="btn primary sm" style={{ marginTop: 4, alignSelf: "flex-start" }} onClick={() => openNew(dayModal)}>+ 이 날짜에 추가</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
