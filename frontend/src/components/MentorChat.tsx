// 상시 멘토 — 화면 우측 하단에 떠 있는 대화창.
//
// 지금 보고 있는 화면을 함께 보내 그 맥락에 맞춰 답한다. 대화는 서버에 남기지
// 않고 이 창이 열려 있는 동안만 들고 있는다.
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { api, apiError } from "../api/client";
import { useMentorEnabled } from "../ui/Mentor";

const SCREEN: Record<string, string> = {
  "/": "대시보드", "/calendar": "캘린더", "/grants": "연구과제", "/projects": "프로젝트",
  "/tasks": "세부업무", "/goals": "목표(OKR)", "/notes": "연구노트", "/approvals": "전자결재",
  "/booking": "자원예약", "/notices": "공지사항", "/board": "게시판", "/meetings": "회의록",
  "/budget": "예산", "/payroll": "학생인건비", "/expenses": "연구비집행", "/attendance": "출퇴근",
  "/leave": "휴가", "/members": "구성원", "/publications": "실적", "/library": "교육",
  "/archive": "아카이브", "/philosophy": "지도철학", "/mypage": "마이페이지",
};

type Msg = { role: "user" | "assistant"; content: string };

export function MentorChat() {
  const on = useMentorEnabled("chat");
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [msgs, busy]);

  if (!on) return null;
  const screen = SCREEN[loc.pathname] || "";

  async function send() {
    const text = q.trim();
    if (!text || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: text }];
    setMsgs(next); setQ(""); setBusy(true); setErr("");
    try {
      const { data } = await api.post<{ text: string }>("/mentor/chat", { screen, history: next });
      setMsgs([...next, { role: "assistant", content: data.text || "" }]);
    } catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  }

  return (
    <>
      {!open && (
        <button className="mentor-fab" data-testid="mentor-fab" aria-label="멘토에게 묻기" onClick={() => setOpen(true)}>
          ✨
        </button>
      )}
      {open && (
        <div className="mentor-panel" data-testid="mentor-chat" role="dialog" aria-label="멘토 대화">
          <div className="mentor-panel-h">
            <b>멘토</b>
            {screen && <span className="muted small">· {screen}</span>}
            <button className="btn ghost sm" aria-label="닫기" style={{ marginLeft: "auto" }} onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="mentor-panel-b">
            {!msgs.length && (
              <div className="muted small">
                업무를 어떻게 진행할지 물어보세요. 예: “이 과제를 2주 단위로 어떻게 쪼개면 좋을까요?”
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={"ph-turn " + (m.role === "user" ? "me" : "ai")}>
                <div className="ph-who">{m.role === "user" ? "나" : "멘토"}</div>
                <div className="ph-text">{m.content}</div>
              </div>
            ))}
            {busy && <div className="muted small">생각 중…</div>}
            {err && <div className="form-err" style={{ marginTop: 0 }}>{err}</div>}
            <div ref={endRef} />
          </div>
          <div className="mentor-panel-f">
            <input data-testid="mentor-chat-in" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="무엇을 도와드릴까요?" aria-label="멘토에게 보낼 질문" />
            <button className="btn primary sm" data-testid="mentor-chat-send" disabled={busy || !q.trim()} onClick={send}>보내기</button>
          </div>
        </div>
      )}
    </>
  );
}
