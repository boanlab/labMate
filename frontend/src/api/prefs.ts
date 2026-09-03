import { useEffect, useState } from "react";

import { api, silent } from "./client";

/**
 * 사용자별 화면 설정(표 컬럼 폭 등).
 *
 * 브라우저에만 두면 PC 를 바꿀 때마다 다시 맞춰야 하고, 같은 PC 를 여러 사람이
 * 쓰면 남의 설정을 물려받는다. 그래서 서버(계정)를 단일 출처로 두고, 세션당
 * 한 번만 받아 메모리에 들고 쓴다.
 */
let cache: Record<string, any> | null = null;
let pending: Promise<Record<string, any>> | null = null;
const subs = new Set<() => void>();

/** 세션당 1회 조회. 이미 받았으면 그대로 돌려준다. */
export function loadPrefs(): Promise<Record<string, any>> {
  if (cache) return Promise.resolve(cache);
  if (!pending) {
    pending = api.get<Record<string, any>>("/members/prefs", silent)
      .then((r) => {
        // 조회 중에 사용자가 바꾼 값이 있으면 그쪽이 최신이다 — 응답으로 덮어쓰지 않는다.
        cache = { ...(r.data || {}), ...(cache || {}) };
        return cache;
      })
      .catch(() => { cache = cache || {}; return cache; })   // 실패해도 기본값으로 계속 쓴다
      .finally(() => { pending = null; subs.forEach((f) => f()); });
  }
  return pending;
}

/** 이미 받아 둔 값(없으면 undefined). 첫 렌더에서 기다리지 않으려고 동기로 둔다. */
export function peekPref<T>(key: string): T | undefined {
  return cache ? (cache[key] as T) : undefined;
}

/** 설정이 도착하면 알림 — 늦게 온 값으로 화면을 다시 맞추기 위해 */
export function onPrefsReady(fn: () => void): () => void {
  if (cache) fn();
  subs.add(fn);
  return () => subs.delete(fn);
}

/** 저장 — 잦은 변경(드래그)을 감안해 잠시 모았다 보낸다. 빈 값이면 서버에서 지운다. */
const timers: Record<string, number> = {};
export function setPref(key: string, value: unknown) {
  if (!cache) cache = {};
  const empty = value == null || (typeof value === "object" && !Object.keys(value as object).length);
  if (empty) delete cache[key]; else cache[key] = value;
  window.clearTimeout(timers[key]);
  timers[key] = window.setTimeout(() => {
    api.put(`/members/prefs/${encodeURIComponent(key)}`, { value: empty ? null : value }, silent).catch(() => { /* 저장 실패는 화면을 막지 않는다 */ });
  }, 400);
}

/** 로그아웃 시 다른 사람 설정이 남지 않도록 비운다. */
export function clearPrefs() {
  cache = null; pending = null;
}


/* ── 화면에 곧바로 보이는 설정(테마·사이드바) ──────────────────────────
 * 서버 값이 도착하기 전에도 첫 화면이 깜빡이지 않아야 해서, 브라우저에
 * 마지막 값을 힌트로 남겨 두고 즉시 적용한다. 진짜 값은 서버이고, 도착하면
 * 그 값으로 맞춘다. 같은 PC 를 다른 사람이 써도 1초 안에 자기 설정으로 바뀐다.
 */
const HINT = (k: string) => `lm.hint.${k}`;

export function readHint<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(HINT(key));
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch { return fallback; }
}
export function writeHint(key: string, value: unknown) {
  try { localStorage.setItem(HINT(key), JSON.stringify(value)); } catch { /* 무시 */ }
}
export function dropHint(key: string) {
  try { localStorage.removeItem(HINT(key)); } catch { /* 무시 */ }
}
export function clearHints() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith("lm.hint.")).forEach((k) => localStorage.removeItem(k));
  } catch { /* 무시 */ }
}

/** 계정에 저장되는 화면 설정 하나를 상태처럼 쓴다. hint=true 면 첫 화면 깜빡임을 막는다. */
export function usePref<T>(key: string, fallback: T, opts: { hint?: boolean } = {}): [T, (v: T) => void] {
  const [val, setVal] = useState<T>(() => (opts.hint ? readHint(key, fallback) : (peekPref<T>(key) ?? fallback)));
  useEffect(() => {
    loadPrefs();
    return onPrefsReady(() => {
      // 서버가 단일 출처다. 계정에 값이 없으면 기본값으로 되돌리고 힌트도 버린다 —
      // 그러지 않으면 설정을 초기화해도 이 브라우저에 남은 옛 값이 계속 되살아난다.
      const v = peekPref<T>(key);
      setVal(v === undefined ? fallback : v);
      if (opts.hint) { if (v === undefined) dropHint(key); else writeHint(key, v); }
    });
  }, [key]);
  const put = (v: T) => {
    setVal(v);
    if (opts.hint) writeHint(key, v);
    setPref(key, v);
  };
  return [val, put];
}
