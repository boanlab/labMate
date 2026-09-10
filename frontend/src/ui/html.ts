// HTML 유틸 — 목록 미리보기 등에서 태그 제거 후 앞부분만 반환
export function stripHtml(html: string, max = 80): string {
  const text = (html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max) + "…" : text;
}

/** 편집기 HTML → 사람이 읽는 줄글. 태그째 모델에 넘기면 마크업까지 내용으로 읽는다.
 *
 * 목록은 구조가 뜻을 담는다 — 태그만 걷어내면 `<li>기타<ul><li>AI중심대학…`  이
 * "기타AI중심대학…" 한 덩어리가 되어, 과제 이름을 잘못 읽는다. 줄과 들여쓰기로 옮긴다.
 */
const BLOCK = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "TR", "BLOCKQUOTE",
  "SECTION", "ARTICLE", "PRE", "TABLE", "THEAD", "TBODY", "FIGURE", "FIGCAPTION"]);

export function htmlToPlain(html: string): string {
  if (!html) return "";
  if (typeof DOMParser === "undefined") return stripTagsPlain(html);
  const body = new DOMParser().parseFromString(html, "text/html").body;
  const lines: string[] = [];
  let buf = "";     // 쌓고 있는 줄의 본문
  let pre = "";     // 그 줄 앞에 붙일 들여쓰기·글머리표
  const flush = () => {
    const t = buf.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    if (t) lines.push(pre + t);
    buf = ""; pre = "";
  };
  const walk = (node: Node, depth: number) => {
    node.childNodes.forEach((c) => {
      if (c.nodeType === 3) { buf += c.nodeValue || ""; return; }
      if (c.nodeType !== 1) return;
      const el = c as HTMLElement;
      const tag = el.tagName;
      if (tag === "BR") { flush(); return; }
      if (tag === "UL" || tag === "OL") { flush(); walk(el, depth + 1); return; }
      if (tag === "LI") { flush(); pre = "  ".repeat(Math.max(0, depth - 1)) + "- "; walk(el, depth); flush(); return; }
      if (BLOCK.has(tag)) { flush(); walk(el, depth); flush(); return; }
      walk(el, depth);                                   // 인라인(strong·em·a…)은 글자만 잇는다
    });
  };
  walk(body, 0);
  flush();
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** DOMParser 가 없는 자리(테스트·SSR)용 — 블록 태그 자리에서 줄을 나눈다. */
function stripTagsPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|ul|ol|h[1-6]|tr)[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 줄글 → 편집기에 넣을 HTML.
 *
 * htmlToPlain 이 목록을 "- " 와 들여쓰기로 옮기므로, 돌아올 때도 목록으로 되살린다.
 * 그러지 않으면 멘토 개선안을 적용할 때마다 보고서가 문단 한 덩어리로 뭉개진다.
 */
export function plainToHtml(text: string): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // 이스케이프한 뒤에 굵게를 살린다 — 순서를 바꾸면 태그가 글자로 새어 나온다
  const inline = (t: string) => esc(t).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  const out: string[] = [];
  let para: string[] = [];
  let depth = 0, liOpen = false;          // 열린 <ul> 수 / 지금 <li> 가 열려 있는지

  const endPara = () => { if (para.length) { out.push(`<p>${para.join("<br>")}</p>`); para = []; } };
  const endList = () => {
    while (depth > 0) { if (liOpen) out.push("</li>"); out.push("</ul>"); depth--; liOpen = true; }
    liOpen = false;
  };

  for (const raw of (text || "").split("\n")) {
    const bullet = raw.match(/^([ \t]*)[-*\u2022]\s+(.*)$/);
    if (bullet) {
      endPara();
      const want = Math.floor(bullet[1].replace(/\t/g, "  ").length / 2) + 1;
      while (depth < want) { out.push("<ul>"); depth++; liOpen = false; }   // 깊어질 땐 열린 <li> 안으로
      while (depth > want) { if (liOpen) out.push("</li>"); out.push("</ul>"); depth--; liOpen = true; }
      if (liOpen) out.push("</li>");
      out.push(`<li>${inline(bullet[2])}`); liOpen = true;
      continue;
    }
    endList();
    const head = raw.match(/^(#{1,4})\s+(.*)$/);
    if (head) { endPara(); out.push(`<h${head[1].length + 1}>${inline(head[2])}</h${head[1].length + 1}>`); continue; }
    if (!raw.trim()) { endPara(); continue; }
    para.push(inline(raw.trim()));
  }
  endList(); endPara();
  return out.join("");
}
