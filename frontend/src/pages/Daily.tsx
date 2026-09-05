// 업무일지 — 하루 단위로 '할 일'을 적고 끝나면 체크한다. 본인만 본다.
//
// 세부업무(과제에 매인 일)와 다르다. 여기는 오늘 실제로 손댄 것을 남기는 자리다.
// 주간·월간 보고를 쓸 때 "지난주에 뭐 했더라"를 기억으로 되짚지 않아도 되게,
// 이 기록을 기간별로 묶어 보고서 초안으로 만들어 준다.
import { useEffect, useMemo, useRef, useState } from "react";

import { api, apiError } from "../api/client";
import { todayKST } from "../lib/date";
import { confirmDialog } from "../ui/dialog";
import { Card, PageHeader } from "../ui/kit";
import { MentorButton } from "../ui/Mentor";

interface Log { id: string; date: string; title: string; project_id: string; done: boolean; note: string; order: number }
interface Proj { id: string; code: string; name: string }

/** Date → YYYY-MM-DD. toISOString 은 UTC 로 바꾸므로 한국(UTC+9)에서는 하루가 밀린다 — 지역 시간 그대로 쓴다. */
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** 날짜를 하루씩 옮긴다. */
function shift(day: string, days: number): string {
  const d = new Date(day + "T00:00:00");
  d.setDate(d.getDate() + days);
  return iso(d);
}
/** 그 주의 월요일(주간 보고 기준). */
function monday(day: string): string {
  const d = new Date(day + "T00:00:00");
  return shift(day, -((d.getDay() + 6) % 7));
}
const firstOfMonth = (day: string) => day.slice(0, 8) + "01";
/** 그 달의 마지막 날. */
function endOfMonth(day: string): string {
  const d = new Date(day + "T00:00:00");
  return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}
/** 달을 n 개 옮긴 그 달의 1일. */
function addMonth(day: string, n: number): string {
  const d = new Date(day + "T00:00:00");
  return iso(new Date(d.getFullYear(), d.getMonth() + n, 1));
}
const WD = ["일", "월", "화", "수", "목", "금", "토"];
const label = (day: string) => `${day} (${WD[new Date(day + "T00:00:00").getDay()]})`;

export default function Daily() {
  const today = todayKST();
  const [day, setDay] = useState(today);
  const [logs, setLogs] = useState<Log[]>([]);        // 화면에 필요한 기간을 통째로 받아 둔다
  const [projects, setProjects] = useState<Proj[]>([]);
  const [title, setTitle] = useState("");
  const [proj, setProj] = useState("");
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [span, setSpan] = useState<"week" | "month">("week");
  // 보고 기간은 일지에서 보고 있는 날과 따로 움직인다 — 뒤늦게 지난주 보고를 써야 하는 일이 흔하다.
  const [anchor, setAnchor] = useState(today);
  const [report, setReport] = useState("");
  const addRef = useRef<HTMLInputElement | null>(null);

  // 보고 기간은 달을 걸칠 수 있다(예: 8/31~9/6). 보고 있는 달과 보고 기간을 모두 덮는 범위를 받는다.
  const range = span === "week" ? [monday(anchor), shift(monday(anchor), 6)] : [firstOfMonth(anchor), endOfMonth(anchor)];
  const from = [firstOfMonth(addMonth(day, -1)), range[0]].sort()[0];   // 지난달까지 훑어 남은 일을 찾는다
  const to = [endOfMonth(day), range[1]].sort()[1];

  async function load() {
    try {
      setLogs((await api.get<Log[]>(`/projects/dailylogs?start=${from}&end=${to}`)).data);
    } catch (e) { setErr(apiError(e)); } finally { setLoaded(true); }
  }
  useEffect(() => { load(); }, [from, to]);
  useEffect(() => {
    Promise.all([api.get<Proj[]>("/projects/projects?kind=grant"), api.get<Proj[]>("/projects/projects?kind=activity")])
      .then(([g, a]) => setProjects([...g.data, ...a.data])).catch(() => {});
  }, []);

  const codeOf = (id: string) => projects.find((p) => p.id === id)?.code || "";
  const ofDay = useMemo(() => logs.filter((l) => l.date === day).sort((a, b) => a.order - b.order), [logs, day]);
  const doneN = ofDay.filter((l) => l.done).length;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setErr("");
    try {
      const { data } = await api.post<Log>("/projects/dailylogs",
        { date: day, title: title.trim(), project_id: proj, order: ofDay.length });
      setLogs((ls) => [...ls, data]);
      setTitle(""); addRef.current?.focus();
    } catch (e) { setErr(apiError(e)); }
  }
  /** 화면만 먼저 바꾼다 — 글자를 칠 때마다 서버로 보내지 않기 위해. */
  function setLocal(id: string, body: Partial<Log>) {
    setLogs((ls) => ls.map((x) => x.id === id ? { ...x, ...body } : x));
  }
  /** 서버에 반영. 실패하면 서버 값으로 되돌린다. */
  async function save(l: Log, body: Partial<Log>) {
    setLocal(l.id, body);
    try { await api.patch(`/projects/dailylogs/${l.id}`, body); }
    catch (e) { setErr(apiError(e)); load(); }
  }
  async function del(l: Log) {
    if (!await confirmDialog(`"${l.title}"을(를) 지울까요?`, { danger: true })) return;
    try { await api.delete(`/projects/dailylogs/${l.id}`); setLogs((ls) => ls.filter((x) => x.id !== l.id)); }
    catch (e) { setErr(apiError(e)); }
  }
  /** 지난 날들에서 아직 못 끝낸 일을 이 날로 가져온다 — 매번 다시 적지 않게.
   *  지난 기록은 그대로 둔다(그 날 못 끝냈다는 사실이 일지의 내용이다).
   *  같은 제목은 하나만, 이미 이 날에 있는 것은 건너뛴다. */
  async function carryOver() {
    const here = new Set(ofDay.map((l) => l.title.trim()));
    const pick = new Map<string, Log>();
    logs.filter((l) => l.date < day && !l.done)
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach((l) => { const t = l.title.trim(); if (t && !here.has(t)) pick.set(t, l); });
    const prev = [...pick.values()].slice(0, 20);      // 한 번에 쏟아지지 않게 상한을 둔다
    if (!prev.length) return setErr("가져올 남은 일이 없습니다");
    setErr("");
    try {
      const made = await Promise.all(prev.map((l, i) => api.post<Log>("/projects/dailylogs",
        { date: day, title: l.title, project_id: l.project_id, note: l.note, order: ofDay.length + i })));
      setLogs((ls) => [...ls, ...made.map((r) => r.data)]);
    } catch (e) { setErr(apiError(e)); }
  }

  // ── 보고서 초안 — 기간 안의 기록을 과제별로 묶는다(사실만, AI 없이) ──
  function buildReport(): string {
    const rows = logs.filter((l) => l.date >= range[0] && l.date <= range[1]);
    if (!rows.length) return "";
    const groups: Record<string, Log[]> = {};
    rows.forEach((l) => { (groups[codeOf(l.project_id) || "기타"] ||= []).push(l); });
    const head = `[${span === "week" ? "주간" : "월간"} 업무 보고] ${range[0]} ~ ${range[1]}`;
    const body = Object.keys(groups).sort().map((code) => {
      const lines = groups[code]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((l) => `- ${l.date} ${l.title}${l.note ? ` — ${l.note}` : ""}${l.done ? "" : " (진행 중)"}`);
      return `${code}\n${lines.join("\n")}`;
    }).join("\n\n");
    const n = rows.length, d = rows.filter((l) => l.done).length;
    return `${head}\n\n${body}\n\n합계: ${n}건 중 완료 ${d}건 · 진행 중 ${n - d}건`;
  }
  function makeReport() {
    const t = buildReport();
    setReport(t);
    if (!t) setErr("이 기간에 기록이 없습니다");
  }

  return (
    <div data-testid="page-daily">
      <PageHeader crumb="업무 › 업무일지" title="업무일지"
        action={<span className="muted small">본인만 볼 수 있습니다</span>} />
      {err && <div className="form-err" data-testid="daily-error">{err}</div>}

      <Card title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <button className="btn ghost sm" data-testid="daily-prev" aria-label="이전 날" onClick={() => setDay(shift(day, -1))}>‹</button>
          <input type="date" data-testid="daily-date" value={day} onChange={(e) => setDay(e.target.value || today)} style={{ margin: 0, width: 160 }} />
          <button className="btn ghost sm" data-testid="daily-next" aria-label="다음 날" onClick={() => setDay(shift(day, 1))}>›</button>
          {day !== today && <button className="btn ghost sm" onClick={() => setDay(today)}>오늘</button>}
        </span>
      } extra={<span className="muted small">{label(day)} · {ofDay.length}건 중 완료 {doneN}건</span>}>

        <form onSubmit={add} className="field-head" style={{ marginTop: 0 }}>
          <input ref={addRef} data-testid="daily-add-title" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="오늘 할 일을 적으세요" style={{ margin: 0, flex: "1 1 260px" }} aria-label="할 일" />
          <select data-testid="daily-add-proj" value={proj} onChange={(e) => setProj(e.target.value)} aria-label="과제" style={{ margin: 0, maxWidth: 220 }}>
            <option value="">과제 없음</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
          </select>
          <button className="btn primary sm" data-testid="daily-add" type="submit">추가</button>
          <button className="btn ghost sm" type="button" data-testid="daily-carry" title="지난 날들에서 아직 못 끝낸 일을 이 날로 가져옵니다" onClick={carryOver}>남은 일 가져오기</button>
        </form>

        {ofDay.map((l) => (
          <div key={l.id} data-testid={`daily-row-${l.id}`} className="daily-row">
            <input type="checkbox" checked={l.done} onChange={(e) => save(l, { done: e.target.checked })}
              aria-label={`${l.title} 완료`} data-testid={`daily-done-${l.id}`} style={{ margin: 0 }} />
            <input value={l.title} onChange={(e) => setLocal(l.id, { title: e.target.value })} onBlur={(e) => save(l, { title: e.target.value })}
              className={l.done ? "daily-done" : ""} aria-label="할 일" style={{ margin: 0, flex: "2 1 220px" }} />
            <select value={l.project_id} onChange={(e) => save(l, { project_id: e.target.value })} aria-label="과제" style={{ margin: 0, flex: "0 1 170px" }}>
              <option value="">과제 없음</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
            </select>
            <input value={l.note} onChange={(e) => setLocal(l.id, { note: e.target.value })} onBlur={(e) => save(l, { note: e.target.value })}
              placeholder="한 일·결과" aria-label="한 일·결과" style={{ margin: 0, flex: "2 1 220px" }} />
            <button className="btn ghost sm" onClick={() => del(l)} aria-label="삭제" style={{ color: "var(--bad-text)" }}>✕</button>
          </div>
        ))}
        {!ofDay.length && <div className="muted" style={{ padding: "10px 2px" }}>{loaded ? "이 날 기록이 없습니다" : "불러오는 중…"}</div>}

        {!!ofDay.length && (
          <div className="field-head">
            <span className="muted small">적어 둔 일이 '무엇을 어디까지' 분명한지 봐 줍니다</span>
            <MentorButton feature="task" label="할 일 점검" testid="daily-mentor" collect={() => ({
              title: `${label(day)} 할 일`,
              body: ofDay.map((l) => {
                const code = codeOf(l.project_id);
                return `- ${l.title}${code ? ` [${code}]` : ""}${l.note ? ` — ${l.note}` : ""} (${l.done ? "완료" : "진행 중"})`;
              }).join("\n"),
              context: { 날짜: day, 적은_일: ofDay.length, 완료: doneN },
            })} />
          </div>
        )}
      </Card>

      <Card title="업무 보고 만들기" extra={
        <span style={{ display: "inline-flex", gap: 6 }}>
          <button className={"btn sm " + (span === "week" ? "primary" : "ghost")} data-testid="daily-span-week" onClick={() => setSpan("week")}>주간</button>
          <button className={"btn sm " + (span === "month" ? "primary" : "ghost")} data-testid="daily-span-month" onClick={() => setSpan("month")}>월간</button>
        </span>}>
        <div className="field-head" style={{ marginTop: 0 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <button className="btn ghost sm" data-testid="daily-rep-prev" aria-label={span === "week" ? "이전 주" : "이전 달"}
              onClick={() => setAnchor(span === "week" ? shift(anchor, -7) : addMonth(anchor, -1))}>‹</button>
            {span === "week"
              ? <input type="date" data-testid="daily-rep-week" value={anchor} aria-label="보고할 주 — 그 주의 아무 날이나 고르세요"
                  title="고른 날이 속한 주(월~일) 전체가 보고 기간이 됩니다"
                  onChange={(e) => setAnchor(e.target.value || today)} style={{ margin: 0, width: 160 }} />
              : <input type="month" data-testid="daily-rep-month" value={anchor.slice(0, 7)} aria-label="보고할 달"
                  onChange={(e) => setAnchor(e.target.value ? `${e.target.value}-01` : today)} style={{ margin: 0, width: 140 }} />}
            <button className="btn ghost sm" data-testid="daily-rep-next" aria-label={span === "week" ? "다음 주" : "다음 달"}
              onClick={() => setAnchor(span === "week" ? shift(anchor, 7) : addMonth(anchor, 1))}>›</button>
            {range[0] !== (span === "week" ? monday(today) : firstOfMonth(today)) &&
              <button className="btn ghost sm" data-testid="daily-rep-now" onClick={() => setAnchor(today)}>{span === "week" ? "이번 주" : "이번 달"}</button>}
            <span className="muted small">
              {span === "week"
                ? <>이 날이 속한 주 → {label(range[0])} ~ {label(range[1])}</>
                : <>{Number(range[0].slice(0, 4))}년 {Number(range[0].slice(5, 7))}월 전체 · {range[0]} ~ {range[1]}</>}
            </span>
          </span>
          <button className="btn primary sm" data-testid="daily-report" onClick={makeReport}>보고서 초안 만들기</button>
        </div>
        {report && (
          <>
            <textarea value={report} onChange={(e) => setReport(e.target.value)} data-testid="daily-report-out"
              style={{ width: "100%", minHeight: 220, fontFamily: "inherit" }} aria-label="보고서 초안" />
            <div className="field-head">
              <span className="muted small">그대로 결재 기안·주간보고에 붙여 넣으세요</span>
              <MentorButton feature="report" label="멘토 점검" collect={() => ({
                title: `${span === "week" ? "주간" : "월간"} 업무 보고 (${range[0]} ~ ${range[1]})`,
                body: report,
                context: { 기간: `${range[0]} ~ ${range[1]}` },
              })} onApply={(t) => setReport(t)} />
              <button className="btn ghost sm" onClick={() => navigator.clipboard.writeText(report).catch(() => setErr("복사하지 못했습니다"))}>복사</button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
