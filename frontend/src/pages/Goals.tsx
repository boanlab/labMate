// 목표(OKR) — 학기 단위 목표와 측정 가능한 결과지표.
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

/** 학기 라벨 — 3~8월을 1학기, 나머지를 2학기로 본다. */
function currentPeriod(): string {
  const d = new Date();
  const m = d.getMonth() + 1;
  return `${d.getFullYear()}-${m >= 3 && m <= 8 ? 1 : 2}학기`;
}

function rate(o: Objective): number {
  if (!o.key_results.length) return 0;
  const sum = o.key_results.reduce((a, k) => a + Math.min(1, k.target > 0 ? k.current / k.target : 0), 0);
  return Math.round((sum / o.key_results.length) * 100);
}

export default function Goals() {
  const { me } = useAuth();
  const isMgr = me?.role === "prof" || me?.role === "staff" || me?.role === "admin";
  const uid = useId();
  const nameOf = useDirectory();
  const [period, setPeriod] = useState(currentPeriod());
  const [list, setList] = useState<Objective[]>([]);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", note: "" });

  async function load() {
    try { setList((await api.get<Objective[]>(`/projects/objectives?period=${encodeURIComponent(period)}`)).data); }
    catch (e) { setErr(apiError(e)); }
  }
  useEffect(() => { load(); }, [period]);

  async function addObjective() {
    if (!form.title.trim()) return setErr("목표를 입력하세요");
    try {
      await api.post("/projects/objectives", { period, title: form.title, note: form.note });
      setForm({ title: "", note: "" }); setAdding(false); setErr(""); load();
    } catch (e) { setErr(apiError(e)); }
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

  const periods = Array.from(new Set([currentPeriod(), ...list.map((o) => o.period)])).sort().reverse();
  const byOwner: Record<string, Objective[]> = {};
  list.forEach((o) => { (byOwner[o.owner_id] ||= []).push(o); });

  return (
    <div>
      <PageHeader crumb="업무 › 목표" title="목표(OKR)" />
      {err && <div className="form-err" data-testid="goal-err">{err}</div>}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <label htmlFor={`${uid}-p`} className="muted small">학기</label>
        <select id={`${uid}-p`} data-testid="goal-period" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 150 }}>
          {periods.map((p) => <option key={p}>{p}</option>)}
        </select>
        {!isMgr && (
          <button className="btn primary sm" data-testid="goal-add-open" onClick={() => setAdding((v) => !v)} style={{ marginLeft: "auto" }}>
            {adding ? "닫기" : "+ 목표 추가"}
          </button>
        )}
      </div>

      {adding && (
        <Card title="새 목표">
          <label htmlFor={`${uid}-t`}>목표<Req/></label>
          <input id={`${uid}-t`} data-testid="goal-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="예: 1저자 논문 1편을 국제학회에 투고한다" />
          <label htmlFor={`${uid}-n`}>메모 (선택)</label>
          <input id={`${uid}-n`} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <button className="btn primary" data-testid="goal-add-submit" onClick={addObjective}>추가</button>
            <button className="btn ghost" onClick={() => setAdding(false)}>취소</button>
            <MentorButton feature="task" label="목표 점검" collect={() => ({
              title: form.title, body: form.note, context: { 학기: period },
            })} />
          </div>
        </Card>
      )}

      {!list.length && <Card title={period}><div className="muted">이 학기에 등록된 목표가 없습니다.</div></Card>}

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
                    <input id={`${uid}-kr-${o.id}`} data-testid="kr-new" placeholder="결과지표 (예: 학회 투고 1편)" style={{ flex: 1, minWidth: 180 }} />
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
