// 연구비 집행 — 기본(결재 끔)과 결재 켬 두 방식 모두 검증하고, 검증 후 기본값으로 되돌린다
import { newBrowser, newPage, uiLogin, settle, shot } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
import { clickBtn } from "./helpers.mjs";
import fs from "node:fs";
const b = await newBrowser();
let pass = 0, fail = 0;
const chk = (ok, l, d) => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${l}${d ? "\n     " + d : ""}`); };
const P = Object.fromEntries(PERSONAS.map((p) => [p.key, p]));
const ADMIN = { email: process.env.LM_ADMIN_EMAIL, pw: process.env.LM_ADMIN_PW };

const setApproval = async (on) => {
  const s = await newPage(b, { w: 1280, h: 800 });
  await uiLogin(s.page, ADMIN.email, ADMIN.pw);
  const st = await s.page.evaluate(async (v) => {
    const r = await fetch("/api/funds/config/expense_approval", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + localStorage.getItem("lm_access") },
      body: JSON.stringify({ value: v }),
    });
    return r.status;
  }, on);
  await s.ctx.close();
  return st;
};
const budgetSpent = (page) => page.evaluate(async () => {
  const r = await fetch("/api/funds/budgets", { headers: { Authorization: "Bearer " + localStorage.getItem("lm_access") } });
  return (await r.json()).filter((b) => b.category === "재료비").reduce((a, b) => a + b.spent, 0);
});
const addExpense = async (page, title, amount) => {
  await page.locator('[data-testid="exp-add-open"]').click(); await settle(page, 800);
  await page.locator('[data-testid="e-date"]').fill("2026-09-03");
  const cat = page.locator('[data-testid="e-category"]');
  await cat.selectOption({ label: (await cat.locator("option").allTextContents()).find((o) => /재료비/.test(o)) });
  await page.locator('[data-testid="e-title"]').fill(title);
  await page.locator('[data-testid="e-amount"]').fill(String(amount));
  await clickBtn(page, "등록"); await settle(page, 1600);
};

// ── A) 기본값(결재 끔) — 등록 즉시 확정 + 예산 즉시 차감
{
  const TAG = "EX" + Date.now().toString().slice(-5);
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.deleg.email);
  await page.goto(BASE + "/expenses"); await settle(page, 1500);
  chk(await page.locator("table thead th", { hasText: "상태" }).count() === 0, "기본(결재 끔): 상태 컬럼 없음");
  const before = await budgetSpent(page);
  await addExpense(page, `${TAG} 기본 집행`, 300000);
  const after = await budgetSpent(page);
  chk(after === before + 300000, "기본(결재 끔): 등록 즉시 예산 차감", `${before} → ${after}`);
  const noSubmit = await page.locator('[data-testid^="e-submit-"]').count();
  chk(noSubmit === 0, "기본(결재 끔): 상신 버튼 없음");
  await shot(page, "ea-default-off");
  await ctx.close();
}

// ── B) 결재 켬 — 작성중 → 상신 → 승인 시 차감
chk(await setApproval(true) === 200, "관리자가 집행 결재를 켤 수 있음");
{
  const TAG = "EA" + Date.now().toString().slice(-5);
  const { ctx, page, errors } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.deleg.email);
  await page.goto(BASE + "/expenses"); await settle(page, 1600);
  const spent0 = await budgetSpent(page);
  await addExpense(page, `${TAG} 결재 집행`, 500000);
  const row = () => page.locator("table tbody tr", { hasText: TAG }).first();
  const status = async () => (await row().locator('[data-testid^="e-status-"]').innerText().catch(() => "(없음)")).trim();
  chk(await status() === "작성중", "결재 켬: 등록 직후 작성중", await status());
  chk(await budgetSpent(page) === spent0, "결재 켬: 작성중은 예산 미차감");

  await row().locator('[data-testid^="e-submit-"]').click(); await settle(page, 1100);
  chk(/증빙/.test(await page.evaluate(() => document.querySelector(".form-err")?.innerText || "")), "결재 켬: 증빙 없이 상신 차단");

  fs.writeFileSync("/tmp/ea-receipt.txt", "영수증 검증 파일\n");
  await row().locator('[data-testid^="e-edit-"]').click(); await settle(page, 900);
  await page.locator('[data-testid="e-files"]').setInputFiles("/tmp/ea-receipt.txt"); await settle(page, 1500);
  await clickBtn(page, "저장").catch(async () => { await clickBtn(page, "등록"); });
  await settle(page, 1600);
  await row().locator('[data-testid^="e-submit-"]').click(); await settle(page, 1800);
  chk(await status() === "상신", "결재 켬: 증빙 첨부 후 상신", await status());
  chk(await budgetSpent(page) === spent0, "결재 켬: 상신 단계도 미차감");
  await ctx.close();

  const s2 = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(s2.page, P.prof.email);
  await s2.page.goto(BASE + "/approvals"); await settle(s2.page, 1500);
  const appr = s2.page.locator("table tbody tr", { hasText: TAG }).first();
  chk(await appr.count() > 0, "결재 켬: 결재 문서 생성됨");
  if (await appr.count()) {
    await appr.locator('[data-testid^="a-approve-"]').click(); await settle(s2.page, 900);
    await s2.page.getByRole("button", { name: /^확인$/ }).last().click(); await settle(s2.page, 2200);
  }
  await s2.page.goto(BASE + "/expenses"); await settle(s2.page, 1700);
  const st2 = (await s2.page.locator("table tbody tr", { hasText: TAG }).first().locator('[data-testid^="e-status-"]').innerText().catch(() => "(없음)")).trim();
  chk(st2 === "승인", "결재 켬: 승인 시 집행도 승인", st2);
  chk(await budgetSpent(s2.page) === spent0 + 500000, "결재 켬: 승인 시점에 예산 반영");
  chk(errors.filter((e) => e.kind === "pageerror").length === 0, "JS 예외 없음");
  await shot(s2.page, "ea-approved");
  await s2.ctx.close();
}
// ── 기본값으로 원복
chk(await setApproval(false) === 200, "검증 후 기본값(결재 끔)으로 원복");
console.log(`\n결과: ${pass}/${pass + fail} 통과`);
await b.close();
