import { useEffect, useState } from "react";
import { onBusy } from "../api/client";

/**
 * 화면 맨 위 얇은 진행 막대.
 * 요청이 시작되면 나타나고 모두 끝나면 사라진다 — 빈 목록인지 아직 오는 중인지 구분해 준다.
 * 순간적인 요청까지 깜빡이면 오히려 산만하므로 200ms 이상 걸릴 때만 보여준다.
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
        // 응답이 끝내 오지 않는 요청이 하나라도 있으면 막대가 영원히 남는다.
        // 멈춘 표시는 없느니만 못하므로 최대 표시 시간을 둔다(실패는 각 화면의 오류 문구가 알린다).
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
