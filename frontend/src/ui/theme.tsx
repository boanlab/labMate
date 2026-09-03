import { useEffect } from "react";

import { usePref } from "../api/prefs";

/** 다크모드 — 계정에 저장. 첫 화면 깜빡임 방지를 위해 마지막 값을 브라우저 힌트로 둔다. */
export function useTheme() {
  const [dark, setDark] = usePref<boolean>("theme_dark", false, { hint: true });
  useEffect(() => { document.body.classList.toggle("dark", dark); }, [dark]);
  return { dark, toggle: () => setDark(!dark) };
}
