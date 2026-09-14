// 새 배포 알림 — 열려 있는 화면은 배포해도 옛 코드를 그대로 쓴다.
//
// 실제로 겪은 일이다. 고친 기능을 배포한 뒤에도 이미 열어 둔 화면에서는 옛 동작이
// 그대로 나왔다. 화면을 다시 읽기 전에는 아무도 그 사실을 알 수 없으므로, 새 번들이
// 올라온 것을 발견하면 알려 주고 새로고침을 한 번에 하게 한다.
import { useEffect, useState } from "react";

/** 지금 돌고 있는 번들 파일 경로. 빌드마다 해시가 바뀌므로 이것이 곧 버전이다. */
function running(): string {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  try { return el ? new URL(el.src).pathname : ""; } catch { return ""; }
}

/** 서버의 index.html 이 가리키는 번들과 다르면 새 배포가 있는 것이다. */
async function hasNewBuild(mine: string): Promise<boolean> {
  try {
    const r = await fetch("/index.html", { cache: "no-store" });
    if (!r.ok) return false;
    const m = (await r.text()).match(/src="(\/assets\/index-[^"]+\.js)"/);
    return !!m && m[1] !== mine;
  } catch { return false; }   // 오프라인·일시 장애는 새 버전이 아니다
}

export function UpdateBanner() {
  const [show, setShow] = useState(false);
  const [off, setOff] = useState(false);      // 이번에 닫았으면 다시 조르지 않는다

  useEffect(() => {
    const mine = running();
    if (!mine || off) return;
    let dead = false;
    const check = async () => { if (!dead && !document.hidden && await hasNewBuild(mine)) setShow(true); };
    check();
    const t = setInterval(check, 10 * 60 * 1000);   // 10분마다 — 배포는 자주 있는 일이 아니다
    const onFocus = () => check();                  // 탭으로 돌아올 때 한 번 더
    window.addEventListener("focus", onFocus);
    return () => { dead = true; clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [off]);

  if (!show || off) return null;
  return (
    <div className="update-bar" role="status" data-testid="update-bar">
      <span>새 버전이 있습니다 — 지금 화면은 옛 기능으로 돕니다.</span>
      <button className="btn primary sm" data-testid="update-reload" onClick={() => location.reload()}>새로고침</button>
      <button className="btn ghost sm" aria-label="닫기" onClick={() => { setShow(false); setOff(true); }}>✕</button>
    </div>
  );
}
