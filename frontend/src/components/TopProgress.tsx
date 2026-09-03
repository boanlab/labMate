import { useEffect, useState } from "react";
import { onBusy } from "../api/client";

/**
 * 상단 진행 막대 — 빈 목록과 로딩 중을 구분한다.
 * 200ms 이상 걸리는 요청만 표시(순간 요청의 깜빡임 방지).
 */
export function TopProgress() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let showTimer: number | undefined;
    let maxTimer: number | undefined;
    const off = onBusy((busy) => {
      window.clearTimeout(showTimer);
      window.clearTimeout(maxTimer);
      if (busy) {
        showTimer = window.setTimeout(() => setShow(true), 200);
        // 응답이 오지 않는 요청 대비 최대 표시 시간(실패는 각 화면의 오류 문구가 알린다).
        maxTimer = window.setTimeout(() => setShow(false), 15000);
      } else {
        setShow(false);
      }
    });
    return () => { window.clearTimeout(showTimer); window.clearTimeout(maxTimer); off(); };
  }, []);
  if (!show) return null;
  return <div className="topbar-progress" role="status" aria-label="불러오는 중" data-testid="top-progress" />;
}
