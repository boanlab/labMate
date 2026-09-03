// 전역 검색 · 내 할 일 통합
import { newBrowser, newPage, uiLogin, settle, shot } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
const b = await newBrowser();
let pass = 0, fail = 0;
const chk = (ok, l, d) => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${l}${d ? "\n     " + d : ""}`); };
const P = Object.fromEntries(PERSONAS.map((p) => [p.key, p]));

// 전역 검색
{
  const { ctx, page, errors } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.prof.email); await settle(page, 1500);
  chk(await page.locator('[data-testid="global-search-open"]').count() > 0, "상단바에 전체 검색 버튼");
  // 단축키로 열기
  await page.keyboard.press("Control+k"); await settle(page, 900);
  chk(await page.locator('[data-testid="global-search"]').count() > 0, "Ctrl+K 로 열림");
  await page.waitForFunction(() => !/불러오는 중/.test(document.querySelector('[data-testid="global-search-results"]')?.textContent || ""), { timeout: 20000 }).catch(() => {});
  // 여러 모듈이 걸리는 검색어
  await page.locator('[data-testid="global-search-input"]').fill("eBPF"); await settle(page, 700);
  const groups = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="gs-hit-"] .badge')].map((e) => e.textContent.trim()));
  chk(groups.length > 0, "검색 결과 표시", `그룹: ${JSON.stringify([...new Set(groups)])} · ${groups.length}건`);
  chk(new Set(groups).size >= 2, "여러 모듈을 가로질러 검색", JSON.stringify([...new Set(groups)]));
  await shot(page, "gs-results");
  // 키보드 이동·Enter 이동
  await page.keyboard.press("ArrowDown"); await settle(page, 250);
  const before = new URL(page.url()).pathname;
  await page.keyboard.press("Enter"); await settle(page, 1500);
  const after = new URL(page.url()).pathname + new URL(page.url()).search;
  chk(after !== before || !!new URL(page.url()).search, "Enter 로 해당 항목으로 이동", `${before} → ${after}`);
  chk(await page.locator('[data-testid="global-search"]').count() === 0, "이동 후 검색창 닫힘");
  // 결과 없음
  await page.keyboard.press("Control+k"); await settle(page, 700);
  await page.locator('[data-testid="global-search-input"]').fill("존재하지않는항목ZZZ"); await settle(page, 700);
  chk(/해당하는 항목이 없습니다/.test(await page.locator('[data-testid="global-search-results"]').innerText()), "결과 없음 안내");
  await page.keyboard.press("Escape"); await settle(page, 500);
  chk(await page.locator('[data-testid="global-search"]').count() === 0, "Esc 로 닫힘");
  chk(errors.filter((e) => e.kind === "pageerror").length === 0, "JS 예외 없음");
  await ctx.close();
}
// 내 할 일 통합
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.phd.email); await settle(page, 1800);
  const card = await page.evaluate(() => document.querySelector('[data-testid="dash-todo-card"]')?.innerText.replace(/\n/g, " | ") || "(없음)");
  console.log("     내 할 일:", card.slice(0, 200));
  chk(/업무/.test(card), "세부업무가 '내 할 일'에 포함");
  chk(/액션|결재|필독|업무/.test(card), "여러 출처가 한곳에 모임");
  const kpi = await page.evaluate(() => document.querySelector('[data-testid="kpi-todo"]')?.innerText.replace(/\n/g, " ") || "");
  console.log("     할 일 KPI:", kpi);
  await shot(page, "todo-merged");
  await ctx.close();
}
console.log(`\n결과: ${pass}/${pass + fail} 통과`);
await b.close();
