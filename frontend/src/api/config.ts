// 관리자 편집형 마스터데이터(설정) 클라이언트 — 각 서비스의 /config 에서 로드.
// 프론트는 항상 fallback 기본값을 갖고 있어 설정 fetch 실패 시에도 UI가 깨지지 않는다.
import { useEffect, useState } from "react";
import { api } from "./client";

// 설정 키 → 소유 서비스 매핑
export const CONFIG_SERVICE: Record<string, string> = {
  budget_types: "funds", grade_rates: "funds", expense_approval: "funds",
  leave_types: "attendance", annual_leave_default: "attendance", attendance_states: "attendance",
  approval_types: "boards", approval_templates: "boards", post_types: "boards", event_types: "boards",
  brand_logo: "boards", lab_name: "boards", base_url: "boards", login_logo: "boards", login_subtitle: "boards",
  booking_resources: "resource", rack_max_u: "resource", course_types: "resource", lesson_types: "resource",
  device_types: "resource", asset_types: "resource", video_cats: "resource",
  project_types: "projects", agencies: "projects", pub_types: "projects",
  pub_index: "projects", pub_roles: "projects", conf_scopes: "projects",
  patent_types: "projects", pub_statuses: "projects",
};

const cache: Record<string, Promise<any>> = {};

// 도메인(base_url) — 설정 시 업로드 경로를 절대 URL로 생성. boards config 로드 시 동기화.
let _baseUrl = "";
export function fileUrl(path: string): string {
  if (!path || /^(https?:|data:|blob:)/.test(path)) return path;
  return _baseUrl ? _baseUrl.replace(/\/+$/, "") + (path.startsWith("/") ? path : "/" + path) : path;
}
// 설정 변경 구독자(useConfig 인스턴스) — 저장/캐시무효화 시 즉시 재조회시킨다.
const listeners = new Set<() => void>();

export function loadConfig(service: string): Promise<Record<string, any>> {
  if (!cache[service]) {
    cache[service] = api.get(`/${service}/config`).then((r) => { const d = r.data; if (service === "boards" && typeof d?.base_url === "string") _baseUrl = d.base_url; return d; }).catch(() => ({}));
  }
  return cache[service];
}

export function clearConfigCache(service?: string) {
  if (service) delete cache[service];
  else for (const k of Object.keys(cache)) delete cache[k];
  listeners.forEach((fn) => fn());   // 마운트된 useConfig 들에게 재조회 알림
}

export async function saveConfig(service: string, key: string, value: any) {
  await api.put(`/${service}/config/${key}`, { value });
  clearConfigCache(service);
}

// 단일 키 구독 훅. fallback 으로 초기 렌더, 로드되면 교체.
export function useConfig<T = any>(key: string, fallback: T): T {
  const service = CONFIG_SERVICE[key];
  const [val, setVal] = useState<T>(fallback);
  useEffect(() => {
    if (!service) return;
    let on = true;
    const fetchIt = () => loadConfig(service).then((c) => { if (on && c && c[key] !== undefined) setVal(c[key]); });
    fetchIt();
    const listener = () => fetchIt();           // 설정 저장 시 즉시 재조회
    listeners.add(listener);
    return () => { on = false; listeners.delete(listener); };
  }, [key, service]);
  return val;
}

// {name, subs?} 또는 문자열 혼용 마스터에서 이름 배열만 추출
export function names(list: any[]): string[] {
  return (list || []).map((x) => (typeof x === "string" ? x : x?.name)).filter(Boolean);
}
