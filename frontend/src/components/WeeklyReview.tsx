// 주간 회고 — 주 30분 리뷰를 제품화한 것.
//
// 빈 화면을 주면 아무도 쓰지 않는다. 이번 주 기록에서 멘토가 초안을 만들어 주고,
// 학생은 고쳐 쓰기만 한다. 작성한 회고는 계정에 남아 다음 주에 이어 볼 수 있다.
import { useEffect, useState } from "react";

import { api, apiError } from "../api/client";
import { usePref } from "../api/prefs";
import { todayKST } from "../lib/date";
import { Card } from "../ui/kit";
import { useMentorEnabled } from "../ui/Mentor";

/** ISO 주차 — 같은 주를 두 번 쓰지 않도록 키로 삼는다. */
export function isoWeek(d = new Date()): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const w = Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, "0")}`;
}

export function WeeklyReview({ facts }: { facts: Record<string, unknown> }) {
  const on = useMentorEnabled("review");
  const week = isoWeek();
  const [saved, setSaved] = usePref<Record<string, string>>("weekly_review", {});
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => { setText(saved?.[week] || ""); }, [saved, week]);

  // 금요일 이후부터 권한다 — 주 중반에 회고하라고 하면 쓸 내용이 없다.
  const dow = new Date().getDay();
  const due = dow === 5 || dow === 6 || dow === 0;
  const done = !!saved?.[week];

  async function draft() {
    setBusy(true); setErr("");
    try {
      const { data } = await api.post<{ text: string }>("/mentor/weekly-review", { week, facts });
      setText(data.text || "");
    } catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  }
  function save() {
    setSaved({ ...(saved || {}), [week]: text });
    setOpen(false);
  }

  if (!on) return null;

  return (
    <Card title={`주간 회고 · ${week}`} testid="weekly-review"
      extra={done ? <span className="badge s-ok">작성함</span> : due ? <span className="badge s-wait">이번 주 미작성</span> : null}>
      {!open && (
        <>
          {done
            ? <div className="mentor-body" data-testid="wr-saved">{saved[week]}</div>
            : <div className="muted small">
                {due ? "이번 주를 정리할 때입니다. 지난 한 주 기록으로 초안을 만들어 드립니다." : "금요일에 이번 주를 정리해 보세요."}
              </div>}
          <button className="btn ghost sm" data-testid="wr-open" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>
            {done ? "고쳐 쓰기" : "회고 작성"}
          </button>
        </>
      )}
      {open && (
        <>
          {err && <div className="form-err" style={{ marginTop: 0 }}>{err}</div>}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
            <button className="btn ghost sm" data-testid="wr-draft" disabled={busy} onClick={draft}>
              {busy ? "이번 주 기록을 정리하는 중…" : "✨ 초안 만들기"}
            </button>
          </div>
          <textarea data-testid="wr-text" rows={10} value={text} onChange={(e) => setText(e.target.value)}
            style={{ width: "100%" }} placeholder={"1) 움직인 것\n2) 막힌 것\n3) 다음 주에 할 일 3가지"} />
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn primary sm" data-testid="wr-save" disabled={!text.trim()} onClick={save}>저장</button>
            <button className="btn ghost sm" onClick={() => { setOpen(false); setText(saved?.[week] || ""); }}>취소</button>
          </div>
        </>
      )}
    </Card>
  );
}

/** 대시보드 데이터에서 이번 주 사실을 뽑는다. */
export function collectWeekFacts(input: { tasks: any[]; actions: any[]; meetings: any[] }): Record<string, unknown> {
  const today = todayKST();
  // toISOString 은 UTC 로 바꿔 한국 시간 기준으로 하루 앞당겨진다 — 옆줄의 todayKST 와 기준이 어긋나므로
  // 지역 시간 그대로 조립한다(7일 전 = 오늘 포함 최근 8일이 아니라 정확히 7일 전).
  const wa = new Date(); wa.setDate(wa.getDate() - 7);
  const weekAgo = `${wa.getFullYear()}-${String(wa.getMonth() + 1).padStart(2, "0")}-${String(wa.getDate()).padStart(2, "0")}`;
  const done = input.tasks.filter((t) => t.status === "완료" && t.done_date && t.done_date >= weekAgo);
  const doing = input.tasks.filter((t) => t.status === "진행 중");
  const overdue = input.tasks.filter((t) => t.status !== "완료" && t.due && t.due < today);
  const nextDue = input.tasks
    .filter((t) => t.status !== "완료" && t.due && t.due >= today)
    .sort((a, b) => a.due.localeCompare(b.due)).slice(0, 5);
  return {
    "이번 주 완료한 업무": done.map((t) => `${t.title}(${t.done_date})`),
    "진행 중인 업무": doing.map((t) => `${t.title}${t.due ? ` / 마감 ${t.due}` : ""}`),
    "마감이 지난 업무": overdue.map((t) => `${t.title} / 마감 ${t.due}`),
    "다가오는 마감": nextDue.map((t) => `${t.title} / ${t.due}`),
    "회의에서 맡은 일": input.actions.map((a: any) => `${a.title}${a.due ? ` / 기한 ${a.due}` : ""}`),
    "이번 주 회의": input.meetings.filter((m: any) => m.date >= weekAgo).map((m: any) => m.title),
  };
}
