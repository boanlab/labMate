// 모바일 터치 타깃 정밀 측정 (WCAG 2.2 SC 2.5.8 = 24px, 모바일 HIG 권장 44px)
import { newBrowser, newPage, uiLogin, settle, save, ROUTES } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
const b = await newBrowser();
const { page } = await newPage(b, { w: 390, h: 844 });
await uiLogin(page, PERSONAS.find((p) => p.key === "prof").email);
const all = [];
for (const r of ROUTES) {
  await page.goto(BASE + r.p, { waitUntil: "domcontentloaded" });
  await settle(page, 600);
  if (await page.locator('[data-testid="no-access"]').count()) continue;
  const items = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("button, a[href], [role=button], input[type=checkbox], select")) {
      if (el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const txt = (el.textContent || "").trim().slice(0, 28);
      const cls = (typeof el.className === "string" ? el.className : "").split(/\s+/).slice(0, 2).join(".");
      out.push({ tag: el.tagName.toLowerCase(), cls, txt, w: Math.round(r.width), h: Math.round(r.height) });
    }
    return out;
  });
  items.forEach((i) => all.push({ route: r.p, ...i }));
}
const min = (i) => Math.min(i.w, i.h);
const under24 = all.filter((i) => min(i) < 24);
const under44 = all.filter((i) => min(i) < 44);
console.log(`390px 폭 · 대화형 요소 총 ${all.length}개`);
console.log(`  WCAG 2.2 최소(24px) 미달 : ${under24.length}개 (${(under24.length/all.length*100).toFixed(1)}%)`);
console.log(`  모바일 권장(44px) 미달   : ${under44.length}개 (${(under44.length/all.length*100).toFixed(1)}%)`);
// 클래스별 집계
const byCls = {};
for (const i of under44) { const k = `${i.tag}.${i.cls}`; byCls[k] ||= { n: 0, hs: new Set(), ex: i.txt }; byCls[k].n++; byCls[k].hs.add(i.h); }
console.log("\n=== 44px 미달 요소 유형별 ===");
Object.entries(byCls).sort((a, b2) => b2[1].n - a[1].n).slice(0, 16)
  .forEach(([k, v]) => console.log(`  ${String(v.n).padStart(4)}건  h=${[...v.hs].sort((x,y)=>x-y).join("/")}px  ${k}  예:"${v.ex}"`));
console.log("\n=== 24px 미달(WCAG 위반 소지) 유형별 ===");
const byCls2 = {};
for (const i of under24) { const k = `${i.tag}.${i.cls}`; byCls2[k] ||= { n: 0, hs: new Set(), ex: i.txt, routes: new Set() }; byCls2[k].n++; byCls2[k].hs.add(i.h); byCls2[k].routes.add(i.route); }
Object.entries(byCls2).sort((a, b2) => b2[1].n - a[1].n)
  .forEach(([k, v]) => console.log(`  ${String(v.n).padStart(4)}건  h=${[...v.hs].sort((x,y)=>x-y).join("/")}px  ${k}  예:"${v.ex}"  화면:${[...v.routes].slice(0,4).join(",")}`));
save("touch-targets.json", { total: all.length, under24, under44 });
await b.close();
