// 화면을 그리다 터졌을 때 흰 화면 대신 무엇이 일어났는지 보여 준다.
//
// 가장 흔한 원인은 배포다. 열어 둔 화면은 옛 번들을 쥐고 있는데, 필요한 조각(에디터처럼
// 나중에 받아 오는 부분)은 새 배포로 이름이 바뀌어 서버에 없다. 그 순간 화면이 통째로
//하얘진다. 새로고침하면 멀쩡한 이유도 이것이다.
import { Component, ReactNode } from "react";

const RELOAD_KEY = "lm.chunk-reload";

/** 배포로 조각이 사라져 생긴 오류인가 — 브라우저마다 문구가 달라 넓게 본다. */
export function isStaleChunk(err: unknown): boolean {
  const m = String((err as any)?.message || err || "");
  return /dynamically imported module|Importing a module script failed|error loading dynamically|ChunkLoadError|Failed to fetch/i.test(m);
}

/** 한 번만 새로고침한다 — 서버가 정말 조각을 잃어버린 경우 무한 새로고침이 되지 않도록. */
export function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 30000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch { /* 저장이 막힌 브라우저면 그냥 한 번 더 시도한다 */ }
  location.reload();
  return true;
}

export class Boundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state: { err: Error | null } = { err: null };

  static getDerivedStateFromError(err: Error) { return { err }; }

  componentDidCatch(err: Error) {
    if (isStaleChunk(err)) reloadOnce();     // 새 배포 탓이면 조용히 다시 읽는다
  }

  render() {
    const { err } = this.state;
    if (!err) return this.props.children;
    const stale = isStaleChunk(err);
    return (
      <div className="center" style={{ flexDirection: "column", gap: 10, padding: 24, textAlign: "center" }} data-testid="app-crash">
        <h2 style={{ margin: 0 }}>{stale ? "새 버전이 배포되었습니다" : "화면을 그리지 못했습니다"}</h2>
        <div className="muted small">
          {stale ? "열어 두신 화면이 옛 버전이라 이어서 그리지 못했습니다. 새로고침하면 됩니다."
                 : "잠시 뒤 다시 시도해 주세요. 계속되면 관리자에게 알려 주세요."}
        </div>
        {!stale && <div className="muted small" style={{ maxWidth: 560, wordBreak: "break-word" }}>{String(err.message || err)}</div>}
        <button className="btn primary" onClick={() => location.reload()}>새로고침</button>
      </div>
    );
  }
}
