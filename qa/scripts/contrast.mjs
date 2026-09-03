// 정식 WCAG 2.x 대비비 계산 (감마 보정 상대휘도)
import { newBrowser, newPage, uiLogin, settle, save, ROUTES } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
const FN = `() => {
  const srgb = (v) => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
  const relLum = (c) => { const m = c.match(/[\\d.]+/g); if (!m) return null; const [r,g,b] = m.slice(0,3).map(Number); return 0.2126*srgb(r)+0.7152*srgb(g)+0.0722*srgb(b); };
  const alpha = (c) => { const m = c.match(/[\\d.]+/g); return m && m.length>3 ? Number(m[3]) : 1; };
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.offsetParent === null) continue;
    // 텍스트를 직접 가진 노드만
    const own = [...el.childNodes].filter(n => n.nodeType===3 && n.textContent.trim()).map(n=>n.textContent.trim()).join(" ");
    if (!own) continue;
    const s = getComputedStyle(el);
    const fg = relLum(s.color); if (fg === null) continue;
    let bg = null;
    for (let p = el; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      // gradient 배경이면 첫 색상 정지점을 실제 배경으로 사용
      const bi = cs.backgroundImage;
      if (bi && bi !== 'none' && /gradient/.test(bi)) {
        const stops = bi.match(/rgba?\([^)]*\)/g);
        if (stops && stops.length) { bg = relLum(stops[0]); break; }
      }
      const pb = cs.backgroundColor;
      if (pb && alpha(pb) > 0.5) { bg = relLum(pb); break; }
    }
    if (bg === null) continue;
    const ratio = (Math.max(fg,bg)+0.05)/(Math.min(fg,bg)+0.05);
    const fs = parseFloat(s.fontSize), fw = parseInt(s.fontWeight) || 400;
    const large = fs >= 24 || (fs >= 18.66 && fw >= 700);
    const need = large ? 3 : 4.5;
    if (ratio < need) out.push({ txt: own.slice(0,36), cls: (typeof el.className==="string"?el.className:"").slice(0,34), color: s.color, fs, ratio: +ratio.toFixed(2), need });
  }
  const seen = new Set();
  return out.filter(x => { const k = x.cls+"|"+x.color; if (seen.has(k)) return false; seen.add(k); return true; });
}`;
const b = await newBrowser();
const prof = PERSONAS.find((p) => p.key === "prof");
for (const mode of ["light", "dark"]) {
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, prof.email);
  if (mode === "dark") { await page.locator('[data-testid="theme-toggle"]').click(); await settle(page, 500); }
  const agg = new Map();
  for (const r of ROUTES) {
    await page.goto(BASE + r.p, { waitUntil: "domcontentloaded" }); await settle(page, 500);
    if (await page.locator('[data-testid="no-access"]').count()) continue;
    const bad = await page.evaluate(`(${FN})()`);
    for (const x of bad) { const k = x.cls + "|" + x.color; if (!agg.has(k)) agg.set(k, { ...x, routes: new Set() }); agg.get(k).routes.add(r.p); }
  }
  console.log(`\n=== ${mode === "dark" ? "다크" : "라이트"} 모드 — WCAG AA 미달 (정식 계산) ===`);
  const list = [...agg.values()].sort((a, c) => a.ratio - c.ratio);
  if (!list.length) console.log("  없음");
  list.slice(0, 18).forEach((x) => console.log(`  ${String(x.ratio).padStart(5)}:1 (필요 ${x.need}) ${x.fs}px  "${x.txt}"  .${x.cls}  ${x.color}  [${[...x.routes].length}개 화면]`));
  console.log(`  총 고유 위반 유형: ${list.length}`);
  save(`contrast-${mode}.json`, list.map((x) => ({ ...x, routes: [...x.routes] })));
  await ctx.close();
}
await b.close();
