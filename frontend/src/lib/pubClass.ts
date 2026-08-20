// 실적 분류 — 실적(Publications)과 과제 목표(Projects) 집계가 공유하는 단일 기준.
// 고정 6종 라벨. 실적 화면과 목표 달성 집계가 동일 라벨로 잡히도록 두 곳이 이 함수를 함께 쓴다.
export const FIXED_KINDS = ["국제논문지", "국내논문지", "국제학술대회", "국내학술대회", "국제특허", "국내특허"];

type PubLike = { kind?: string; index_grade?: string; index_type?: string; scope?: string };

// 실적 종류 → 양식 계열(고정 6종만 전용, 그 외 기타)
export function family(k: string): "논문" | "학술대회" | "특허" | "기타" {
  if (/특허/.test(k)) return "특허";
  if (/학술대회|학회/.test(k)) return "학술대회";
  if (/논문|SCI|KCI/i.test(k)) return "논문";
  return "기타";
}

// 실적 → 고정 6종 라벨(커스텀은 그대로, 구 데이터는 6종 매핑)
export function seriesOf(u: PubLike): string {
  const k = u.kind || "";
  if (FIXED_KINDS.includes(k)) return k;
  const fam = family(k);
  if (fam === "논문") {
    const ix = u.index_grade || u.index_type || k;
    return /SSCI|SCIE|SCI|SCOPUS|A&HCI/i.test(ix) ? "국제논문지" : "국내논문지";
  }
  const intl = (u.scope || "국외") === "국외" || /국제|국외|해외/.test(k);
  if (fam === "학술대회") return intl ? "국제학술대회" : "국내학술대회";
  if (fam === "특허") return intl ? "국제특허" : "국내특허";
  return k;   // 기타(커스텀 종류)
}
