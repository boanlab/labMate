import { newBrowser, newPage, uiLogin, settle, audit, save, shot, ROUTES } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";

const W = Number(process.env.W || 1280), H = Number(process.env.H || 800);
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
const b = await newBrowser();
const report = [];

for (const p of PERSONAS) {
  if (only && !only.includes(p.key)) continue;
  const { ctx, page, errors } = await newPage(b, { w: W, h: H });
  await uiLogin(page, p.email);
  const visibleMenus = await page.$$eval("aside a", (as) => as.map((a) => a.getAttribute("href")));
  for (const r of ROUTES) {
    errors.length = 0;
    await page.goto(BASE + r.p, { waitUntil: "domcontentloaded" });
    await settle(page, 900);
    const denied = await page.$('[data-testid="no-access"]') !== null;
    const a = await audit(page);
    // 화면에 보이는 주요 인터랙션 요소 수집
    const ui = await page.evaluate(() => {
      const t = (e) => (e.textContent || "").trim().slice(0, 30);
      const seen = (e) => e.offsetParent !== null;
      return {
        h1: (document.querySelector("h1") || {}).textContent?.trim() || "",
        buttons: [...document.querySelectorAll("button")].filter(seen).map(t).filter(Boolean).slice(0, 30),
        tabs: [...document.querySelectorAll(".tabs button, [role=tab]")].filter(seen).map(t).slice(0, 20),
        tableCols: [...document.querySelectorAll("table thead th")].map(t).slice(0, 20),
        rows: document.querySelectorAll("table tbody tr").length,
        emptyMsg: [...document.querySelectorAll(".empty, .muted")].filter(seen).map(t).filter(Boolean).slice(0, 5),
        inputs: [...document.querySelectorAll("input,select,textarea")].filter(seen).length,
      };
    });
    report.push({ persona: p.key, role: p.role, route: r.p, label: r.label, denied, inMenu: visibleMenus.includes(r.p), ui, audit: a, errors: [...errors] });
    process.stdout.write(`${p.key}${denied ? "✗" : "·"}`);
  }
  await ctx.close();
  console.log(` ${p.key} 완료`);
}
await b.close();
save(`crawl-${W}x${H}.json`, report);
// 요약
const errs = report.filter((r) => r.errors.length);
const lay = report.filter((r) => r.audit.hOverflow || r.audit.offenders.length || r.audit.clipped.length);
console.log(`\n총 ${report.length}건 / 오류있음 ${errs.length} / 레이아웃결함 ${lay.length}`);
