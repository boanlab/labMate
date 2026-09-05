// 업무일지 — 하루 기록이 남고, 그 기록으로 보고서 초안이 만들어지는가.
//
// 이 사슬(적기 → 완료 체크 → 기간별 보고서)이 끊기면 "지난주에 뭐 했더라"를 다시
// 기억으로 되짚어야 한다. 사슬 끝까지 실제로 이어지는지 본다.
// 남의 일지가 보이지 않는 것도 함께 확인한다 — 본인만 보는 기록이라는 전제가 깨지면
// 사람들이 솔직하게 적지 않는다.
import { newBrowser, newPage, uiLogin, settle } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";

const b = await newBrowser();
const P = Object.fromEntries(PERSONAS.map((p) => [p.key, p]));
let pass = 0, fail = 0;
const T = (ok, l, d) => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${l}${d ? "  — " + d : ""}`); };

const MINE = `회귀 검증 항목 ${Date.now().toString().slice(-6)}`;
const rows = (page) => page.locator('[data-testid^="daily-row-"]');

// ── 박사과정: 적고 · 완료하고 · 보고서까지 ──
const { page } = await newPage(b, { w: 1440, h: 1000 });
await uiLogin(page, P.phd.email);
await page.goto(BASE + "/daily"); await settle(page, 1200);

const before = await rows(page).count();
await page.locator('[data-testid="daily-add-title"]').fill(MINE);
await page.locator('[data-testid="daily-add"]').click(); await settle(page, 1200);
T(await rows(page).count() === before + 1, "할 일을 적으면 목록에 남는다", MINE);

const mineRow = page.locator('[data-testid^="daily-row-"]').filter({ has: page.locator(`input[value="${MINE}"]`) });
const box = mineRow.locator('input[type="checkbox"]').first();
await box.check(); await settle(page, 1200);
await page.reload(); await settle(page, 1500);
const stillChecked = await page.locator('[data-testid^="daily-row-"]')
  .filter({ has: page.locator(`input[value="${MINE}"]`) }).locator('input[type="checkbox"]').first().isChecked();
T(stillChecked, "완료 체크가 새로고침 뒤에도 남는다");

// 보고서 — 오늘이 든 주를 기준으로 만든다(기본값이 이번 주)
await page.locator('[data-testid="daily-report"]').click(); await settle(page, 1200);
const draft = await page.locator('[data-testid="daily-report-out"]').inputValue().catch(() => "");
T(draft.includes(MINE), "보고서 초안에 오늘 적은 일이 들어간다", draft.split("\n")[0] || "(비어 있음)");
T(/합계: \d+건/.test(draft), "보고서에 합계가 붙는다", (draft.match(/합계:.*/) || [""])[0]);

// 월간으로 바꿔도 같은 기록이 잡힌다(오늘은 이번 달에도 들어 있다)
await page.locator('[data-testid="daily-span-month"]').click(); await settle(page, 600);
await page.locator('[data-testid="daily-report"]').click(); await settle(page, 1200);
const monthly = await page.locator('[data-testid="daily-report-out"]').inputValue().catch(() => "");
T(monthly.includes("월간") && monthly.includes(MINE), "월간 보고서도 같은 기록으로 만들어진다");

// ── 다른 사람에게는 보이지 않는다 ──
const { page: other } = await newPage(b, { w: 1440, h: 1000 });
await uiLogin(other, P.master.email);
await other.goto(BASE + "/daily"); await settle(other, 1200);
const leaked = await other.locator(`input[value="${MINE}"]`).count();
T(leaked === 0, "남의 일지는 보이지 않는다", leaked ? `${leaked}건 노출` : "");

// ── 뒷정리: 만든 항목을 지운다 ──
const del = mineRow.locator("button", { hasText: "✕" }).first();
if (await del.count()) {
  await del.click(); await settle(page, 500);
  const ok = page.getByRole("button", { name: /확인|삭제/ }).last();
  if (await ok.count()) { await ok.click(); await settle(page, 1200); }
}
T(await page.locator(`input[value="${MINE}"]`).count() === 0, "지우면 목록에서 빠진다");

console.log(`\n합계 ${pass + fail}건 · 통과 ${pass} · 실패 ${fail}`);
await b.close();
process.exit(fail ? 1 : 0);
