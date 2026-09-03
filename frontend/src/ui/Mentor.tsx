// 작성 화면용 AI 멘토 — 지금 쓰고 있는 내용을 점검받는다.
//
// 관리자가 켠 기능에서만 버튼이 보인다. 상태는 세션당 1회만 조회한다(화면마다
// 물으면 폼을 열 때마다 요청이 나간다).
import { useEffect, useState } from "react";

import { api, apiError, silent } from "../api/client";

export type MentorFeature = "meeting" | "note" | "task" | "report" | "schedule" | "review" | "chat";

interface Status { enabled: boolean; features: Record<string, boolean>; labels: Record<string, string> }

let cache: Status | null = null;
let pending: Promise<Status> | null = null;
const subs = new Set<() => void>();

function loadStatus(): Promise<Status> {
  if (cache) return Promise.resolve(cache);
  if (!pending) {
    pending = api.get<Status>("/mentor/status", silent)
      .then((r) => { cache = r.data; return cache; })
      .catch(() => { cache = { enabled: false, features: {}, labels: {} }; return cache; })
      .finally(() => { pending = null; subs.forEach((f) => f()); });
  }
  return pending;
}

/** 로그아웃 시 앞사람 설정이 남지 않도록 비운다. */
export function clearMentorStatus() { cache = null; pending = null; }

/** 이 기능이 켜져 있는지 — 꺼져 있으면 버튼 자체를 렌더하지 않는다. */
export function useMentorEnabled(feature: MentorFeature): boolean {
  const [, bump] = useState(0);
  useEffect(() => {
    loadStatus();
    const fn = () => bump((n) => n + 1);
    subs.add(fn);
    return () => { subs.delete(fn); };
  }, []);
  return !!cache?.enabled && !!cache?.features?.[feature];
}

/**
 * 점검 버튼 + 결과 패널.
 *
 * @param feature 점검 유형(관리자가 기능별로 켠다)
 * @param collect 누른 시점의 제목·본문·부가정보를 모아 주는 함수
 */
export function MentorButton({ feature, collect, label = "멘토 점검", testid }: {
  feature: MentorFeature;
  collect: () => { title?: string; body?: string; context?: Record<string, unknown> };
  label?: string;
  testid?: string;
}) {
  const on = useMentorEnabled(feature);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");

  if (!on) return null;

  async function run() {
    setBusy(true); setErr(""); setText("");
    const { title = "", body = "", context = {} } = collect();
    try {
      const { data } = await api.post<{ text: string }>("/mentor/review", { feature, title, body, context });
      setText(data.text || "특별히 고칠 점이 보이지 않습니다.");
    } catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <button type="button" className="btn ghost sm" data-testid={testid || `mentor-${feature}`} disabled={busy} onClick={run}>
        {busy ? "점검 중…" : `✨ ${label}`}
      </button>
      {(text || err) && (
        <div className="mentor-out" data-testid={`mentor-out-${feature}`}>
          <div className="mentor-head">
            <b>AI 멘토</b>
            <button type="button" className="btn ghost sm" aria-label="점검 결과 닫기" onClick={() => { setText(""); setErr(""); }}>✕</button>
          </div>
          {err ? <div className="form-err" style={{ marginTop: 0 }}>{err}</div> : <div className="mentor-body">{text}</div>}
          {text && <div className="muted small" style={{ marginTop: 6 }}>제안일 뿐입니다 — 내용의 옳고 그름은 직접 판단하세요.</div>}
        </div>
      )}
    </>
  );
}
