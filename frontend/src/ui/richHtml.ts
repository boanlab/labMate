// CKEditor 본문(HTML) 보기용 후처리 — 미디어 임베드(<oembed>)를 반응형 iframe 으로 변환.
// 에디터는 미디어를 <oembed url> 로 저장하는데 보기 화면엔 CKEditor 런타임이 없어 그대로면 렌더링되지 않는다.

function embedSrc(url: string): string {
  const yt = url.match(/(?:youtu\.be\/|[?&]v=|youtube\.com\/embed\/)([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return "";
}

function iframeBlock(url: string): string {
  const src = embedSrc(url);
  if (!src) return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  return (
    `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;max-width:100%;margin:10px 0;border-radius:8px;">` +
    `<iframe src="${src}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" ` +
    `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`
  );
}

// <figure class="media">…<oembed url="…"></oembed>…</figure> 또는 단독 <oembed>/data-oembed-url 를 iframe 으로 치환.
export function richHtml(html?: string | null): string {
  if (!html || html.indexOf("oembed") === -1) return html || "";
  return html
    .replace(/<figure[^>]*class="[^"]*\bmedia\b[^"]*"[^>]*>\s*<oembed[^>]*url="([^"]+)"[^>]*>\s*<\/oembed>\s*<\/figure>/gi, (_m, url) => iframeBlock(url))
    .replace(/<oembed[^>]*url="([^"]+)"[^>]*>\s*<\/oembed>/gi, (_m, url) => iframeBlock(url));
}
