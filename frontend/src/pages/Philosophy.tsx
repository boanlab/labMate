// 지도 철학 — AI 가 지도교수와 대화하며 연구·교육·실무 철학을 끌어내고,
// 교수가 승인한 지침만 학생 멘토링의 기준이 된다.
//
// 학생은 승인된 지침을 읽기만 한다(무엇을 기준으로 지도받는지 알아야 하므로).
import { useEffect, useId, useRef, useState } from "react";

import { api, apiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { confirmDialog } from "../ui/dialog";
import { Card, PageHeader } from "../ui/kit";

interface Principle { id: string; category: string; text: string; rationale: string; approved: boolean; source: string; order: number }
type Turn = { role: string; content: string };

const CAT_LABEL: Record<string, string> = { research: "연구철학", teaching: "교육철학", practice: "실무철학" };
const CATS = ["research", "teaching", "practice"];

export default function Philosophy() {
  const { me } = useAuth();
  const isProf = me?.role === "prof" || me?.role === "admin";
  const uid = useId();
  const [cat, setCat] = useState("research");
  const [list, setList] = useState<Principle[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  async function loadList() {
    try { setList((await api.get<Principle[]>("/mentor/philosophy/principles")).data); }
    catch (e) { setErr(apiError(e)); }
  }
  async function loadTurns() {
    if (!isProf) return;
    try { setTurns((await api.get<{ history: Turn[] }>(`/mentor/philosophy/interview?category=${cat}`)).data.history || []); }
    catch { setTurns([]); }
  }
  useEffect(() => { loadList(); }, []);
  useEffect(() => { loadTurns(); setAnswer(""); }, [cat]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [turns]);

  async function step(text: string) {
    setBusy(true); setErr(""); setMsg("");
    try {
      const { data } = await api.post<{ question: string; history: Turn[] }>("/mentor/philosophy/interview", { category: cat, text });
      setTurns(data.history); setAnswer("");
    } catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  }

  async function extract() {
    setBusy(true); setErr(""); setMsg("");
    try {
      const { data } = await api.post<{ drafts: Principle[]; detail: string }>(`/mentor/philosophy/extract?category=${cat}`, {});
      if (data.detail) setErr(data.detail);
      else setMsg(`지침 초안 ${data.drafts.length}개를 아래에 담았습니다. 검토 후 '반영'을 눌러 주세요.`);
      loadList();
    } catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  }

  async function resetChat() {
    if (!await confirmDialog(`${CAT_LABEL[cat]} 대화를 모두 지우고 처음부터 다시 시작할까요?`, { danger: true })) return;
    try { await api.delete(`/mentor/philosophy/interview?category=${cat}`); setTurns([]); }
    catch (e) { setErr(apiError(e)); }
  }

  async function patch(p: Principle, body: Partial<Principle>) {
    try { await api.patch(`/mentor/philosophy/principles/${p.id}`, body); loadList(); }
    catch (e) { setErr(apiError(e)); }
  }
  async function remove(p: Principle) {
    if (!await confirmDialog(`"${p.text}" 지침을 삭제할까요?`, { danger: true })) return;
    try { await api.delete(`/mentor/philosophy/principles/${p.id}`); loadList(); }
    catch (e) { setErr(apiError(e)); }
  }
  async function addManual() {
    const text = (document.getElementById(`${uid}-new`) as HTMLInputElement)?.value?.trim();
    if (!text) return;
    try {
      await api.post("/mentor/philosophy/principles", { category: cat, text, approved: true });
      (document.getElementById(`${uid}-new`) as HTMLInputElement).value = "";
      loadList();
    } catch (e) { setErr(apiError(e)); }
  }

  const inCat = list.filter((p) => p.category === cat);
  const approved = inCat.filter((p) => p.approved);
  const drafts = inCat.filter((p) => !p.approved);

  return (
    <div>
      <PageHeader crumb="연구실 › 지도 철학" title="지도 철학" />
      {err && <div className="form-err" data-testid="ph-err">{err}</div>}
      {msg && <div className="io" data-testid="ph-msg">{msg}</div>}

      <div className="fchips" style={{ marginBottom: 12 }}>
        {CATS.map((c) => {
          const n = list.filter((p) => p.category === c && p.approved).length;
          const d = isProf ? list.filter((p) => p.category === c && !p.approved).length : 0;
          return (
            <button key={c} className={"chip" + (cat === c ? " on" : "")} data-testid={`ph-cat-${c}`} onClick={() => setCat(c)}>
              {CAT_LABEL[c]} {n}
              {d > 0 && <span className="badge s-wait" style={{ marginLeft: 4 }}>검토 {d}</span>}
            </button>
          );
        })}
      </div>

      {!isProf && (
        <Card title={`${CAT_LABEL[cat]} — 지도 기준`}>
          <p className="muted small" style={{ marginTop: 0 }}>
            AI 멘토가 여러분의 글을 볼 때 이 기준을 근거로 조언합니다.
          </p>
          {approved.length
            ? <ol className="ph-list">{approved.map((p) => (
                <li key={p.id}><b>{p.text}</b>{p.rationale && <div className="muted small">{p.rationale}</div>}</li>
              ))}</ol>
            : <div className="muted">아직 등록된 지침이 없습니다.</div>}
        </Card>
      )}

      {isProf && (
        <>
          <Card title={`${CAT_LABEL[cat]} 인터뷰`}>
            <p className="muted small" style={{ marginTop: 0 }}>
              생각을 말씀해 주시면 AI 가 이어서 여쭙고, 마지막에 <b>학생 지도에 쓸 지침</b>으로 정리합니다.
              정리된 지침은 교수님이 <b>반영</b>을 눌러야 학생에게 적용됩니다.
            </p>

            <div className="ph-chat" data-testid="ph-chat">
              {turns.length === 0 && <div className="muted small">아직 대화가 없습니다. 아래 버튼으로 시작하세요.</div>}
              {turns.map((t, i) => (
                <div key={i} className={"ph-turn " + (t.role === "user" ? "me" : "ai")}>
                  <div className="ph-who">{t.role === "user" ? "교수님" : "AI"}</div>
                  <div className="ph-text">{t.content}</div>
                </div>
              ))}
              <div ref={endRef} />
            </div>

            {turns.length === 0 ? (
              <button className="btn primary" data-testid="ph-start" disabled={busy} onClick={() => step("")}>
                {busy ? "준비 중…" : "인터뷰 시작"}
              </button>
            ) : (
              <>
                <label htmlFor={`${uid}-ans`} className="muted small">답변</label>
                <textarea id={`${uid}-ans`} data-testid="ph-answer" rows={3} value={answer} disabled={busy}
                  onChange={(e) => setAnswer(e.target.value)} style={{ width: "100%" }}
                  placeholder="생각나시는 대로 적어 주세요. 사례를 함께 들어 주시면 더 정확한 지침이 됩니다." />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button className="btn primary" data-testid="ph-send" disabled={busy || !answer.trim()} onClick={() => step(answer)}>
                    {busy ? "생각 중…" : "답변 보내기"}
                  </button>
                  <button className="btn ghost" data-testid="ph-extract" disabled={busy} onClick={extract}>지침으로 정리</button>
                  <button className="btn ghost" onClick={resetChat} style={{ marginLeft: "auto" }}>대화 지우기</button>
                </div>
              </>
            )}
          </Card>

          {!!drafts.length && (
            <Card title={`검토 대기 (${drafts.length})`}>
              <p className="muted small" style={{ marginTop: 0 }}>
                AI 가 대화에서 뽑은 초안입니다. 문구를 고치고 <b>반영</b>을 눌러야 학생 지도에 쓰입니다.
              </p>
              {drafts.map((p) => (
                <div key={p.id} className="ph-draft" data-testid="ph-draft">
                  <input defaultValue={p.text} data-testid="ph-draft-text" aria-label="지침 초안 문구"
                    onBlur={(e) => e.target.value !== p.text && patch(p, { text: e.target.value })} style={{ width: "100%" }} />
                  {p.rationale && <div className="muted small">근거: {p.rationale}</div>}
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    <button className="btn primary sm" data-testid="ph-approve" onClick={() => patch(p, { approved: true })}>반영</button>
                    <button className="btn ghost sm" onClick={() => remove(p)} style={{ color: "var(--bad-text)" }}>버리기</button>
                  </div>
                </div>
              ))}
            </Card>
          )}

          <Card title={`학생에게 적용 중인 지침 (${approved.length})`}>
            {approved.length
              ? <ol className="ph-list">{approved.map((p) => (
                  <li key={p.id}>
                    <b>{p.text}</b>
                    {p.rationale && <div className="muted small">{p.rationale}</div>}
                    <div style={{ display: "flex", gap: 6, marginTop: 3 }}>
                      <button className="btn ghost sm" onClick={() => patch(p, { approved: false })}>보류로</button>
                      <button className="btn ghost sm" onClick={() => remove(p)} style={{ color: "var(--bad-text)" }}>삭제</button>
                    </div>
                  </li>
                ))}</ol>
              : <div className="muted">아직 없습니다. 인터뷰로 만들거나 아래에서 직접 추가하세요.</div>}
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <input id={`${uid}-new`} data-testid="ph-new" aria-label={`${CAT_LABEL[cat]} 지침 직접 추가`} placeholder="지침을 직접 추가 (예: 결론을 먼저 쓰고 근거를 뒤에 붙인다)" style={{ flex: 1 }} />
              <button className="btn ghost" data-testid="ph-add" onClick={addManual}>추가</button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
