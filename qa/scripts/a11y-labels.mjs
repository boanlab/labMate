// 라벨-입력 연결 검증 + 중복 id 검사 (map 안에서 렌더될 때의 충돌 확인)
import { newBrowser, newPage, uiLogin, settle, save, ROUTES } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
const b = await newBrowser();
const { page } = await newPage(b, { w: 1440, h: 900 });
await uiLogin(page, PERSONAS.find((p) => p.key === "prof").email);
const OPENERS = ["+ 공지 작성", "+ 자산 등록", "+ 연구과제 추가", "+ 프로젝트 추가", "+ 집행 등록", "+ 예약", "+ 휴가 신청", "+ 일정 추가", "+ 회의록 작성", "+ 강좌 개설", "+ 실적 등록", "+ 랙 추가", "+ 구성원 추가", "+ 글쓰기", "+ 기안 작성", "+ 출퇴근 시간 정정 요청"];
const rows = [];
for (const r of ROUTES) {
  await page.goto(BASE + r.p, { waitUntil: "domcontentloaded" });
  await settle(page, 600);
  if (await page.locator('[data-testid="no-access"]').count()) continue;
  // 폼이 있으면 열어서 필드까지 검사
  for (const o of OPENERS) {
    const el = page.getByRole("button", { name: o, exact: true }).first();
    if (await el.count() && await el.isVisible()) { await el.click(); await settle(page, 700); break; }
  }
  const res = await page.evaluate(() => {
    const ctrls = [...document.querySelectorAll("input,select,textarea")].filter((e) => e.offsetParent !== null && e.type !== "hidden");
    const labeled = ctrls.filter((e) => {
      if (e.getAttribute("aria-label") || e.getAttribute("aria-labelledby")) return true;
      if (e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`)) return true;
      if (e.closest("label")) return true;
      return false;
    });
    // 중복 id
    const ids = {};
    for (const e of document.querySelectorAll("[id]")) { ids[e.id] = (ids[e.id] || 0) + 1; }
    const dup = Object.entries(ids).filter(([, n]) => n > 1).map(([k, n]) => `${k}×${n}`);
    // 연결 안 된 컨트롤 목록
    const orphan = ctrls.filter((e) => !labeled.includes(e))
      .map((e) => `${e.tagName.toLowerCase()}:${e.type || ""}${e.getAttribute("data-testid") ? "#" + e.getAttribute("data-testid") : ""}${e.placeholder ? "(" + e.placeholder.slice(0, 20) + ")" : ""}`);
    return { total: ctrls.length, linked: labeled.length, dup, orphan: [...new Set(orphan)].slice(0, 10) };
  });
  rows.push({ route: r.p, ...res });
  const pct = res.total ? Math.round(res.linked / res.total * 100) : 100;
  console.log(`${res.dup.length ? "⚠" : " "} ${r.p.padEnd(14)} 연결 ${res.linked}/${res.total} (${pct}%)${res.dup.length ? "  중복id: " + res.dup.join(", ") : ""}`);
  if (res.orphan.length) console.log(`     미연결: ${res.orphan.join(" | ")}`);
}
const T = rows.reduce((a, r) => ({ t: a.t + r.total, l: a.l + r.linked, d: a.d + r.dup.length }), { t: 0, l: 0, d: 0 });
console.log(`\n총계: 연결 ${T.l}/${T.t} (${Math.round(T.l / T.t * 100)}%) · 중복 id ${T.d}건`);
save("a11y-labels.json", rows);
await b.close();
