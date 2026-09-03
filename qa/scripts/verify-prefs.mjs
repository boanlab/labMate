// 화면 설정(컬럼 폭·정렬·테마·사이드바)이 브라우저가 아니라 계정에 저장되는지
import { newBrowser, newPage, uiLogin, settle } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
const b = await newBrowser();
let pass = 0, fail = 0;
const chk = (ok, l, d) => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${l}${d ? "  — " + d : ""}`); };
const P = Object.fromEntries(PERSONAS.map((p) => [p.key, p]));
const prefs = (page) => page.evaluate(async () => {
  const r = await fetch("/api/members/prefs", { headers: { Authorization: "Bearer " + localStorage.getItem("lm_access") } });
  return await r.json();
});
const resetPrefs = (page) => page.evaluate(async () => {
  const H = { "Content-Type": "application/json", Authorization: "Bearer " + localStorage.getItem("lm_access") };
  const cur = await (await fetch("/api/members/prefs", { headers: H })).json();
  for (const k of Object.keys(cur)) {
    await fetch(`/api/members/prefs/${encodeURIComponent(k)}`, { method: "PUT", headers: H, body: JSON.stringify({ value: null }) });
  }
});
const widthOf = (page, col) => page.locator(`th[data-sort-key="${col}"]`).boundingBox().then((b) => Math.round(b.width));

// 1) 브라우저 A 에서 폭을 바꾼다
let changed = 0;
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.phd.email);
  await resetPrefs(page);
  await page.goto(BASE + "/board"); await settle(page, 1500);
  const before = await widthOf(page, "title");
  const th = page.locator('th[data-sort-key="title"]');
  const bx = await th.boundingBox();
  await page.mouse.move(bx.x + bx.width - 3, bx.y + bx.height / 2);
  await page.mouse.down(); await page.mouse.move(bx.x + bx.width - 3 - 120, bx.y + bx.height / 2, { steps: 10 }); await page.mouse.up();
  await settle(page, 1200);        // 저장은 잠시 모았다 보낸다
  changed = await widthOf(page, "title");
  chk(changed === before - 120, "폭 조절 반영", `${before} → ${changed}`);
  const p = await prefs(page);
  chk(!!p["colw.board"], "서버(계정)에 저장됨", JSON.stringify(p["colw.board"] || {}).slice(0, 60));
  const local = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes("colw")));
  chk(local.length === 0, "브라우저 저장소에는 남기지 않음", JSON.stringify(local));
  await ctx.close();
}
// 2) 다른 브라우저(=다른 PC)에서 같은 계정으로 접속 — 폭이 따라온다
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.phd.email);
  await page.goto(BASE + "/board"); await settle(page, 1800);
  const w = await widthOf(page, "title");
  chk(w === changed, "다른 브라우저에서도 같은 폭", `${changed} → ${w}`);
  await ctx.close();
}
// 3) 다른 계정은 영향받지 않는다
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.master.email);
  await resetPrefs(page);
  await page.goto(BASE + "/board"); await settle(page, 1600);
  const w = await widthOf(page, "title");
  chk(w !== changed, "다른 계정은 자기 기본 폭 사용", `${w} (다른 계정: ${changed})`);
  await ctx.close();
}
// 4) 초기화하면 서버에서도 지워진다
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.phd.email);
  await page.goto(BASE + "/board"); await settle(page, 1800);
  const th = page.locator('th[data-sort-key="title"]');
  const bx = await th.boundingBox();
  await page.mouse.dblclick(bx.x + bx.width - 3, bx.y + bx.height / 2);
  await settle(page, 1400);
  const p = await prefs(page);
  chk(!p["colw.board"], "초기화하면 계정 설정도 삭제", JSON.stringify(p).slice(0, 60));
  await ctx.close();
}

// 5) 테마·사이드바·정렬도 계정을 따라간다
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.under.email);
  await resetPrefs(page);
  await page.goto(BASE + "/board"); await settle(page, 1500);
  // 다크모드 켜기
  await page.locator('[data-testid="theme-toggle"]').click(); await settle(page, 700);
  chk(await page.evaluate(() => document.body.classList.contains("dark")), "다크모드 적용");
  // 사이드바 접기
  await page.locator('[data-testid="hamburger"]').click(); await settle(page, 600);
  const collapsed = await page.evaluate(() => document.querySelector(".appshell")?.className.includes("sidebar-collapsed"));
  chk(!!collapsed, "사이드바 접힘");
  // 정렬 바꾸기
  await page.locator('th[data-sort-key="title"]').click(); await settle(page, 900);
  const p1 = await prefs(page);
  chk(p1["theme_dark"] === true, "테마가 계정에 저장", JSON.stringify(p1["theme_dark"]));
  chk(p1["sidebar_collapsed"] === true, "사이드바 상태가 계정에 저장", JSON.stringify(p1["sidebar_collapsed"]));
  chk(!!p1["sort.board"], "정렬 기준이 계정에 저장", JSON.stringify(p1["sort.board"]));
  await ctx.close();
}
// 6) 다른 브라우저에서 같은 계정 — 그대로 따라온다
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.under.email);
  await page.goto(BASE + "/board"); await settle(page, 2000);
  chk(await page.evaluate(() => document.body.classList.contains("dark")), "다른 브라우저에서도 다크모드");
  chk(await page.evaluate(() => !!document.querySelector(".appshell")?.className.includes("sidebar-collapsed")), "다른 브라우저에서도 사이드바 접힘");
  const mark = await page.evaluate(() => document.querySelector('th[data-sort-key="title"]')?.textContent.trim().slice(-1));
  chk(mark === "▲" || mark === "▼", "다른 브라우저에서도 정렬 기준 유지", String(mark));
  await ctx.close();
}
// 7) 로그아웃 후 다른 계정 — 앞사람 설정이 남지 않는다
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.under.email); await settle(page, 1500);
  await page.locator('[data-testid="user-menu-btn"]').click(); await settle(page, 500);
  const out = page.getByRole("button", { name: /로그아웃/ }).first();
  if (await out.count()) { await out.click(); await settle(page, 1200); }
  await uiLogin(page, P.master.email); await settle(page, 2000);
  chk(!(await page.evaluate(() => document.body.classList.contains("dark"))), "다른 계정으로 바꾸면 앞사람 테마가 남지 않음");
  await ctx.close();
}
// 뒷정리 — 이 검증이 계정에 남긴 설정을 지운다(다음 검증이 기본 화면에서 시작하도록)
for (const who of ["under", "phd", "master"]) {
  const { ctx, page } = await newPage(b, { w: 1024, h: 768 });
  await uiLogin(page, P[who].email);
  await resetPrefs(page);
  await ctx.close();
}
console.log(`\n결과: ${pass}/${pass + fail} 통과`);
await b.close();
