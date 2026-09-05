// 모든 "오늘/올해" 계산은 KST(Asia/Seoul) 기준, 표기는 yyyy-mm-dd 로 통일.
// en-CA 로캘은 yyyy-mm-dd 포맷을 보장한다.
export function todayKST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}
export function yearKST(): number {
  return Number(todayKST().slice(0, 4));
}

// 근무일 — 새벽 6시를 하루의 경계로 본다(백엔드 attendance 의 DAY_START_HOUR 와 같은 규칙).
// 자정 기준으로 끊으면 새벽까지 일하는 사람의 근무가 0시에 끊겨 '미체크'로 넘어간다.
export const WORKDAY_START_HOUR = 6;
export function workdayKST(): string {
  const today = todayKST();
  const hour = Number(new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour12: false, hour: "2-digit" }).slice(0, 2));
  if (hour >= WORKDAY_START_HOUR) return today;
  const d = new Date(today + "T00:00:00");
  d.setDate(d.getDate() - 1);   // toISOString 은 UTC 로 밀리므로 지역 시간 그대로 조립한다
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// UTC(ISO, timestamptz) 값을 KST 표기로 변환. 값이 없으면 "".
// created_at/updated_at/audit.at 등 서버 UTC 타임스탬프 표시용(앞 10자 자르기는 UTC 날짜라 하루 어긋남).
export function dateKST(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 10);   // 파싱 불가(이미 날짜문자열 등)면 원본
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });   // yyyy-mm-dd
}

// UTC(ISO) → KST "yyyy-mm-dd HH:mm".
export function dtKST(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).replace("T", " ").slice(0, 16);
  const date = d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const time = d.toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}
