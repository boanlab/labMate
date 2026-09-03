// 표 도구 — 머리글 클릭 정렬과 컬럼 폭 조절
import { newBrowser, newPage, uiLogin, settle, shot } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
const b = await newBrowser();
let pass = 0, fail = 0;
const chk = (ok, l, d) => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${l}${d ? "  — " + d : ""}`); };
const P = Object.fromEntries(PERSONAS.map((p) => [p.key, p]));

const TABLES = [
  { who: "prof", route: "/notices", key: "notices", table: "notice-table", col: "title", cell: 1 },
  { who: "phd", route: "/board", key: "board", table: "board-table", col: "title", cell: 2 },
  { who: "prof", route: "/meetings", key: "meetings", table: "meeting-table", col: "title", cell: 3 },
  { who: "master", route: "/leave", key: "leave", table: "leave-table", col: "period", cell: 2 },
  { who: "master", route: "/booking", key: "booking", table: "booking-table", col: "resource", cell: 1 },
  { who: "deleg", route: "/expenses", key: "expenses", table: "exp-table", col: "title", cell: 4 },
  { who: "prof", route: "/members", key: "members", table: "member-table", col: "name", cell: 1 },
  { who: "phd", route: "/tasks", key: "mytasks", table: "mytasks-table", col: "title", cell: 2 },
];
const sessions = new Map();
for (const t of TABLES) {
  if (!sessions.has(t.who)) {
    const s = await newPage(b, { w: 1440, h: 900 });
    await uiLogin(s.page, P[t.who].email);
    // 폭·정렬 모두 계정에 저장되므로 서버 쪽을 비우고 시작한다
    await s.page.evaluate(async () => {
      const H = { "Content-Type": "application/json", Authorization: "Bearer " + localStorage.getItem("lm_access") };
      const cur = await (await fetch("/api/members/prefs", { headers: H })).json();
      for (const k of Object.keys(cur).filter((x) => x.startsWith("colw.") || x.startsWith("sort."))) {
        await fetch(`/api/members/prefs/${encodeURIComponent(k)}`, { method: "PUT", headers: H, body: JSON.stringify({ value: null }) });
      }
    });
    sessions.set(t.who, s);
  }
  const { page } = sessions.get(t.who);
  await page.goto(BASE + t.route, { waitUntil: "domcontentloaded" }); await settle(page, 1300);
  const th = page.locator(`th[data-sort-key="${t.col}"]`);
  if (!await th.count()) { chk(false, `${t.route} 정렬 머리글(${t.col}) 없음`); continue; }
  const first = () => page.evaluate((n) => document.querySelector(`table tbody tr td:nth-child(${n})`)?.textContent.trim().slice(0, 24) || "", t.cell);
  await th.click(); await settle(page, 500);
  const asc = await first();
  const markA = await page.evaluate((c) => document.querySelector(`th[data-sort-key="${c}"]`)?.textContent.trim().slice(-1), t.col);
  await th.click(); await settle(page, 500);
  const desc = await first();
  const markD = await page.evaluate((c) => document.querySelector(`th[data-sort-key="${c}"]`)?.textContent.trim().slice(-1), t.col);
  chk(markA === "▲" && markD === "▼", `${t.route} 정렬 방향 전환 표시`, `${markA}/${markD}`);
  chk(asc !== desc || asc === "", `${t.route} 정렬로 순서 바뀜`, `"${asc}" ↔ "${desc}"`);
  const aria = await page.getAttribute(`th[data-sort-key="${t.col}"]`, "aria-sort");
  chk(aria === "descending", `${t.route} aria-sort 반영`, String(aria));

  // 폭 조절
  const bx = await th.boundingBox();
  const delta = Math.min(90, Math.max(0, Math.round(bx.width) - 70));   // 최소 폭(56) 아래로 내려가지 않게
  await page.mouse.move(bx.x + bx.width - 3, bx.y + bx.height / 2);
  await page.mouse.down();
  await page.mouse.move(bx.x + bx.width - 3 - delta, bx.y + bx.height / 2, { steps: 8 });
  await page.mouse.up(); await settle(page, 500);
  const after = Math.round((await th.boundingBox()).width);
  chk(Math.abs(after - (Math.round(bx.width) - delta)) <= 4, `${t.route} 끈 만큼 폭 반영`, `${Math.round(bx.width)} → ${after} (−${delta})`);
  const saved = await page.evaluate(async (k) => {
    const r = await fetch("/api/members/prefs", { headers: { Authorization: "Bearer " + localStorage.getItem("lm_access") } });
    return (await r.json())[`colw.${k}`];
  }, t.key);
  chk(!!saved, `${t.route} 폭 저장(계정)`, JSON.stringify(saved || null).slice(0, 50));
  await page.reload({ waitUntil: "domcontentloaded" }); await settle(page, 1500);
  const kept = Math.round((await page.locator(`th[data-sort-key="${t.col}"]`).boundingBox()).width);
  chk(Math.abs(kept - after) <= 3, `${t.route} 새로고침 후 폭 유지`, `${after} → ${kept}`);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  chk(ov <= 1, `${t.route} 페이지 가로 오버플로 없음`, `${ov}px`);
}
// 이 검증이 계정에 남긴 폭·정렬을 되돌린다 — 다음 검증이 기본 화면에서 시작하도록
for (const s of sessions.values()) {
  await s.page.evaluate(async () => {
    const H = { "Content-Type": "application/json", Authorization: "Bearer " + localStorage.getItem("lm_access") };
    const cur = await (await fetch("/api/members/prefs", { headers: H })).json();
    for (const k of Object.keys(cur).filter((x) => x.startsWith("colw.") || x.startsWith("sort."))) {
      await fetch(`/api/members/prefs/${encodeURIComponent(k)}`, { method: "PUT", headers: H, body: JSON.stringify({ value: null }) });
    }
  }).catch(() => { /* 세션이 이미 닫혔으면 무시 */ });
  await s.ctx.close();
}
console.log(`\n결과: ${pass}/${pass + fail} 통과`);
await b.close();
