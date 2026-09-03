// 구성원 이름 표시 전용 명부(비활성 포함).
// 구성원 목록(/members/users)은 학생에게 퇴사자를 감추므로 id→이름 조회는 이쪽을 쓴다.
import { useEffect, useState } from "react";

import { api, silent } from "./client";

export interface DirEntry { id: string; name: string; role: string; active: boolean; }

let cache: Record<string, DirEntry> | null = null;
let pending: Promise<Record<string, DirEntry>> | null = null;
const subs = new Set<() => void>();

/** 세션당 1회 조회. 이름은 자주 바뀌지 않으므로 화면마다 다시 받지 않는다. */
export function loadDirectory(): Promise<Record<string, DirEntry>> {
  if (cache) return Promise.resolve(cache);
  if (!pending) {
    pending = api.get<DirEntry[]>("/members/directory", silent)
      .then((r) => { cache = Object.fromEntries((r.data || []).map((u) => [u.id, u])); return cache; })
      .catch(() => { cache = {}; return cache; })
      .finally(() => { pending = null; subs.forEach((f) => f()); });
  }
  return pending;
}

/** 로그아웃 시 앞사람 명부가 남지 않도록 비운다. */
export function clearDirectory() { cache = null; pending = null; }

/** id → 이름. 명부에 없으면 "(삭제된 구성원)" — 아이디는 노출하지 않는다.
 *  `.map(nameOf)` 로 바로 넘길 수 있게 인자는 하나만 받는다. */
export type NameOf = (id: string) => string;

/** blank: id 가 비어 있을 때 보여 줄 문구(화면마다 "—"/"미지정"/"" 로 다르다) */
export function useDirectory(blank = "—"): NameOf {
  const [, bump] = useState(0);
  useEffect(() => {
    loadDirectory();
    const fn = () => bump((n) => n + 1);
    subs.add(fn);
    return () => { subs.delete(fn); };
  }, []);
  return (id: string) => {
    if (!id) return blank;
    if (!cache) return "";                       // 아직 오는 중 — 아이디를 내보이느니 잠깐 비워 둔다
    return cache[id]?.name || "(삭제된 구성원)";
  };
}
