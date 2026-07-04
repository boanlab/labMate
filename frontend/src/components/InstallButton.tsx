// PWA 설치 유도 — 안드로이드/크롬의 beforeinstallprompt 를 잡아 앱바에 "앱 설치" 버튼 노출.
// iOS(사파리)는 이 이벤트가 없어 버튼이 뜨지 않음(홈 화면 추가로 수동 설치).
import { useEffect, useState } from "react";

export function InstallButton() {
  const [deferred, setDeferred] = useState<any>(null);
  useEffect(() => {
    const onPrompt = (e: any) => { e.preventDefault(); setDeferred(e); };   // 설치 가능 시 프롬프트 보류
    const onInstalled = () => setDeferred(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);
  if (!deferred) return null;   // 미지원·이미 설치·iOS 에서는 숨김
  async function install() {
    deferred.prompt();
    try { await deferred.userChoice; } catch { /* */ }
    setDeferred(null);
  }
  return (
    <button data-testid="pwa-install" onClick={install} title="앱을 홈 화면에 설치"
      style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 30, padding: "0 10px", borderRadius: 8, border: "none", background: "var(--brand)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
      ⬇ 앱 설치
    </button>
  );
}
