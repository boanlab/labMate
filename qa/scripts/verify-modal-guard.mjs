import { newBrowser, newPage, uiLogin, settle } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
const b = await newBrowser();
const P = Object.fromEntries(PERSONAS.map((p) => [p.key, p]));
let pass = 0, fail = 0;
const chk = (ok, l, d) => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${l}${d ? "\n     " + d : ""}`); };
const dlg = (page) => page.evaluate(() => {
  const d = [...document.querySelectorAll('[data-testid="app-dialog"]')].filter((e) => e.getClientRects().length);
  return d.length ? d[0].innerText.replace(/\n/g, " ").slice(0, 90) : null;
});

// 업무 추가 모달 — Esc 로 닫을 때 확인
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.prof.email);
  await page.goto(BASE + "/projects"); await settle(page, 800);
  await page.locator("table tbody tr").first().click(); await settle(page, 800);
  await page.getByRole("button", { name: "+ 업무 추가", exact: true }).click(); await settle(page, 700);
  // 빈 상태에서 Esc → 확인 없이 닫혀야 함
  await page.keyboard.press("Escape"); await settle(page, 600);
  const closedClean = await page.locator('[data-testid="task-form"]').count() === 0;
  chk(closedClean, "빈 업무 모달은 Esc로 바로 닫힘(불필요한 확인 없음)");
  // 입력 후 Esc → 확인 모달
  await page.getByRole("button", { name: "+ 업무 추가", exact: true }).click(); await settle(page, 700);
  await page.locator('[data-testid="tf-title"]').fill("작성 중인 업무");
  await page.keyboard.press("Escape"); await settle(page, 700);
  const d1 = await dlg(page);
  chk(!!d1 && /사라집니다/.test(d1), "입력 후 Esc → 이탈 확인 모달", d1 || "안 뜸");
  // 취소 → 내용 유지
  await page.getByRole("button", { name: "취소", exact: true }).last().click(); await settle(page, 600);
  const kept = await page.locator('[data-testid="tf-title"]').inputValue().catch(() => "(없음)");
  chk(kept === "작성 중인 업무", "확인 취소 시 입력 유지", `값="${kept}"`);
  // 배경 클릭 → 확인 모달
  await page.mouse.click(6, 400); await settle(page, 700);
  const d2 = await dlg(page);
  chk(!!d2 && /사라집니다/.test(d2), "입력 후 배경 클릭 → 이탈 확인 모달", d2 || "안 뜸");
  await ctx.close();
}
// 근태 정정 요청 모달
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.master.email);
  await page.goto(BASE + "/attendance"); await settle(page, 800);
  await page.getByRole("button", { name: "+ 출퇴근 시간 정정 요청", exact: true }).click(); await settle(page, 700);
  await page.locator('[data-testid="rq-reason"]').fill("출근 체크 누락");
  await page.keyboard.press("Escape"); await settle(page, 700);
  const d = await dlg(page);
  chk(!!d && /사라집니다/.test(d), "근태 정정 모달 이탈 확인", d || "안 뜸");
  await ctx.close();
}
console.log(`\n결과: ${pass}/${pass + fail} 통과`);
await b.close();
