// 목록 뷰포트 맞춤 페이지네이션 — 자산 테이블(DataTable autoHeight)과 동일 로직.
// 브라우저 세로 높이에 맞춰 한 페이지 행 수를 자동 계산하고, 넘치면 페이지 처리(페이지 스크롤 최소화).
import { RefObject, useEffect, useState } from "react";

// wrapRef: 테이블 래퍼(thead/tbody 포함) div. dep: 목록 길이 등 재계산 트리거.
export function useAutoPageSize(wrapRef: RefObject<HTMLElement>, dep: number): number {
  const [size, setSize] = useState(12);
  useEffect(() => {
    const calc = () => {
      const el = wrapRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;                    // 래퍼 상단(필터/검색 아래)
      const rowEl = el.querySelector("tbody tr") as HTMLElement | null;
      const headEl = el.querySelector("thead") as HTMLElement | null;
      const rowH = Math.max(24, rowEl ? rowEl.getBoundingClientRect().height : 42);
      const headH = headEl ? headEl.getBoundingClientRect().height : 40;
      const avail = window.innerHeight - top - headH - 60;           // 페이저+하단 여백
      const n = Math.max(6, Math.floor(avail / rowH));
      setSize((prev) => (prev === n ? prev : n));
    };
    const raf = requestAnimationFrame(calc);       // 최초 레이아웃 확정 후 측정
    window.addEventListener("resize", calc);
    const ro = new ResizeObserver(calc);           // 폼 열림/닫힘 등 상단 변화 감지(기준 window 고정이라 루프 없음)
    ro.observe(document.body);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", calc); ro.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep]);
  return size;
}

export function Pager({ page, pages, set }: { page: number; pages: number; set: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="pager">
      <button className="btn ghost sm" disabled={page === 0} onClick={() => set(page - 1)}>이전</button>
      <span>{page + 1} / {pages}</span>
      <button className="btn ghost sm" disabled={page >= pages - 1} onClick={() => set(page + 1)}>다음</button>
    </div>
  );
}
