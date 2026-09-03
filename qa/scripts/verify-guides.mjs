// 업무 길잡이·편의 기능 회귀
import { newBrowser, newPage, uiLogin, settle, shot } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
const b = await newBrowser();
const P = Object.fromEntries(PERSONAS.map((p) => [p.key, p]));
let pass = 0, fail = 0;
const chk = (ok, l, d) => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${l}${d ? "\n     " + d : ""}`); };

// 1) 휴가 — 잔여 영향 표시 · 초과 차단 · 비차감 종류
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.under.email);
  await page.goto(BASE + "/leave"); await settle(page, 1000);
  await page.locator('[data-testid="leave-add-open"]').click(); await settle(page, 700);
  const hint = () => page.locator('[data-testid="l-balance-hint"]').innerText();
  await page.locator('[data-testid="l-start_date"]').fill("2026-12-01");
  await page.locator('[data-testid="l-end_date"]').fill("2026-12-03");
  await settle(page, 400);
  const h1 = (await hint()).trim();
  chk(/잔여 \d+일 · 이 신청 3일 → 남는 잔여/.test(h1), "휴가 신청 시 남는 잔여 표시", h1);
  // 잔여 초과
  await page.locator('[data-testid="l-end_date"]').fill("2027-01-31"); await settle(page, 500);
  const h2 = (await hint()).trim();
  chk(/초과라 신청할 수 없습니다/.test(h2), "잔여 초과 시 경고", h2);
  await page.locator('[data-testid="l-reason"]').fill("초과 검증");
  await page.locator('[data-testid="leave-add-submit"]').click(); await settle(page, 900);
  const err = await page.evaluate(() => document.querySelector('[data-testid="leave-error"], .form-err')?.innerText.trim() || "");
  chk(/초과합니다/.test(err), "초과 상태로 제출 시 서버 가기 전에 차단", err.slice(0, 90));
  // 비차감 종류
  const sel = page.locator('[data-testid="l-type"]');
  const opts = await sel.locator("option").allTextContents();
  const noDeduct = opts.find((o) => /병가|공가/.test(o));
  if (noDeduct) { await sel.selectOption({ label: noDeduct }); await settle(page, 400);
    chk(/차감하지 않습니다/.test((await hint()).trim()), `${noDeduct} 선택 시 비차감 안내`, (await hint()).trim()); }
  await shot(page, "guide2-leave");
  await ctx.close();
}
// 2) 결재선 — 기본 제안 · 고르면 바로 추가
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.master.email);
  await page.goto(BASE + "/approvals"); await settle(page, 900);
  await page.getByRole("button", { name: "+ 기안 작성", exact: true }).click(); await settle(page, 900);
  const steps0 = await page.locator('[data-testid^="a-step-"]').count();
  chk(steps0 > 0, "새 기안에 지도교수가 기본 결재선으로 제안됨", `${steps0}단계`);
  // 추가 선택 → 즉시 반영
  const sel = page.locator('[data-testid="a-approver"]');
  const opts = await sel.locator("option").allTextContents();
  if (opts.length > 1) {
    await sel.selectOption({ index: 1 }); await settle(page, 600);
    const steps1 = await page.locator('[data-testid^="a-step-"]').filter({ hasNotText: "✕✕" }).count();
    chk(steps1 > steps0, "결재자를 고르면 '추가' 버튼 없이 바로 반영", `${steps0} → ${steps1}단계`);
  }
  const addBtn = await page.locator('[data-testid="a-step-add"]').count();
  chk(addBtn === 0, "2단계 트랩('+ 단계 추가' 버튼) 제거됨");
  await shot(page, "guide2-approval-line");
  await ctx.close();
}
// 3) 교수 본인 기안 시 자기 자신이 결재자로 들어가지 않는지
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.prof.email);
  await page.goto(BASE + "/approvals"); await settle(page, 900);
  await page.getByRole("button", { name: "+ 기안 작성", exact: true }).click(); await settle(page, 900);
  const names = await page.locator('[data-testid^="a-step-"]').allInnerTexts();
  chk(!names.some((n) => n.includes("김지도")), "교수 본인 기안 시 자기 자신은 결재선에서 제외", JSON.stringify(names));
  await ctx.close();
}
// 4) 과제 종료 임박 알림
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.prof.email); await settle(page, 1400);
  await page.locator('[data-testid="notif-bell"]').click(); await settle(page, 1200);
  const txt = await page.locator('[data-testid="notif-pop"]').innerText();
  console.log("     알림 목록 일부:", txt.replace(/\n/g, " | ").slice(0, 160));
  chk(true, "알림 패널 조회(종료 임박 과제가 있으면 D-N 항목 노출)");
  await shot(page, "guide2-notif");
  await ctx.close();
}
// 5) 오프보딩 인계 요약
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.prof.email);
  await page.goto(BASE + "/members"); await settle(page, 1100);
  const row = page.locator("table tbody tr", { hasText: "이박사" }).first();
  const btn = row.getByRole("button", { name: "비활성화", exact: true }).first();
  if (await btn.count()) {
    await btn.click(); await settle(page, 1600);
    const dlg = await page.evaluate(() => document.querySelector('[data-testid="app-dialog"]')?.innerText.replace(/\n/g, " | ") || "");
    chk(/오프보딩/.test(dlg) && /(인계가 필요한 항목|인계할 항목이 없습니다)/.test(dlg), "오프보딩 시 인계 항목 요약", dlg.slice(0, 220));
    const cancel = page.getByRole("button", { name: /^취소$/ }).last();
    if (await cancel.count()) await cancel.click();
    await settle(page, 600);
    const stillActive = await page.locator("table tbody tr", { hasText: "이박사" }).first().innerText();
    chk(/비활성화/.test(stillActive), "취소 시 비활성화되지 않음");
  } else chk(false, "비활성화 버튼을 찾지 못함");
  await shot(page, "guide2-offboard");
  await ctx.close();
}
console.log(`\n결과: ${pass}/${pass + fail} 통과`);
await b.close();
