import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";

// 게이트웨이(동일 오리진) /api 로 모든 요청 전송
export const api = axios.create({ baseURL: "/api" });

const ACCESS_KEY = "lm_access";
const REFRESH_KEY = "lm_refresh";

export const tokenStore = {
  get access() {
    return localStorage.getItem(ACCESS_KEY) || "";
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY) || "";
  },
  set(access: string, refresh?: string) {
    localStorage.setItem(ACCESS_KEY, access);
    if (refresh !== undefined) localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

// ── 통신 중 표시 ──────────────────────────────────────────────
// 목록 화면들은 데이터가 오기 전에도 표를 그리기 때문에, 느린 회선에서는
// "아직 불러오는 중"과 "정말 아무것도 없음"이 똑같이 보인다.
// 진행 중인 요청 수를 세어 화면 상단에 얇은 막대로 알려준다.
let inFlight = 0;
const busySubs = new Set<(busy: boolean) => void>();
const notifyBusy = () => busySubs.forEach((f) => f(inFlight > 0));

/** 통신 중 여부 구독 — 해제 함수를 돌려준다. */
export function onBusy(fn: (busy: boolean) => void): () => void {
  busySubs.add(fn);
  fn(inFlight > 0);
  return () => busySubs.delete(fn);
}

/** 배경에서 도는 요청(주기 폴링 등)은 진행 막대를 띄우지 않는다 — 읽는 중에 깜빡이면 방해만 된다. */
export const silent = { silent: true } as any;
const isSilent = (cfg: any) => !!cfg?.silent;

api.interceptors.request.use((cfg: InternalAxiosRequestConfig) => {
  const t = tokenStore.access;
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  if (!isSilent(cfg)) { inFlight += 1; notifyBusy(); }
  return cfg;
});
api.interceptors.response.use(
  (r) => { if (!isSilent(r.config)) { inFlight = Math.max(0, inFlight - 1); notifyBusy(); } return r; },
  (e) => { if (!isSilent(e.config)) { inFlight = Math.max(0, inFlight - 1); notifyBusy(); } return Promise.reject(e); },
);

// 401 시 refresh 1회 자동 재발급
let refreshing: Promise<string> | null = null;
api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    const status = error.response?.status;
    const isAuthCall = original?.url?.includes("/members/login") || original?.url?.includes("/members/refresh");
    if (status === 401 && !original._retry && !isAuthCall && tokenStore.refresh) {
      original._retry = true;
      try {
        if (!refreshing) {
          refreshing = axios
            .post("/api/members/refresh", { refresh: tokenStore.refresh })
            .then((res) => {
              tokenStore.set(res.data.access);
              return res.data.access as string;
            })
            .finally(() => {
              refreshing = null;
            });
        }
        const newAccess = await refreshing;
        original.headers.Authorization = `Bearer ${newAccess}`;
        return api(original);
      } catch {
        tokenStore.clear();
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

// 서버 검증 오류를 사용자 언어로 옮기기 위한 사전.
// pydantic 이 돌려주는 영문 원문(예: "Input should be a valid date")을 그대로 노출하면
// 화면에 갑자기 영어가 튀어나오고, 필드명도 내부 키(start, year_end …)라 알아볼 수 없다.
const FIELD_KO: Record<string, string> = {
  name: "이름", title: "제목", email: "이메일", password: "비밀번호", role: "역할",
  start: "시작일", end: "종료일", due: "마감일", date: "일자", claim_date: "집행일자",
  year_start: "해당 연도 시작일", year_end: "해당 연도 종료일", buy_date: "구매일자",
  start_date: "시작일", end_date: "종료일", done_date: "실제 마감일",
  amount: "금액", allocated: "편성액", spent: "집행액", days: "일수",
  agency: "전담기관", program: "사업명", host_org: "주관기관", host_pi: "주관기관 연구책임자",
  category: "비목", subcategory: "세목", project_id: "과제", assignee_id: "담당자",
  pm_id: "실무 담당자", lead_id: "책임자", reason: "사유", body: "내용", resource: "자원",
  purpose: "용도", asset_no: "자산번호", temp_password: "임시 비밀번호",
};
const TYPE_KO: Record<string, string> = {
  missing: "필수 입력입니다",
  date_from_datetime_parsing: "날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)",
  date_parsing: "날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)",
  time_parsing: "시간 형식이 올바르지 않습니다 (HH:MM)",
  int_parsing: "숫자만 입력할 수 있습니다",
  float_parsing: "숫자만 입력할 수 있습니다",
  int_type: "숫자만 입력할 수 있습니다",
  string_too_short: "너무 짧습니다",
  string_too_long: "너무 깁니다",
  value_error: "값이 올바르지 않습니다",
  greater_than_equal: "값이 너무 작습니다",
  less_than_equal: "값이 너무 큽니다",
};

export function apiError(e: unknown): string {
  const ax = e as AxiosError<{ detail?: any }>;
  const d = ax.response?.data?.detail;
  if (Array.isArray(d)) {
    // pydantic 422 검증오류: [{loc,type,msg}] → 한국어 필드명 + 한국어 사유로
    const msgs = d.map((x: any) => {
      const loc = Array.isArray(x?.loc) ? x.loc.filter((p: any) => p !== "body" && p !== "query") : [];
      const key = String(loc[loc.length - 1] ?? "");
      const label = FIELD_KO[key] || key;
      const why = TYPE_KO[String(x?.type ?? "")] || "값이 올바르지 않습니다";
      return label ? `${label}: ${why}` : why;
    });
    return [...new Set(msgs)].join("\n") || "입력값을 확인해 주세요";
  }
  if (d && typeof d === "object") return "요청을 처리하지 못했습니다";
  if (d) return String(d);
  // 서버가 사유를 주지 않은 경우(500 등) 축약된 영문 대신 상황을 알려준다
  const st = ax.response?.status;
  if (st && st >= 500) return "서버에서 처리하지 못했습니다. 잠시 후 다시 시도해 주세요";
  if (!ax.response) return "서버에 연결하지 못했습니다. 네트워크 상태를 확인해 주세요";
  return "요청 처리 중 오류가 발생했습니다";
}
