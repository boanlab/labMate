// 대량 데이터에서 페이징 경계·검색·필터 상호작용 검증
import { newBrowser, newPage, uiLogin, settle, shot } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
const b = await newBrowser();
let pass = 0, fail = 0;
const chk = (ok, l, d) => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${l}${d ? "  — " + d : ""}`); };

for (const [w, h] of [[1440, 900], [390, 844]]) {
  const { ctx, page } = await newPage(b, { w, h });
  await uiLogin(page, PERSONAS.find((p) => p.key === "phd").email);
  await page.goto(BASE + "/board"); await settle(page, 1500);

  const st = () => page.evaluate(() => {
    const pager = document.querySelector(".pager");
    const rows = document.querySelectorAll("table tbody tr").length;
    const label = pager ? (pager.innerText.match(/\d+\s*\/\s*\d+/) || [""])[0] : "";
    const btns = pager ? [...pager.querySelectorAll("button")].map((e) => ({ t: e.textContent.trim(), d: e.disabled })) : [];
    const first = document.querySelector("table tbody tr td:nth-child(2)")?.textContent.trim().slice(0, 30) || "";
    const count = (document.body.innerText.match(/(\d+)건/) || [])[1];
    return { rows, label, btns, first, count };
  });

  const p1 = await st();
  chk(p1.rows > 0 && !!p1.label, `${w}px 페이저 표시`, `${p1.label} · ${p1.rows}행 · 총 ${p1.count}건`);
  chk(p1.btns.some((x) => /이전/.test(x.t) && x.d), `${w}px 첫 페이지에서 '이전' 비활성`);

  // 마지막 페이지로
  const pages = Number((p1.label.split("/")[1] || "1").trim());
  for (let i = 1; i < pages; i++) {
    await page.locator(".pager button", { hasText: "다음" }).click();
    await page.waitForTimeout(180);
  }
  const pl = await st();
  chk(pl.label.startsWith(String(pages)), `${w}px 마지막 페이지 도달`, pl.label);
  chk(pl.rows > 0, `${w}px 마지막 페이지에 행이 있음(빈 페이지 아님)`, `${pl.rows}행`);
  chk(pl.btns.some((x) => /다음/.test(x.t) && x.d), `${w}px 마지막에서 '다음' 비활성`);

  // 검색 시 페이지가 1로 돌아가는지
  await page.locator('[data-testid="board-search"]').fill("페이징 검증 글 09");
  await settle(page, 700);
  const s = await st();
  chk(s.label.startsWith("1"), `${w}px 검색하면 첫 페이지로 복귀`, `${s.label} · ${s.count}건`);
  chk(s.rows > 0 && /09/.test(s.first), `${w}px 검색 결과가 실제로 걸러짐`, s.first);

  // 필터(칩) 전환 시에도 1페이지
  await page.locator('[data-testid="board-search"]').fill(""); await settle(page, 600);
  for (let i = 1; i < Math.min(pages, 3); i++) { await page.locator(".pager button", { hasText: "다음" }).click(); await page.waitForTimeout(150); }
  const chip = page.locator(".fchips button, .chip").filter({ hasText: "논문리뷰" }).first();
  if (await chip.count()) {
    await chip.click(); await settle(page, 700);
    const f = await st();
    chk(f.label.startsWith("1"), `${w}px 분류 전환하면 첫 페이지로 복귀`, `${f.label} · ${f.count}건`);
  }
  if (w === 1440) await shot(page, "paging-desktop");
  await ctx.close();
}
console.log(`\n결과: ${pass}/${pass + fail} 통과`);
await b.close();
