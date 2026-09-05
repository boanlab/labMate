// 목표(OKR) — 분기 단위 목표와 측정 가능한 결과지표.
//
// 큰 목표 하나보다 작게 쪼갠 여러 개가 완료율이 높다. 그래서 목표 아래에
// '무엇이 얼마나 되면 달성인지'를 숫자로 적게 하고, 달성률을 자동으로 보여 준다.
// 교수는 연구실 전체를 보고 지도에 쓴다.
import { useEffect, useId, useState } from "react";

import { api, apiError } from "../api/client";
import { useDirectory } from "../api/directory";
import { useAuth } from "../auth/AuthContext";
import { confirmDialog } from "../ui/dialog";
import { Card, PageHeader, Req } from "../ui/kit";
import { MentorButton } from "../ui/Mentor";

interface KR { id: string; objective_id: string; title: string; unit: string; target: number; current: number; order: number }
interface Objective { id: string; owner_id: string; period: string; title: string; note: string; order: number; key_results: KR[] }

const quarterOf = (d: Date) => Math.floor(d.getMonth() / 3) + 1;
/** 분기 라벨 — 예: 2026-3분기 */
function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${quarterOf(d)}분기`;
}

function rate(o: Objective): number {
  if (!o.key_results.length) return 0;
  const sum = o.key_results.reduce((a, k) => a + Math.min(1, k.target > 0 ? k.current / k.target : 0), 0);
  return Math.round((sum / o.key_results.length) * 100);
}

export default function Goals() {
  const { me } = useAuth();
  const isMgr = me?.role === "prof" || me?.role === "staff" || me?.role === "admin";
  // 목표를 세우는 것은 연구를 하는 사람의 일이다 — 지도교수도 본인 목표를 둔다.
  // 행정·관리자는 연구 목표의 주체가 아니라 조회만 한다.
  const canAdd = !!me && me.role !== "staff" && me.role !== "admin";
  const uid = useId();
  const nameOf = useDirectory();
  const [period, setPeriod] = useState(currentPeriod());
  const [list, setList] = useState<Objective[]>([]);
  const [err, setErr] = useState("");
  // 분기 하나만 보면 한 해 흐름이 안 보인다 — 네 분기를 나란히 놓는 보기를 함께 둔다.
  const [view, setView] = useState<"quarter" | "year">("quarter");
  const [adding, setAdding] = useState(false);
  const [addPeriod, setAddPeriod] = useState("");     // 연간 보기에서 고른 분기(비면 지금 보는 분기)
  const [overQ, setOverQ] = useState("");             // 드래그가 올라와 있는 분기
  const [form, setForm] = useState({ title: "", note: "" });

  async function load() {
    // 연간 보기는 네 분기를 다 보여 줘야 하므로 기간을 걸지 않고 받아 화면에서 나눈다.
    const q = view === "year" ? "" : `?period=${encodeURIComponent(period)}`;
    try { setList((await api.get<Objective[]>(`/projects/objectives${q}`)).data); }
    catch (e) { setErr(apiError(e)); }
  }
  useEffect(() => { load(); }, [period, view]);

  const target = addPeriod || period;                 // 새 목표가 들어갈 분기
  async function addObjective() {
    if (!form.title.trim()) return setErr("목표를 입력하세요");
    try {
      await api.post("/projects/objectives", { period: target, title: form.title, note: form.note });
      setForm({ title: "", note: "" }); setAdding(false); setAddPeriod(""); setErr(""); load();
    } catch (e) { setErr(apiError(e)); }
  }
  /** 목표를 다른 분기로 옮긴다(연간 보기의 드래그&드롭). */
  async function moveTo(oid: string, to: string) {
    const o = list.find((x) => x.id === oid);
    if (!o || o.period === to) return;
    setList((ls) => ls.map((x) => x.id === oid ? { ...x, period: to } : x));   // 먼저 옮겨 보이고
    try { await api.patch(`/projects/objectives/${oid}`, { period: to }); }
    catch (e) { setErr(apiError(e)); load(); }                                  // 실패하면 서버 값으로 되돌린다
  }
  async function delObjective(o: Objective) {
    if (!await confirmDialog(`"${o.title}" 목표와 결과지표를 모두 삭제할까요?`, { danger: true })) return;
    try { await api.delete(`/projects/objectives/${o.id}`); load(); } catch (e) { setErr(apiError(e)); }
  }
  async function addKR(o: Objective) {
    const el = document.getElementById(`${uid}-kr-${o.id}`) as HTMLInputElement;
    const title = el?.value?.trim();
    if (!title) return;
    try { await api.post(`/projects/objectives/${o.id}/key-results`, { title, unit: "건", target: 1, current: 0 }); el.value = ""; load(); }
    catch (e) { setErr(apiError(e)); }
  }
  async function patchKR(k: KR, body: Partial<KR>) {
    try { await api.patch(`/projects/key-results/${k.id}`, body); load(); } catch (e) { setErr(apiError(e)); }
  }
  async function delKR(k: KR) {
    try { await api.delete(`/projects/key-results/${k.id}`); load(); } catch (e) { setErr(apiError(e)); }
  }

  const thisYear = new Date().getFullYear();
  const years = Array.from(new Set([
    ...[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map(String),
    ...list.map((o) => o.period.slice(0, 4)),
  ])).sort().reverse();
  const year = period.slice(0, 4);
  // 분기 보기는 그 분기만 받아 오므로 list 가 곧 그 분기다. 사람별로 묶어 보여 준다.
  const byOwner: Record<string, Objective[]> = {};
  if (view === "quarter") list.forEach((o) => { (byOwner[o.owner_id] ||= []).push(o); });

  return (
    <div>
      <PageHeader crumb="업무 › 목표" title="목표(OKR)" />
      {err && <div className="form-err" data-testid="goal-err">{err}</div>}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        {/* 연도와 분기를 따로 고른다 — 붙여 두면 목록이 길어지고 원하는 조합을 찾기 어렵다 */}
        <label htmlFor={`${uid}-y`} className="muted small">연도</label>
        <select id={`${uid}-y`} data-testid="goal-year" value={year} style={{ width: 100 }}
          onChange={(e) => setPeriod(`${e.target.value}-${period.slice(5)}`)}>
          {years.map((y) => <option key={y}>{y}</option>)}
        </select>
        {view === "quarter" && (<>
          <label htmlFor={`${uid}-p`} className="muted small">분기</label>
          <select id={`${uid}-p`} data-testid="goal-period" value={period.slice(5, 6)} style={{ width: 90 }}
            onChange={(e) => setPeriod(`${year}-${e.target.value}분기`)}>
            {[1, 2, 3, 4].map((q) => <option key={q} value={String(q)}>{q}분기</option>)}
          </select>
        </>)}
        <div style={{ display: "flex", gap: 4 }}>
          <button className={"btn sm " + (view === "quarter" ? "primary" : "ghost")} data-testid="goal-view-quarter" onClick={() => setView("quarter")}>분기</button>
          <button className={"btn sm " + (view === "year" ? "primary" : "ghost")} data-testid="goal-view-year" onClick={() => setView("year")}>연간</button>
        </div>
        {canAdd && view === "quarter" && (
          <button className="btn primary sm" data-testid="goal-add-open" onClick={() => { setAddPeriod(""); setAdding((v) => !v); }} style={{ marginLeft: "auto" }}>
            {adding ? "닫기" : "+ 목표 추가"}
          </button>
        )}
      </div>

      {adding && (
        <Card title={`새 목표 · ${target}`}>
          <label htmlFor={`${uid}-t`}>목표<Req/></label>
          <input id={`${uid}-t`} data-testid="goal-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="예: 1저자 논문 1편을 국제학회에 투고한다" />
          <label htmlFor={`${uid}-n`}>메모 (선택)</label>
          <input id={`${uid}-n`} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <button className="btn primary" data-testid="goal-add-submit" onClick={addObjective}>추가</button>
            <button className="btn ghost" onClick={() => { setAdding(false); setAddPeriod(""); }}>취소</button>
            <MentorButton feature="task" label="목표 점검" collect={() => ({
              title: form.title, body: form.note, context: { 분기: target },
            })} />
          </div>
        </Card>
      )}

      {view === "year" && (
        <div className="okr-year" data-testid="okr-year">
          {[1, 2, 3, 4].map((q) => {
            const key = `${year}-${q}분기`;
            const objs = list.filter((o) => o.period === key);
            const avg = objs.length ? Math.round(objs.reduce((a, o) => a + rate(o), 0) / objs.length) : 0;
            return (
              <div key={key} className={"okr-drop" + (overQ === key ? " over" : "")} data-testid={`okr-drop-${q}`}
                onDragOver={(e) => { e.preventDefault(); setOverQ(key); }}
                onDragLeave={() => setOverQ((v) => v === key ? "" : v)}
                onDrop={(e) => { e.preventDefault(); setOverQ(""); moveTo(e.dataTransfer.getData("text/plain"), key); }}>
                <Card testid={`okr-q-${q}`}
                  title={<span>{q}분기 <span className="muted small">{objs.length ? `${objs.length}건 · 평균 ${avg}%` : "없음"}</span></span>}
                  extra={<span style={{ display: "inline-flex", gap: 4 }}>
                    {canAdd && <button className="btn ghost sm" data-testid={`okr-add-${q}`} title={`${key}에 목표 추가`}
                      onClick={() => { setAddPeriod(key); setAdding(true); }}>+ 목표</button>}
                    <button className="btn ghost sm" onClick={() => { setPeriod(key); setView("quarter"); }}>열기</button>
                  </span>}>
                  {/* 끌어서 다른 분기로 옮긴다. 본인 목표(교수·행정은 전체)만 잡히게 한다. */}
                  {objs.map((o) => (
                    <div key={o.id} className="okr-mini" data-testid="okr-mini"
                      draggable={o.owner_id === me?.id || isMgr}
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", o.id); e.dataTransfer.effectAllowed = "move"; }}
                      title={`${o.title}\n끌어서 다른 분기로 옮길 수 있습니다`}>
                      <div className="okr-mini-t">{o.title}</div>
                      <div className="muted small">{isMgr ? `${nameOf(o.owner_id)} · ` : ""}달성 {rate(o)}%</div>
                      <div className="okr-bar"><span style={{ width: `${rate(o)}%` }} /></div>
                    </div>
                  ))}
                  {!objs.length && <div className="muted small">{overQ === key ? "여기로 옮깁니다" : "등록된 목표가 없습니다"}</div>}
                </Card>
              </div>
            );
          })}
        </div>
      )}

      {view === "quarter" && !list.length && <Card title={period}><div className="muted">이 분기에 등록된 목표가 없습니다.</div></Card>}

      {Object.entries(byOwner).map(([owner, objs]) => (
        <Card key={owner} title={isMgr ? nameOf(owner) : period} testid="goal-group">
          {objs.map((o) => {
            const r = rate(o);
            const mine = o.owner_id === me?.id;
            return (
              <div key={o.id} className="okr" data-testid="okr-item">
                <div className="okr-head">
                  <b>{o.title}</b>
                  <span className={"badge " + (r >= 70 ? "s-ok" : r >= 30 ? "s-wait" : "s-bad")} data-testid="okr-rate">{r}%</span>
                </div>
                {o.note && <div className="muted small">{o.note}</div>}
                <div className="okr-bar"><span style={{ width: `${r}%` }} /></div>

                {o.key_results.map((k) => (
                  <div key={k.id} className="kr-row">
                    <span className="kr-title">{k.title}</span>
                    {mine || isMgr ? (
                      <>
                        <input type="number" data-testid="kr-current" aria-label={`${k.title} 현재값`} value={k.current} min={0}
                          onChange={(e) => patchKR(k, { current: Number(e.target.value) })} style={{ width: 74 }} />
                        <span className="muted small">/ {k.target}{k.unit}</span>
                        <button className="btn ghost sm" aria-label="결과지표 삭제" onClick={() => delKR(k)}>✕</button>
                      </>
                    ) : <span className="muted small">{k.current} / {k.target}{k.unit}</span>}
                  </div>
                ))}
                {!o.key_results.length && <div className="muted small">결과지표가 없습니다 — 무엇이 얼마나 되면 달성인지 숫자로 적어 보세요.</div>}

                {(mine || isMgr) && (
                  <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                    <input id={`${uid}-kr-${o.id}`} data-testid="kr-new" aria-label={`${o.title} 결과지표 추가`} placeholder="결과지표 (예: 학회 투고 1편)" style={{ flex: 1, minWidth: 180 }} />
                    <button className="btn ghost sm" data-testid="kr-add" onClick={() => addKR(o)}>지표 추가</button>
                    <button className="btn ghost sm" onClick={() => delObjective(o)} style={{ color: "var(--bad-text)" }}>목표 삭제</button>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      ))}
    </div>
  );
}
