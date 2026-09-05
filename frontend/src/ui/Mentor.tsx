// 작성 화면용 AI 멘토 — 지금 쓰고 있는 내용을 점검받는다.
//
// 관리자가 켠 기능에서만 버튼이 보인다. 상태는 세션당 1회만 조회한다(화면마다
// 물으면 폼을 열 때마다 요청이 나간다).
import { useEffect, useState } from "react";

import { api, apiError, silent } from "../api/client";

export type MentorFeature = "meeting" | "note" | "task" | "report" | "post" | "schedule" | "review" | "nudge" | "philosophy" | "chat";

interface Status { enabled: boolean; features: Record<string, boolean>; labels: Record<string, string> }

/** 개선안에서 사람이 채워야 하는 자리([미정: 담당자] 등)를 눈에 띄게 보여 준다.
 *  그대로 붙여 넣고 지나치면 담당자·마감일이 빈 채로 남는다. */
// 모델은 굵게(**…**) 같은 마크다운을 섞어 쓴다. 그대로 두면 별표가 글자로 보인다.
// 문서를 통째로 렌더하는 것이 아니라, 눈에 걸리는 최소한(굵게·미정 표기)만 살린다.
const INLINE = /(\*\*[^*\n]+\*\*|\[미정:[^\]]*\]|\(미정\))/g;   // split 이 구분자도 남기도록 캡처 그룹으로
const IS_TODO = /^[[(]미정/;                        // 판정용은 따로 — /g 는 lastIndex 가 남아 오판한다
function Marked({ text }: { text: string }) {
  return <>{text.split(INLINE).map((part, i) => {
    if (IS_TODO.test(part)) return <span key={i} className="mentor-todo">{part}</span>;
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) return <b key={i}>{part.slice(2, -2)}</b>;
    return <span key={i}>{part}</span>;
  })}</>;
}

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
export function MentorButton({ feature, collect, label = "멘토 점검", testid, onApply }: {
  feature: MentorFeature;
  collect: () => { title?: string; body?: string; context?: Record<string, unknown> };
  label?: string;
  testid?: string;
  /** 주면 개선안을 본문에 바로 넣을 수 있다. 없으면 보여 주고 복사만 한다. */
  onApply?: (text: string) => void;
}) {
  const on = useMentorEnabled(feature);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [revised, setRevised] = useState("");
  const [revising, setRevising] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!on) return null;

  /** 지적을 반영해 고쳐 쓴 초안을 받는다. 바꿔 넣을지는 쓴 사람이 정한다. */
  async function revise() {
    setRevising(true); setErr("");
    const { title = "", body = "", context = {} } = collect();
    try {
      const { data } = await api.post<{ text: string }>("/mentor/revise", { feature, title, body, review: text, context });
      setRevised(data.text || "");
      if (!data.text) setErr("개선안을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } catch (e) { setErr(apiError(e)); } finally { setRevising(false); }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(revised); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { setErr("복사하지 못했습니다. 직접 선택해 복사해 주세요."); }
  }

  async function run() {
    setBusy(true); setErr(""); setText(""); setRevised("");
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
          {err ? <div className="form-err" style={{ marginTop: 0 }}>{err}</div> : <div className="mentor-body"><Marked text={text} /></div>}
          {text && !revised && (
            <div className="mentor-acts">
              <button type="button" className="btn ghost sm" data-testid={`mentor-revise-${feature}`} disabled={revising} onClick={revise}>
                {revising ? "고쳐 쓰는 중…" : "✨ 개선안 만들기"}
              </button>
            </div>
          )}
          {revised && (
            <div className="mentor-rev">
              <b className="small">개선안</b>
              <div className="mentor-body"><Marked text={revised} /></div>
              <div className="mentor-acts">
                {onApply && <button type="button" className="btn primary sm" data-testid={`mentor-apply-${feature}`} onClick={() => onApply(revised)}>본문에 반영</button>}
                <button type="button" className="btn ghost sm" onClick={copy}>{copied ? "복사됨 ✓" : "복사"}</button>
                <button type="button" className="btn ghost sm" onClick={() => setRevised("")}>개선안 닫기</button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
