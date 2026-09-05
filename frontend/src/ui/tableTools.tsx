import React, { useEffect, useRef, useState } from "react";
import { loadPrefs, onPrefsReady, peekPref, setPref } from "../api/prefs";

/* 표 공용 도구 — 컬럼 너비 조절과 머리글 클릭 정렬.
 *
 * 화면마다 담는 정보가 달라 어떤 컬럼이 넓어야 하는지도 사람마다 다르다.
 * 폭을 직접 끌어 맞추고 그 값이 다음에도 유지되게 한다. 정렬도 머리글을 눌러
 * 바꿀 수 있어야, 목록을 볼 때마다 검색어를 새로 떠올리지 않아도 된다. */

const MIN_W = 56;                 // 이보다 좁으면 내용이 읽히지 않는다
const GRIP = 7;                   // 머리글 오른쪽 경계에서 이 거리 안을 잡으면 폭 조절
const KEY = (k: string) => `colw.${k}`;
const DESKTOP = "(min-width: 861px)";   // 좁은 화면에서는 컬럼이 접히므로 폭 조절을 끈다

// 폭은 계정에 저장한다 — 브라우저에만 두면 PC 를 바꿀 때마다 다시 맞춰야 한다.
function load(key: string): Record<number, number> {
  return (peekPref<Record<number, number>>(KEY(key))) || {};
}
function save(key: string, v: Record<number, number>) {
  setPref(KEY(key), v);
}

/** 컬럼 머리글 — thead 가 여러 줄이면 첫 줄만이 컬럼 격자다.
 *  둘째 줄까지 한 줄로 세면 인덱스가 밀려 엉뚱한 컬럼에 폭이 들어간다. */
function headCells(t: HTMLTableElement): HTMLTableCellElement[] {
  const row = t.tHead?.rows[0];
  return row ? (Array.from(row.cells) as HTMLTableCellElement[]) : [];
}
/** 머리글이 병합된 표는 경계와 컬럼이 1:1 이 아니라 폭 조절을 걸지 않는다. */
function resizable(ths: HTMLTableCellElement[]): boolean {
  return ths.length > 1 && !ths.some((th) => th.colSpan > 1);
}
function colCells(t: HTMLTableElement): HTMLTableColElement[] {
  return Array.from(t.querySelectorAll<HTMLTableColElement>("colgroup col"));
}
/** 저장한 값은 '그때의 픽셀'이 아니라 컬럼 사이의 비율로 쓴다.
 *  창을 넓히거나 좁혀도 표는 늘 카드를 100% 채우고, 사람이 맞춘 비율만 지켜진다.
 *  한 칸이라도 값이 없으면 비율을 만들 수 없으니 화면 기본값(내용에 맞춘 폭)에 맡긴다. */
function ratios(widths: Record<number, number>, n: number): number[] | null {
  const w: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = widths[i];
    if (!v || v <= 0) return null;
    w.push(v);
  }
  const total = w.reduce((a, b) => a + b, 0);
  return total > 0 ? w.map((v) => v / total) : null;
}
/** 비율을 폭(%)으로 입힌다. 픽셀로 못박지 않아야 창 크기에 따라 브라우저가 알아서 다시 나눈다. */
function applyRatios(t: HTMLTableElement, widths: Record<number, number>): void {
  const ths = headCells(t);
  const rs = ratios(widths, ths.length);
  if (!rs) return;
  const cols = colCells(t);
  rs.forEach((r, i) => {
    const pct = `${(r * 100).toFixed(4)}%`;
    if (ths[i]) ths[i].style.width = pct;
    if (cols[i]) cols[i].style.width = pct;
  });
  t.style.tableLayout = "fixed";
  t.style.width = "100%";
}

/**
 * 표에 컬럼 너비 조절을 붙인다. `<table ref={ref} className="tbl …">` 처럼 쓴다.
 *
 * 머리글 오른쪽 경계를 끌어 폭을 바꾸고, 두 번 누르면 그 컬럼만 기본값으로 되돌린다.
 * 저장된 폭은 브라우저에 남아 다음 방문에도 그대로다.
 */
export function useColumnResize(storageKey: string) {
  const ref = useRef<HTMLTableElement | null>(null);
  const widths = useRef<Record<number, number>>(load(storageKey));
  const [, setNonce] = useState(0);      // 초기화 후 기본 폭을 되살리기 위한 리렌더 트리거
  // 화면이 원래 지정한 폭. 초기화할 때 이 값으로 되돌린다.
  // (React 는 style 값이 그대로면 다시 쓰지 않으므로, 우리가 지운 값은 우리가 되살려야 한다)
  const original = useRef<string[] | null>(null);

  // 설정은 세션당 한 번 받는다. 늦게 도착하면 그때 폭을 다시 입힌다.
  useEffect(() => {
    loadPrefs();
    return onPrefsReady(() => {
      const v = load(storageKey);
      if (Object.keys(v).length) { widths.current = v; setNonce((n) => n + 1); }
    });
  }, [storageKey]);

  // React 가 다시 그리면 인라인 style 이 되돌아가므로 매 렌더 후 다시 입힌다.
  useEffect(() => {
    const t = ref.current;
    if (!t || !window.matchMedia(DESKTOP).matches) return;
    const ths = headCells(t);
    if (!resizable(ths)) return;
    t.classList.add("resizable");
    // 경계를 끌 수 있다는 것을 알려 준다(정렬 안내가 이미 있으면 덧붙인다)
    ths.forEach((th, i) => {
      if (i === ths.length - 1) return;
      const base = th.getAttribute("title") || "";
      if (!base.includes("경계")) th.setAttribute("title", (base ? base + " · " : "") + "오른쪽 경계를 끌면 폭 조절, 두 번 누르면 기본값");
    });
    // 폭은 비율(%)로 입힌다. 픽셀로 못박으면 창을 넓혔을 때 표만 홀쭉하게 남아 왼쪽으로 몰린다.
    // %로 두면 창 크기가 달라져도 표가 늘 100%를 채우고 컬럼도 브라우저가 알아서 다시 나눈다.
    applyRatios(t, widths.current);
  });

  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    const head = t.querySelector("thead");
    if (!head) return;

    let idx = -1, startX = 0, startW = 0;
    const thAt = (e: PointerEvent) => {
      const th = (e.target as HTMLElement)?.closest?.("th") as HTMLTableCellElement | null;
      // 머리글 둘째 줄은 컬럼 경계가 아니다 — 여기서 끌면 엉뚱한 컬럼이 움직인다.
      if (!th || !headCells(t).includes(th)) return null;
      const r = th.getBoundingClientRect();
      return e.clientX >= r.right - GRIP ? th : null;   // 오른쪽 경계 근처만 잡는다
    };
    let pairW = 0;                      // 끄는 칸 + 오른쪽 칸의 폭 합(끄는 동안 고정)

    function onMove(e: PointerEvent) {
      if (idx < 0 || !t) return;
      e.preventDefault();
      // 끈 만큼 오른쪽 칸에서 덜어 온다 — 두 칸의 합이 그대로라 표는 계속 100%를 채운다.
      const w = Math.max(MIN_W, Math.min(pairW - MIN_W, Math.round(startW + (e.clientX - startX))));
      widths.current[idx] = w;
      widths.current[idx + 1] = pairW - w;
      applyRatios(t, widths.current);
    }
    function onUp() {
      if (idx < 0) return;
      idx = -1;
      document.body.classList.remove("col-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      save(storageKey, widths.current);
    }
    function onDown(e: PointerEvent) {
      if (!window.matchMedia(DESKTOP).matches) return;
      const th = thAt(e);
      if (!th) return;
      e.preventDefault(); e.stopPropagation();          // 정렬 클릭과 겹치지 않게
      const allTh = headCells(t!);
      if (!resizable(allTh)) return;
      const n0 = allTh.indexOf(th);
      if (n0 < 0 || n0 >= allTh.length - 1) return;    // 마지막 칸은 덜어 올 오른쪽 칸이 없다
      idx = n0;
      // 끌기 시작할 때 모든 컬럼의 지금 폭을 비율의 출발점으로 삼는다.
      if (!original.current) original.current = allTh.map((el) => el.style.width);
      allTh.forEach((el, n) => { widths.current[n] = widths.current[n] || Math.round(el.getBoundingClientRect().width); });
      startX = e.clientX; startW = widths.current[idx];
      pairW = startW + widths.current[idx + 1];
      document.body.classList.add("col-resizing");
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }
    /** 경계를 두 번 누르면 이 표의 컬럼 폭을 모두 기본값으로 되돌린다.
     *  첫 조절 때 전 컬럼을 고정하기 때문에, 한 칸만 풀면 표가 그대로여서 되돌린 느낌이 나지 않는다. */
    function onDbl(e: MouseEvent) {
      const th = (e.target as HTMLElement)?.closest?.("th") as HTMLTableCellElement | null;
      if (!th) return;
      const r = th.getBoundingClientRect();
      if (e.clientX < r.right - GRIP || !headCells(t!).includes(th)) return;
      widths.current = {};
      save(storageKey, widths.current);
      headCells(t!).forEach((el, n) => { el.style.width = original.current?.[n] ?? ""; });
      colCells(t!).forEach((el) => { el.style.width = ""; });
      t!.style.width = "";
      t!.style.tableLayout = "";
      setNonce((n) => n + 1);            // 다시 그려 JSX 기본 폭이 되살아나게 한다
    }
    head.addEventListener("pointerdown", onDown as EventListener);
    head.addEventListener("dblclick", onDbl as EventListener);
    return () => {
      head.removeEventListener("pointerdown", onDown as EventListener);
      head.removeEventListener("dblclick", onDbl as EventListener);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [storageKey]);

  return ref;
}

export type SortState = { key: string; dir: 1 | -1 } | null;

/**
 * 머리글 클릭 정렬. 같은 컬럼을 다시 누르면 방향이 바뀐다.
 *
 *   const sort = useTableSort({ key: "date", dir: -1 });
 *   <th {...sort.th("date")}>일자</th>
 *   sort.apply(rows, { date: (r) => r.date, name: (r) => r.name })
 */
export function useTableSort(initial: SortState = null, storageKey?: string) {
  const prefKey = storageKey ? `sort.${storageKey}` : "";
  const [sort, setSort] = useState<SortState>(() => (prefKey ? peekPref<SortState>(prefKey) ?? initial : initial));

  // 정렬 기준도 화면 설정이라 계정에 남긴다 — 늦게 도착하면 그때 맞춘다
  useEffect(() => {
    if (!prefKey) return;
    loadPrefs();
    return onPrefsReady(() => {
      const v = peekPref<SortState>(prefKey);
      setSort(v === undefined ? initial : v);       // 계정에 없으면 화면 기본 정렬로
    });
  }, [prefKey]);

  function toggle(key: string) {
    const next: SortState = sort && sort.key === key ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: 1 };
    setSort(next);
    if (prefKey) setPref(prefKey, next);
  }
  /** 머리글에 펼쳐 넣을 속성 — 클릭·표시·보조기술 안내를 함께 준다.
   *  extra 로 hide-sm 같은 클래스를 함께 넘길 수 있다. */
  function th(key: string, extra = "") {
    const on = sort?.key === key;
    return {
      className: (extra ? extra + " " : "") + "sortable" + (on ? " sorted" : ""),
      onClick: () => toggle(key),
      // 마우스만으로 쓸 수 있으면 안 된다 — Enter·Space 로도 같은 동작을 준다
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(key); }
      },
      tabIndex: 0,
      "aria-sort": (on ? (sort!.dir === 1 ? "ascending" : "descending") : "none") as "ascending" | "descending" | "none",
      title: "클릭하면 이 컬럼으로 정렬합니다",
      "data-sort-key": key,
    };
  }
  /** 정렬 표시(▲▼) — 머리글 이름 뒤에 붙인다 */
  function mark(key: string) {
    return sort?.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : "";
  }
  function apply<T>(rows: T[], accessors: Record<string, (r: T) => unknown>): T[] {
    if (!sort) return rows;
    const get = accessors[sort.key];
    if (!get) return rows;
    // 계정에 남은 정렬 기준이 이 화면과 맞지 않아 기준값을 못 구하는 일이 있다.
    // 그때 화면 전체가 죽는 것보다 정렬만 포기하는 편이 낫다.
    if (!rows.length) return rows;
    try { get(rows[0]); } catch { return rows; }
    return [...rows].sort((a, b) => {
      const x = get(a), y = get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;                 // 빈 값은 늘 뒤로
      if (y == null) return -1;
      const r = typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y), "ko");
      return r * sort.dir;
    });
  }
  return { sort, setSort, toggle, th, mark, apply };
}
