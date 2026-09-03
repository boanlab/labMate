import { newBrowser, newPage, uiLogin, settle, shot } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
import { clickBtn } from "./helpers.mjs";
const b = await newBrowser();
const P = Object.fromEntries(PERSONAS.map((p) => [p.key, p]));
let pass = 0, fail = 0;
const chk = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${label}${detail ? "\n     " + detail : ""}`); };

// 1) 모바일에서 연구비집행 수정·삭제 가능
{
  const { ctx, page } = await newPage(b, { w: 390, h: 844 });
  await uiLogin(page, P.deleg.email);
  await page.goto(BASE + "/expenses"); await settle(page, 800);
  const acts = await page.evaluate(() => {
    const tr = document.querySelector("table tbody tr");
    return tr ? [...tr.querySelectorAll("button")].filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim()) : [];
  });
  chk(acts.includes("수정") && acts.includes("삭제"), "모바일(390px) 연구비집행 수정·삭제 노출", `행 내 조작: ${JSON.stringify(acts)}`);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  chk(ov <= 1, "모바일 연구비집행 가로 오버플로 없음", `초과 ${ov}px`);
  await shot(page, "fix-expenses-mobile");
  await ctx.close();
}
// 2) 모바일 휴가 — 종류·일수 노출
{
  const { ctx, page } = await newPage(b, { w: 390, h: 844 });
  await uiLogin(page, P.master.email);
  await page.goto(BASE + "/leave"); await settle(page, 800);
  const cols = await page.evaluate(() => [...document.querySelectorAll("table thead th")].filter((th) => getComputedStyle(th).display !== "none").map((th) => th.textContent.trim()));
  chk(cols.includes("종류") && cols.includes("일수"), "모바일(390px) 휴가 종류·일수 노출", `보이는 컬럼: ${cols.join(", ")}`);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  chk(ov <= 1, "모바일 휴가 가로 오버플로 없음", `초과 ${ov}px`);
  await shot(page, "fix-leave-mobile");
  await ctx.close();
}
// 3) 자원예약 시간 입력이 time 타입
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.master.email);
  await page.goto(BASE + "/booking"); await settle(page, 700);
  await clickBtn(page, "+ 예약");
  await settle(page, 500);
  const t = await page.evaluate(() => ({
    s: document.querySelector('[data-testid="bk-start"]')?.type,
    e: document.querySelector('[data-testid="bk-end"]')?.type,
  }));
  chk(t.s === "time" && t.e === "time", "자원예약 시작·종료가 시간 입력(type=time)", `시작=${t.s} 종료=${t.e}`);
  // 잘못된 문자열을 넣을 수 있는지
  await page.locator('[data-testid="bk-start"]').fill("오후 2시").catch(() => {});
  const v = await page.locator('[data-testid="bk-start"]').inputValue();
  chk(v !== "오후 2시", "자유 텍스트 시간 입력 차단", `입력 후 값="${v}"`);
  await ctx.close();
}
// 4) 로그인 입력 타입·라벨 연결
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" }); await settle(page, 600);
  const m = await page.evaluate(() => {
    const e = document.querySelector('[data-testid="login-email"]');
    const p = document.querySelector('[data-testid="login-password"]');
    const le = document.querySelector('label[for="login-email"]');
    return { type: e?.type, id: e?.id, labelLinked: !!le, pwId: p?.id, required: e?.required };
  });
  chk(m.type === "email" && m.labelLinked && m.required, "로그인 이메일 type=email · label 연결 · required", JSON.stringify(m));
  await ctx.close();
}
// 5) 결재 승인 확인 절차
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.prof.email);
  await page.goto(BASE + "/approvals"); await settle(page, 800);
  const btn = page.locator('[data-testid^="a-approve-"]').first();
  if (await btn.count()) {
    await btn.click(); await settle(page, 700);
    const dlg = await page.evaluate(() => {
      const d = [...document.querySelectorAll(".modal,[role=dialog],.dlg,.dlg-card")].filter((e) => e.offsetParent !== null);
      return d.length ? d[d.length - 1].innerText.replace(/\n/g, " ").slice(0, 160) : null;
    });
    chk(!!dlg && /승인/.test(dlg), "결재 승인 시 확인 모달 표시", dlg || "안 뜸");
    const cancel = page.getByRole("button", { name: /취소/ }).last();
    if (await cancel.count()) await cancel.click();
  } else console.log("⏭  승인 대기 문서가 없어 건너뜀 (모두 처리됨)");
  await ctx.close();
}
console.log(`\n결과: ${pass}/${pass + fail} 통과`);
await b.close();
