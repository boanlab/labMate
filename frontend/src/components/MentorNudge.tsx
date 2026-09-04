// 대시보드 상단 멘토 카드 — 밀린 일을 먼저 짚고 다음 행동을 알려 준다.
//
// 무엇이 밀렸는지는 여기서 판단하고(데이터를 이미 대시보드가 갖고 있다), 문구만
// 멘토에게 맡긴다. 지도교수가 직접 지적하면 학생이 위축되므로 이 역할을 멘토가 맡는다.
import { useEffect, useState } from "react";

import { api, apiError, silent } from "../api/client";
import { readHint, writeHint } from "../api/prefs";
import { todayKST } from "../lib/date";
import { Card } from "../ui/kit";
import { useMentorEnabled } from "../ui/Mentor";

export interface Signal { kind: string; label: string; detail?: string }

/** 며칠 이상 지나야 '밀렸다'고 볼지 — 하루 늦었다고 바로 채근하지 않는다. */
const STALE_DAYS = 3;

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000);
}

/** 대시보드가 이미 불러 둔 데이터에서 밀린 항목을 뽑는다. */
export function collectSignals(input: {
  tasks: any[];            // 내 세부업무
  actions: any[];          // 회의록 액션아이템(내 담당, 미완)
  unackNotices: number;    // 미확인 필독 공지
  pendingAppr: number;     // 내 결재 대기
  lastReportAt?: string;   // 마지막 주간보고 상신일(yyyy-mm-dd)
  lastNoteAt?: string;     // 마지막 연구노트 작성일
}): Signal[] {
  const today = todayKST();
  const out: Signal[] = [];

  const overdue = input.tasks.filter((t) => t.status !== "완료" && t.due && t.due < today);
  if (overdue.length) {
    const worst = overdue.reduce((a, b) => (a.due < b.due ? a : b));
    out.push({
      kind: "마감 지남",
      label: `마감이 지난 업무 ${overdue.length}건`,
      detail: `가장 오래된 것: "${worst.title}" (${daysBetween(worst.due, today)}일 경과)`,
    });
  }

  const soon = input.tasks.filter((t) => t.status !== "완료" && t.due && t.due >= today && daysBetween(today, t.due) <= 2);
  if (soon.length) out.push({ kind: "마감 임박", label: `2일 안에 마감인 업무 ${soon.length}건`, detail: soon.map((t) => t.title).slice(0, 2).join(", ") });

  const stuck = input.tasks.filter((t) => t.status === "진행 중" && t.start && daysBetween(t.start, today) >= 14);
  if (stuck.length) out.push({ kind: "장기 정체", label: `2주 넘게 진행 중인 업무 ${stuck.length}건`, detail: stuck.map((t) => t.title).slice(0, 2).join(", ") });

  const oldActions = input.actions.filter((a) => a.due && a.due < today);
  if (oldActions.length) out.push({ kind: "회의 약속", label: `기한이 지난 회의록 액션아이템 ${oldActions.length}건`, detail: oldActions.map((a) => a.title).slice(0, 2).join(", ") });

  if (input.lastReportAt !== undefined) {
    const gap = input.lastReportAt ? daysBetween(input.lastReportAt, today) : 999;
    if (gap >= 7) {
      out.push({
        kind: "주간보고",
        label: input.lastReportAt ? `주간보고를 올린 지 ${gap}일 지남` : "주간보고 기록이 없음",
        detail: "전자결재 › 기안 작성 › 주간보고",
      });
    }
  }

  if (input.lastNoteAt !== undefined) {
    const gap = input.lastNoteAt ? daysBetween(input.lastNoteAt, today) : 999;
    if (gap >= 14) out.push({ kind: "연구노트", label: input.lastNoteAt ? `연구노트를 쓴 지 ${gap}일 지남` : "연구노트 기록이 없음" });
  }

  if (input.unackNotices > 0) out.push({ kind: "필독 공지", label: `확인하지 않은 필독 공지 ${input.unackNotices}건` });
  if (input.pendingAppr > 0) out.push({ kind: "결재", label: `내 차례인 결재 ${input.pendingAppr}건` });

  return out;
}

export function MentorNudge({ signals }: { signals: Signal[] }) {
  const on = useMentorEnabled("nudge");
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // 같은 항목이 며칠째 밀렸는지 세어 어조를 올린다(1회차부터 강하게 말하지 않는다).
  const fingerprint = signals.map((s) => s.kind).sort().join("|");

  useEffect(() => {
    if (!on || !signals.length) { setText(""); return; }
    const today = todayKST();
    const seen = readHint<{ day: string; fp: string; level: number; text: string }>("nudge", { day: "", fp: "", level: 0, text: "" });
    if (seen.day === today && seen.fp === fingerprint) { setText(seen.text); return; }   // 하루 1회만 부른다
    const level = seen.fp === fingerprint ? Math.min((seen.level || 1) + 1, 3) : 1;

    let alive = true;
    setBusy(true); setErr("");
    api.post<{ text: string }>("/mentor/nudge", { signals, level }, silent)
      .then((r) => {
        if (!alive) return;
        setText(r.data.text || "");
        writeHint("nudge", { day: today, fp: fingerprint, level, text: r.data.text || "" });
      })
      .catch((e) => alive && setErr(apiError(e)))
      .finally(() => alive && setBusy(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, fingerprint]);

  if (!on || !signals.length) return null;

  return (
    <Card title="멘토" testid="mentor-nudge">
      {busy && <div className="muted small">밀린 일을 살펴보는 중…</div>}
      {err && <div className="muted small">지금은 조언을 불러오지 못했습니다. 아래 목록만 확인해 주세요.</div>}
      {text && <div className="mentor-body" data-testid="nudge-text">{text}</div>}
      <ul className="nudge-list">
        {signals.map((s, i) => (
          <li key={i}><span className="badge s-wait">{s.kind}</span> {s.label}{s.detail && <span className="muted small"> · {s.detail}</span>}</li>
        ))}
      </ul>
    </Card>
  );
}
