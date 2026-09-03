// AI 멘토 설정(관리자) — OpenRouter 키·모델·허용 범위·사용량.
// 키는 서버에만 있고 화면에는 마스킹만 온다. 입력한 값은 저장 후 지운다.
import { useEffect, useId, useState } from "react";

import { api, apiError } from "../api/client";
import { saveConfig, clearConfigCache } from "../api/config";
import { confirmDialog } from "../ui/dialog";
import { Card } from "../ui/kit";

interface KeyStatus { configured: boolean; hint: string; updated_at: string; updated_by: string }
interface Cfg {
  ai_enabled: boolean; ai_model: string; ai_features: Record<string, boolean>;
  ai_roles: string[]; ai_monthly_cost_cap_usd: number; ai_max_output_tokens: number;
}
interface UsageInfo { month: string; calls: number; cost_usd: number; cap_usd: number; by_feature: Record<string, number> }

const ROLE_LABEL: Record<string, string> = {
  prof: "지도교수", phd: "박사과정", master: "석사과정", under: "학부연구생", staff: "행정", admin: "관리자",
};

export function AiSettingsPanel() {
  const uid = useId();
  const [key, setKey] = useState("");
  const [st, setSt] = useState<KeyStatus | null>(null);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [k, c, s, u] = await Promise.all([
        api.get<KeyStatus>("/mentor/key"),
        api.get<Cfg>("/mentor/config"),
        api.get<{ labels: Record<string, string> }>("/mentor/status"),
        api.get<UsageInfo>("/mentor/usage"),
      ]);
      setSt(k.data); setCfg(c.data); setLabels(s.data.labels); setUsage(u.data);
    } catch (e) { setErr(apiError(e)); }
  }
  useEffect(() => { load(); }, []);

  async function put(k: keyof Cfg, v: any) {
    if (!cfg) return;
    setCfg({ ...cfg, [k]: v });
    try { await saveConfig("mentor", k, v); clearConfigCache(); setMsg("저장됨 ✓"); }
    catch (e) { setErr(apiError(e)); load(); }
  }

  async function saveKey() {
    setBusy(true); setErr(""); setMsg("");
    try {
      await api.put("/mentor/key", { key: key.trim() });
      setKey(""); setMsg("키가 저장되었습니다. 연결 테스트로 확인해 보세요.");
      load();
    } catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  }

  async function testKey() {
    setBusy(true); setErr(""); setMsg("연결 확인 중…");
    try {
      const { data } = await api.post<{ ok: boolean; label: string; usage_usd: number | null; limit_usd: number | null; detail: string }>("/mentor/key/test", {});
      if (data.ok) {
        const bal = data.limit_usd != null ? ` · 한도 $${data.limit_usd} 중 $${data.usage_usd ?? 0} 사용` : "";
        setMsg(`연결 정상${data.label ? ` (${data.label})` : ""}${bal}`);
      } else { setMsg(""); setErr(data.detail); }
    } catch (e) { setMsg(""); setErr(apiError(e)); } finally { setBusy(false); }
  }

  async function removeKey() {
    if (!await confirmDialog("저장된 OpenRouter 키를 삭제하면 AI 멘토 기능이 모두 중단됩니다. 계속할까요?", { title: "키 삭제", danger: true })) return;
    setBusy(true);
    try { await api.delete("/mentor/key"); setMsg("키가 삭제되었습니다."); load(); }
    catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  }

  async function loadModels() {
    setBusy(true); setErr("");
    try { setModels((await api.get<{ id: string; name: string }[]>("/mentor/models")).data); }
    catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  }

  if (!cfg) return <Card title="AI 멘토"><div className="muted">불러오는 중…</div></Card>;
  const capReached = usage && usage.cap_usd > 0 && usage.cost_usd >= usage.cap_usd;

  return (
    <>
      {err && <div className="form-err" data-testid="ai-err">{err}</div>}
      {msg && <div className="io" data-testid="ai-msg">{msg}</div>}

      <Card title="OpenRouter 연결">
        <p className="muted small" style={{ marginTop: 0 }}>
          AI 멘토는 <a className="lnk" href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">OpenRouter</a> 를 통해 동작합니다.
          키는 암호화해 서버에만 보관하며 화면·백업 어디에도 원문이 나오지 않습니다.
        </p>
        <table className="cfg-kv"><tbody>
          <tr>
            <th>저장된 키</th>
            <td>
              {st?.configured
                ? <><code data-testid="ai-key-hint">{st.hint}</code> <span className="muted small">· {st.updated_at ? st.updated_at.slice(0, 10) : ""} 설정</span></>
                : <span className="muted">설정되지 않음 — AI 기능이 동작하지 않습니다</span>}
            </td>
          </tr>
          <tr>
            <th><label htmlFor={`${uid}-key`}>새 키 입력</label></th>
            <td>
              <input id={`${uid}-key`} type="password" autoComplete="off" data-testid="ai-key-input"
                placeholder="sk-or-v1-…" value={key} onChange={(e) => setKey(e.target.value)} style={{ width: "100%", maxWidth: 420 }} />
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                <button className="btn primary sm" data-testid="ai-key-save" disabled={busy || key.trim().length < 20} onClick={saveKey}>저장</button>
                <button className="btn ghost sm" data-testid="ai-key-test" disabled={busy || !st?.configured} onClick={testKey}>연결 테스트</button>
                {st?.configured && <button className="btn ghost sm" data-testid="ai-key-del" disabled={busy} onClick={removeKey} style={{ color: "var(--bad-text)" }}>삭제</button>}
              </div>
            </td>
          </tr>
        </tbody></table>
      </Card>

      <Card title="사용 범위">
        <table className="cfg-kv"><tbody>
          <tr>
            <th>AI 멘토 전체</th>
            <td>
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" data-testid="ai-enabled" checked={cfg.ai_enabled} onChange={(e) => put("ai_enabled", e.target.checked)} />
                <span>{cfg.ai_enabled ? "켜짐" : "꺼짐"}</span>
              </label>
              <div className="muted small">끄면 아래 설정과 무관하게 모든 AI 기능이 동작하지 않습니다.</div>
            </td>
          </tr>
          <tr>
            <th><label htmlFor={`${uid}-model`}>모델</label></th>
            <td>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {models.length
                  ? <select id={`${uid}-model`} data-testid="ai-model-select" value={cfg.ai_model} onChange={(e) => put("ai_model", e.target.value)} style={{ maxWidth: 360 }}>
                      {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  : <input id={`${uid}-model`} data-testid="ai-model" value={cfg.ai_model} onChange={(e) => setCfg({ ...cfg, ai_model: e.target.value })}
                      onBlur={(e) => put("ai_model", e.target.value)} style={{ width: 320 }} />}
                <button className="btn ghost sm" data-testid="ai-models-load" disabled={busy || !st?.configured} onClick={loadModels}>목록 불러오기</button>
              </div>
            </td>
          </tr>
          <tr>
            <th>사용 가능 역할</th>
            <td style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {["prof", "phd", "master", "under", "staff"].map((r) => (
                <label key={r} style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                  <input type="checkbox" data-testid={`ai-role-${r}`} checked={cfg.ai_roles.includes(r)}
                    onChange={(e) => put("ai_roles", e.target.checked ? [...cfg.ai_roles, r] : cfg.ai_roles.filter((x) => x !== r))} />
                  {ROLE_LABEL[r]}
                </label>
              ))}
            </td>
          </tr>
          <tr>
            <th><label htmlFor={`${uid}-cap`}>월 비용 상한</label></th>
            <td>
              $ <input id={`${uid}-cap`} type="number" min={0} step={1} data-testid="ai-cap" value={cfg.ai_monthly_cost_cap_usd}
                onChange={(e) => setCfg({ ...cfg, ai_monthly_cost_cap_usd: Number(e.target.value) })}
                onBlur={(e) => put("ai_monthly_cost_cap_usd", Number(e.target.value))} style={{ width: 90 }} />
              <span className="muted small"> · 0 이면 무제한. 넘으면 다음 달까지 요청이 막힙니다.</span>
            </td>
          </tr>
        </tbody></table>
      </Card>

      <Card title="기능별 사용">
        <p className="muted small" style={{ marginTop: 0 }}>
          켠 기능만 학생 화면에 멘토 버튼이 나타납니다. 점검 시 <b>해당 화면에 작성한 제목·본문</b>이 OpenRouter 로 전송됩니다(첨부파일은 보내지 않습니다).
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          {Object.entries(labels).map(([k, label]) => (
            <label key={k} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" data-testid={`ai-feat-${k}`} checked={!!cfg.ai_features?.[k]}
                onChange={(e) => put("ai_features", { ...cfg.ai_features, [k]: e.target.checked })} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </Card>

      <Card title="이번 달 사용량">
        {usage ? (
          <table className="cfg-kv"><tbody>
            <tr><th>{usage.month}</th><td data-testid="ai-usage">
              호출 {usage.calls}건 · ${usage.cost_usd.toFixed(4)}
              {usage.cap_usd > 0 && <> / ${usage.cap_usd} {capReached && <span className="badge s-bad">한도 도달</span>}</>}
            </td></tr>
            {!!Object.keys(usage.by_feature).length && (
              <tr><th>기능별</th><td className="small">{Object.entries(usage.by_feature).map(([k, n]) => `${labels[k] || k} ${n}건`).join(" · ")}</td></tr>
            )}
          </tbody></table>
        ) : <div className="muted">—</div>}
      </Card>
    </>
  );
}
