// 자산을 자원예약 대상으로 연결
import { newBrowser, newPage, uiLogin, settle, shot } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
import { clickBtn } from "./helpers.mjs";
const b = await newBrowser();
let pass = 0, fail = 0;
const chk = (ok, l, d) => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${l}${d ? "\n     " + d : ""}`); };
const P = Object.fromEntries(PERSONAS.map((p) => [p.key, p]));
const NAME = "공용 광학현미경 " + Date.now().toString().slice(-4);

// 예약 대상 자산 등록
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.prof.email);
  await page.goto(BASE + "/assets"); await settle(page, 1300);
  await page.locator('[data-testid="asset-add-open"]').click(); await settle(page, 800);
  await page.locator('[data-testid="as-name"]').fill(NAME);
  await page.locator('[data-testid="as-asset_no"]').fill("2026-BK-01");
  chk(await page.locator('[data-testid="as-bookable"]').count() > 0, "자산 폼에 '자원예약 대상' 선택지");
  await page.locator('[data-testid="as-bookable"]').check();
  await clickBtn(page, "등록"); await settle(page, 1600);
  await page.locator('[data-testid="asset-table-search"]').fill(NAME); await settle(page, 800);
  const listed = await page.evaluate((n) => document.body.innerText.includes(n), NAME);
  chk(listed, "자산 등록됨");
  const badge = await page.evaluate((n) => {
    const tr = [...document.querySelectorAll("table tbody tr")].find((r) => r.innerText.includes(n));
    return tr ? tr.innerText.includes("예약") : false;
  }, NAME);
  chk(badge, "목록에 '예약' 표시");
  await shot(page, "bk-asset");
  await ctx.close();
}
// 예약 화면 자원 목록에 뜨는지
{
  const { ctx, page, errors } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.master.email);
  await page.goto(BASE + "/booking"); await settle(page, 1600);
  await page.locator('[data-testid="booking-add-open"]').click(); await settle(page, 900);
  const opts = await page.locator('[data-testid="bk-resource"] option').allTextContents();
  chk(opts.includes(NAME), "예약 자원 목록에 자산이 나타남", JSON.stringify(opts));
  // 실제 예약까지
  await page.locator('[data-testid="bk-resource"]').selectOption({ label: NAME });
  await page.locator('[data-testid="bk-date"]').fill("2026-12-22");
  await page.locator('[data-testid="bk-start"]').fill("13:00");
  await page.locator('[data-testid="bk-end"]').fill("15:00");
  await page.locator('[data-testid="bk-purpose"]').fill("자산 예약 검증");
  await page.locator('[data-testid="booking-add-submit"]').click(); await settle(page, 1600);
  const saved = await page.evaluate((n) => document.body.innerText.includes(n), NAME);
  chk(saved, "자산을 대상으로 예약 등록");
  // 자원 필터에도 반영
  const filterOpts = await page.locator('[data-testid="bk-res-filter"] option').allTextContents();
  chk(filterOpts.includes(NAME), "자원 필터에도 포함");
  chk(errors.filter((e) => e.kind === "http" || e.kind === "pageerror").length === 0, "오류 없음",
      JSON.stringify(errors.filter((e) => e.kind === "http" || e.kind === "pageerror")));
  await shot(page, "bk-booking");
  await ctx.close();
}
console.log(`\n결과: ${pass}/${pass + fail} 통과`);
await b.close();
