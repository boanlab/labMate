// 모든 "오늘/올해" 계산은 KST(Asia/Seoul) 기준, 표기는 yyyy-mm-dd 로 통일.
// en-CA 로캘은 yyyy-mm-dd 포맷을 보장한다.
export function todayKST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}
export function yearKST(): number {
  return Number(todayKST().slice(0, 4));
}
