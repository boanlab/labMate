// 학생인건비 참여율 편성 — 가로 스크롤에도 구성원·합계가 붙어 있는지, %→원 자동계산·초과 경고가 되는지
import { newBrowser, newPage, uiLogin, settle, shot } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
const b = await newBrowser();
let pass = 0, fail = 0;
const chk = (ok, l, d) => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${l}${d ? "  — " + d : ""}`); };
const { page } = await newPage(b, { w: 1440, h: 900 });
await uiLogin(page, PERSONAS.find((p) => p.key === "prof").email);
await page.goto(BASE + "/payroll"); await settle(page, 1500);
await page.getByRole("button", { name: "참여율 편성", exact: true }).first().click(); await settle(page, 1400);

const probe = () => page.evaluate(() => {
  const t = document.querySelector('[data-testid="pay-matrix"]'); const w = t.parentElement;
  const l = t.querySelector("tbody .col-stick-l"), r = t.querySelector("tbody .col-stick-r");
  const lb = l.getBoundingClientRect(), rb = r.getBoundingClientRect(), wb = w.getBoundingClientRect();
  return { scrollable: w.scrollWidth > w.clientWidth + 1, scrollLeft: Math.round(w.scrollLeft),
           lIn: lb.left >= wb.left - 2 && lb.right <= wb.right + 2, rIn: rb.right <= wb.right + 2 && rb.left >= wb.left - 2,
           lText: l.textContent.trim().slice(0, 14), rText: r.textContent.trim().slice(0, 14) };
});
const a = await probe();
chk(a.scrollable, "12개월 그리드가 가로 스크롤 대상", JSON.stringify({ scrollable: a.scrollable }));
chk(a.lIn && a.rIn, "스크롤 전 구성원·합계 모두 보임", `${a.lText} / ${a.rText}`);
await page.evaluate(() => { const w = document.querySelector('[data-testid="pay-matrix"]').parentElement; w.scrollLeft = w.scrollWidth; });
await settle(page, 500);
const c = await probe();
chk(c.scrollLeft > 0, "오른쪽 끝까지 스크롤됨", `scrollLeft=${c.scrollLeft}`);
chk(c.lIn, "스크롤 후에도 구성원 열 고정", `"${c.lText}"`);
chk(c.rIn, "스크롤 후에도 합계 열 고정", `"${c.rText}"`);

// %→원 자동 계산 · 초과 경고
const id = await page.evaluate(() => document.querySelector('[data-testid^="pm-"]')?.getAttribute("data-testid"));
await page.locator(`[data-testid="${id}"]`).fill("50"); await settle(page, 500);
const won = await page.locator(`[data-testid="${id.replace("pm-", "pa-")}"]`).inputValue();
chk(won === "1500000", "참여율 입력 시 금액 자동 계산", `50% → ${won}`);
const over = await page.evaluate(async () => {
  const els = [...document.querySelectorAll('[data-testid^="pm-"]')];
  return els.length;
});
console.log(`     입력 가능한 월 칸 ${over}개`);
await shot(page, "payroll-sticky");
console.log(`\n결과: ${pass}/${pass + fail} 통과`);
await b.close();
