// 느린 회선에서 '불러오는 중'과 '없음'이 구분되는지 — 라우트마다 새 세션으로 검사한다
// (이전 화면의 미완료 요청이 다음 화면 판정에 섞이지 않도록)
import { newBrowser, newPage, uiLogin, settle, shot } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
const b = await newBrowser();
let pass = 0, fail = 0;
const chk = (ok, l, d) => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${l}${d ? "\n     " + d : ""}`); };
const snap = (page) => page.evaluate(() => ({
  bar: !!document.querySelector('[data-testid="top-progress"]'),
  body: (document.querySelector("main")?.innerText || "").replace(/\n+/g, " | ").slice(0, 120),
}));

for (const route of ["/notices", "/members", "/board"]) {
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, PERSONAS.find((p) => p.key === "prof").email);
  await ctx.route("**/api/**", async (r) => {
    if (r.request().method() === "GET") await new Promise((res) => setTimeout(res, 1200));
    await r.continue();
  });
  await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".appshell", { timeout: 20000 });
  await page.waitForTimeout(400);
  const mid = await snap(page);
  chk(mid.bar, `${route} 로딩 중 상단 진행 막대 표시`);
  chk(!/없습니다|없음/.test(mid.body) || /불러오는 중/.test(mid.body),
      `${route} 로딩 중 "없음"으로 오인시키지 않음`, mid.body || "(본문 아직 없음)");
  if (route === "/notices") await shot(page, "loading-mid");
  await ctx.unroute("**/api/**");                       // 지연 해제 후 잔여 요청이 정리되도록
  await page.waitForFunction(() => !document.querySelector('[data-testid="top-progress"]'), { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
  const done = await snap(page);
  chk(!done.bar, `${route} 로딩 완료 후 막대 사라짐`);
  chk(!/불러오는 중/.test(done.body), `${route} 완료 후 실제 내용 표시`, done.body);
  await ctx.close();
}
console.log(`\n결과: ${pass}/${pass + fail} 통과`);
await b.close();
