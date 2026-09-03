import { newBrowser, newPage, uiLogin, settle } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
import { clickBtn } from "./helpers.mjs";
const b = await newBrowser();
const { page } = await newPage(b, { w: 1440, h: 900 });
await uiLogin(page, PERSONAS.find((p) => p.key === "prof").email);
let pass = 0, fail = 0;
const chk = (ok, l, d) => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${l}${d ? "  — " + d : ""}`); };

// 연구과제: 필수값을 단계적으로 채우며 포커스가 다음 미입력 칸으로 가는지
await page.goto(BASE + "/grants"); await settle(page, 800);
await clickBtn(page, "+ 연구과제 추가"); await settle(page, 700);
const steps = [
  { fill: null, expect: "p-name", label: "빈 상태 제출 → 과제명" },
  { fill: ["p-name", "테스트 과제"], expect: "p-program", label: "과제명 입력 후 → 사업명" },
  { fill: ["p-program", "테스트 사업"], expect: "p-year-start", label: "사업명 입력 후 → 해당 연도 시작" },
  { fill: ["p-year-start", "2026-03-01"], expect: "p-year-end", label: "시작 입력 후 → 해당 연도 종료" },
  { fill: ["p-year-end", "2027-02-28"], expect: "p-host-org", label: "종료 입력 후 → 주관기관" },
  { fill: ["p-host-org", "단국대학교"], expect: "p-host-pi", label: "주관기관 입력 후 → 연구책임자" },
];
for (const st of steps) {
  if (st.fill) await page.locator(`[data-testid="${st.fill[0]}"]`).fill(st.fill[1]);
  await clickBtn(page, "추가"); await settle(page, 700);
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") || document.activeElement?.tagName);
  const msg = await page.evaluate(() => document.querySelector('[data-testid="project-error"]')?.innerText.trim() || "");
  chk(focused === st.expect, st.label, `포커스=${focused} 메시지="${msg}"`);
}
console.log(`\n결과: ${pass}/${pass + fail} 통과`);
await b.close();
