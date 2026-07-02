// HTML 유틸 — 목록 미리보기 등에서 태그 제거 후 앞부분만 반환
export function stripHtml(html: string, max = 80): string {
  const text = (html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max) + "…" : text;
}
