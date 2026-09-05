// HTML 유틸 — 목록 미리보기 등에서 태그 제거 후 앞부분만 반환
export function stripHtml(html: string, max = 80): string {
  const text = (html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max) + "…" : text;
}

/** 편집기 HTML → 사람이 읽는 줄글. 태그째 모델에 넘기면 마크업까지 내용으로 읽는다. */
export function htmlToPlain(html: string): string {
  return (html || "")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 줄글 → 편집기에 넣을 HTML. 빈 줄로 문단을 나누고 한 줄 개행은 <br> 로 살린다. */
export function plainToHtml(text: string): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return (text || "").split(/\n{2,}/)
    // 이스케이프한 뒤에 굵게를 살린다 — 순서를 바꾸면 태그가 글자로 새어 나온다
    .map((para) => `<p>${esc(para).replace(/\n/g, "<br>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")}</p>`)
    .join("");
}
