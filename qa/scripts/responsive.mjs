// 뷰포트 스윕 — 13개 폭 × 전 화면에서 가로 넘침·잘림·과소 터치타깃 탐지
import { newBrowser, newPage, uiLogin, settle, audit, save, shot, ROUTES } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";

const SIZES = [
  { w: 320, h: 640, n: "320" },  { w: 360, h: 740, n: "360" },
  { w: 390, h: 844, n: "390" },  { w: 414, h: 896, n: "414" },
  { w: 480, h: 800, n: "480" },  { w: 600, h: 900, n: "600" },
  { w: 768, h: 1024, n: "768" }, { w: 860, h: 800, n: "860" },
  { w: 1024, h: 700, n: "1024" },{ w: 1280, h: 720, n: "1280" },
  { w: 1440, h: 900, n: "1440" },{ w: 1920, h: 1080, n: "1920" },
  { w: 2560, h: 1440, n: "2560" },
];
const PKEY = process.env.PK || "prof";
const persona = PERSONAS.find((p) => p.key === PKEY);
const b = await newBrowser();
const results = [];
for (const s of SIZES) {
  const { ctx, page, errors } = await newPage(b, { w: s.w, h: s.h });
  await uiLogin(page, persona.email);
  for (const r of ROUTES) {
    await page.goto(BASE + r.p, { waitUntil: "domcontentloaded" });
    await settle(page, 650);
    if (await page.locator('[data-testid="no-access"]').count()) continue;
    const a = await audit(page);
    // 실패로 세는 것은 실제 결함만 — 터치 타깃 24px 기준은 touch-targets.mjs 가 본다.
    const hasIssue = a.hOverflow || a.offenders.length || a.clipped.length;
    if (hasIssue) {
      results.push({ w: s.w, h: s.h, route: r.p, label: r.label, ...a });
      process.stdout.write("✗");
      if (a.hOverflow) await shot(page, `resp-${s.n}-${r.p.replace(/\//g, "_")}`);
    } else process.stdout.write(".");
  }
  console.log(`  ${s.n}px 완료`);
  await ctx.close();
}
save(`responsive-${PKEY}.json`, results);
// 집계
const byRoute = {};
for (const r of results) {
  const k = r.route;
  byRoute[k] ||= { hOverflow: [], offenders: 0, clipped: 0, widths: new Set() };
  if (r.hOverflow) byRoute[k].hOverflow.push(`${r.w}px(+${r.hOverflow.excess})`);
  byRoute[k].offenders += r.offenders.length;
  byRoute[k].clipped += r.clipped.length;
  byRoute[k].widths.add(r.w);
}
for (const [k, v] of Object.entries(byRoute)) {
  const why = [
    v.hOverflow.length ? `가로 스크롤 ${v.hOverflow.join(", ")}` : "",
    v.offenders ? `뷰포트 밖 ${v.offenders}건` : "",
    v.clipped ? `텍스트 잘림 ${v.clipped}건` : "",
  ].filter(Boolean).join(" · ");
  console.log(`❌ ${k} 레이아웃 결함  — ${why}`);
}
const total = SIZES.length * ROUTES.length;
console.log(`\n결과: ${total - results.length}/${total} 통과  (${SIZES.length}개 폭 × ${ROUTES.length}개 화면, ${persona.label})`);
await b.close();
