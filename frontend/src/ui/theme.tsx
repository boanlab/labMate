import { useEffect } from "react";

import { usePref } from "../api/prefs";

/** 다크모드 — 계정에 저장한다(다른 PC 에서도 같은 모드로 시작).
 *  첫 화면이 깜빡이지 않도록 마지막 값을 브라우저에 힌트로 남겨 즉시 적용한다. */
export function useTheme() {
  const [dark, setDark] = usePref<boolean>("theme_dark", false, { hint: true });
  useEffect(() => { document.body.classList.toggle("dark", dark); }, [dark]);
  return { dark, toggle: () => setDark(!dark) };
}
