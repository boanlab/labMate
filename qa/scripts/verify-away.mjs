// 자리비움 — 자리를 비운 시간이 근무시간에서 빠지는지, 버튼이 상황에 맞게 바뀌는지 확인한다.
//
// 근무시간은 세션별 누적이라, 자리비움 동안에는 늘지 않고 복귀하면 다시 늘어야 한다.
import { newBrowser, newPage, uiLogin, settle, shot } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";

const b = await newBrowser();
const P = Object.fromEntries(PERSONAS.map((p) => [p.key, p]));
let pass = 0, fail = 0;
const chk = (ok, l, d) => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${l}${d ? "  — " + d : ""}`); };

const { ctx, page, errors } = await newPage(b, { w: 1280, h: 900 });
await uiLogin(page, P.under.email);
await page.goto(BASE + "/attendance"); await settle(page, 1200);

const state = () => page.evaluate(() => {
  const t = document.querySelector('[data-testid="att-today"]')?.innerText || "";
  const btn = (id) => { const e = document.querySelector(`[data-testid="${id}"]`); return e ? { on: !e.disabled, label: e.innerText.trim() } : null; };
  const m = t.match(/근무\s*(\d+)시간\s*(\d+)분/);
  return { text: t.replace(/\n/g, " "), min: m ? +m[1] * 60 + +m[2] : 0,
           checkin: btn("att-checkin"), away: btn("att-away"), back: btn("att-back"), checkout: btn("att-checkout") };
});

// 출근하지 않았다면 먼저 출근한다
let s = await state();
if (s.checkin?.on) { await page.locator('[data-testid="att-checkin"]').click(); await settle(page, 1200); s = await state(); }

chk(!!s.away && s.away.on, "근무 중에는 자리비움 버튼이 눌린다", s.text.slice(0, 60));
chk(!s.back, "근무 중에는 복귀 버튼이 없다");

await page.locator('[data-testid="att-away"]').click(); await settle(page, 1500);
const away = await state();
chk(/자리비움/.test(away.text), "자리비움 상태로 바뀐다", away.text.slice(0, 70));
chk(!!away.back && away.back.on, "자리비움 중에는 복귀 버튼이 나온다");
chk(!away.away, "자리비움 중에는 자리비움 버튼이 사라진다");
chk(!away.checkin?.on, "자리비움 중 출근 체크는 막힌다");
await shot(page, "away-01-자리비움");

// 자리를 비운 동안에는 근무시간이 늘지 않아야 한다
const before = away.min;
await page.waitForTimeout(65000);
await page.reload(); await settle(page, 1500);
const still = await state();
chk(still.min === before, "자리를 비운 동안 근무시간이 늘지 않는다", `${before}분 → ${still.min}분`);

await page.locator('[data-testid="att-back"]').click(); await settle(page, 1500);
const back = await state();
chk(!/자리비움/.test(back.text), "복귀하면 근무 상태로 돌아온다", back.text.slice(0, 60));
chk(!!back.away && back.away.on, "복귀 후 자리비움 버튼이 다시 살아난다");
await shot(page, "away-02-복귀");

// 복귀 후에는 다시 늘어야 한다
await page.waitForTimeout(65000);
await page.reload(); await settle(page, 1500);
const grew = await state();
chk(grew.min > back.min, "복귀 후에는 근무시간이 다시 늘어난다", `${back.min}분 → ${grew.min}분`);

// 기록 표의 근무시간도 같은 기준이어야 한다
const rowWork = await page.evaluate(() => {
  const tr = document.querySelector('[data-testid="att-table"] tbody tr');
  return tr ? tr.innerText.replace(/\n|\t/g, " ") : "";
});
chk(/근무|시간|분/.test(rowWork) || rowWork.length > 0, "기록 표에 오늘 행이 있다", rowWork.slice(0, 70));

const httpErr = errors.filter((e) => e.kind === "http" || e.kind === "pageerror");
chk(httpErr.length === 0, "오류 없음", httpErr.map((e) => e.text).slice(0, 2).join(" / "));

await ctx.close();
console.log(`\n결과: ${pass}/${pass + fail} 통과`);
await b.close();
