// 날짜·시간 검증 회귀 — 앱 메시지와 브라우저 기본 검증을 모두 인정한다
import { newBrowser, newPage, uiLogin, settle } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
const b = await newBrowser();
const P = Object.fromEntries(PERSONAS.map((p) => [p.key, p]));
const TAG = "DV" + Date.now().toString().slice(-6);
let pass = 0, fail = 0;
const chk = (ok, l, d) => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${l}${d ? "\n     " + d : ""}`); };
const appErr = (pg) => pg.evaluate(() => [...document.querySelectorAll(".form-err,[role=alert],[data-testid='app-dialog']")]
  .filter((e) => e.getClientRects().length).map((e) => e.innerText.trim().replace(/\n/g, " ").slice(0, 130)));
const nativeInvalid = (pg, sel) => pg.evaluate((s) => { const e = document.querySelector(s); return e ? { valid: e.checkValidity(), msg: e.validationMessage } : null; }, sel);

// 1) 공지 — 과거 마감일
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.prof.email);
  await page.goto(BASE + "/notices"); await settle(page, 800);
  await page.locator('[data-testid="notice-add-open"]').click(); await settle(page, 600);
  await page.locator('[data-testid="n-title"]').fill(`${TAG} 과거마감`);
  await page.locator('[data-testid="n-due"]').fill("2020-01-15");
  const ed = page.locator(".ck-editor__editable").first(); await ed.click(); await ed.type("검증", { delay: 2 });
  const nv = await nativeInvalid(page, '[data-testid="n-due"]');
  await page.locator('[data-testid="notice-add-submit"]').click(); await settle(page, 1300);
  await page.goto(BASE + "/notices"); await settle(page, 900);
  const saved = (await page.locator("body").innerText()).includes(TAG);
  chk(!saved && (nv?.valid === false), "공지 과거 마감일 차단", `저장됨=${saved} · 브라우저검증="${nv?.msg}"`);
  await ctx.close();
}
// 2) 자원예약 — 과거 일자
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.master.email);
  await page.goto(BASE + "/booking"); await settle(page, 800);
  await page.locator('[data-testid="booking-add-open"]').click(); await settle(page, 600);
  await page.locator('[data-testid="bk-date"]').fill("2020-01-15");
  await page.locator('[data-testid="bk-start"]').fill("10:00");
  await page.locator('[data-testid="bk-end"]').fill("11:00");
  await page.locator('[data-testid="bk-purpose"]').fill(`${TAG} 과거예약`);
  const nv = await nativeInvalid(page, '[data-testid="bk-date"]');
  await page.locator('[data-testid="booking-add-submit"]').click(); await settle(page, 1300);
  await page.goto(BASE + "/booking"); await settle(page, 900);
  const saved = (await page.locator("body").innerText()).includes(TAG);
  chk(!saved && (nv?.valid === false), "자원예약 과거 일자 차단", `저장됨=${saved} · 브라우저검증="${nv?.msg}"`);
  await ctx.close();
}
// 3) 자원예약 — 종료 < 시작 (깨끗한 폼에서)
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.master.email);
  await page.goto(BASE + "/booking"); await settle(page, 800);
  await page.locator('[data-testid="booking-add-open"]').click(); await settle(page, 600);
  await page.locator('[data-testid="bk-date"]').fill("2026-12-05");
  await page.locator('[data-testid="bk-start"]').fill("16:00");
  await page.locator('[data-testid="bk-end"]').fill("14:00");
  await page.locator('[data-testid="bk-purpose"]').fill(`${TAG} 역순시간`);
  await page.locator('[data-testid="booking-add-submit"]').click(); await settle(page, 1300);
  const msg = await appErr(page);
  await page.goto(BASE + "/booking"); await settle(page, 900);
  const saved = (await page.locator("body").innerText()).includes(TAG);
  chk(!saved && msg.some((m) => /종료 시간/.test(m)), "자원예약 종료<시작 차단", `${JSON.stringify(msg)} 저장됨=${saved}`);
  await ctx.close();
}
// 4) 자원예약 — 시간 입력에 자유 텍스트 불가
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.master.email);
  await page.goto(BASE + "/booking"); await settle(page, 800);
  await page.locator('[data-testid="booking-add-open"]').click(); await settle(page, 600);
  await page.locator('[data-testid="bk-start"]').fill("오후 2시").catch(() => {});
  const v = await page.locator('[data-testid="bk-start"]').inputValue();
  chk(v !== "오후 2시", "시간 칸에 자유 텍스트 입력 불가", `입력 후 값="${v}"`);
  await ctx.close();
}
// 5) 휴가 — 과거 시작일은 확인 후 진행 가능(사후 신청 허용 정책)
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.master.email);
  await page.goto(BASE + "/leave"); await settle(page, 800);
  await page.locator('[data-testid="leave-add-open"]').click(); await settle(page, 600);
  // 매 실행마다 다른 날짜를 써야 '기간 겹침(409)' 에 걸리지 않는다.
  // 월까지 흩어 충돌 확률을 낮춘다(하루짜리라 월 길이는 신경 쓰지 않아도 된다).
  // 사후 신청 확인을 보려면 과거 날짜여야 하고, 이미 신청된 날짜와 겹치면 서버가 막는다.
  // 기존 신청을 읽어 비어 있는 과거 날짜를 고른다.
  const day = await page.evaluate(async () => {
    const r = await fetch("/api/attendance/leaves/me", { headers: { Authorization: "Bearer " + localStorage.getItem("lm_access") } });
    const used = new Set();
    for (const l of await r.json()) {
      for (let d = new Date(l.start_date); d <= new Date(l.end_date); d.setDate(d.getDate() + 1)) used.add(d.toISOString().slice(0, 10));
    }
    const today = new Date(Date.now() + 9 * 3600000);
    for (let back = 1; back < 400; back++) {
      const d = new Date(today); d.setDate(d.getDate() - back);
      const iso = d.toISOString().slice(0, 10);
      if (!used.has(iso)) return iso;
    }
    return null;
  });
  if (!day) throw new Error("비어 있는 과거 날짜를 찾지 못했습니다");
  // 이 검증의 관심사는 '지난 날짜 확인'이지 잔여 연차가 아니다.
  // 반복 실행으로 연차가 소진돼도 흔들리지 않도록 차감되지 않는 종류를 쓴다.
  const typeSel = page.locator('[data-testid="l-type"]');
  const opts = await typeSel.locator("option").allTextContents();
  const noDeduct = opts.find((o) => /병가|공가/.test(o));
  if (noDeduct) await typeSel.selectOption({ label: noDeduct });
  await page.locator('[data-testid="l-start_date"]').fill(day);
  await page.locator('[data-testid="l-end_date"]').fill(day);
  await page.locator('[data-testid="l-reason"]').fill(`${TAG} 사후신청`);
  await page.locator('[data-testid="leave-add-submit"]').click(); await settle(page, 1100);
  const msg = await appErr(page);
  const asked = msg.some((m) => /지난 날짜/.test(m));
  const ok = page.getByRole("button", { name: /^확인$/ }).last();
  if (await ok.count()) { await ok.click(); await settle(page, 1400); }
  // 내 신청 내역은 시작일 내림차순 10건씩 페이징이라 과거 날짜 건은 뒷페이지로 밀린다.
  // 화면 텍스트 대신 서버 기록으로 확인한다.
  const saved = await page.evaluate(async (tag) => {
    const r = await fetch("/api/attendance/leaves/me", { headers: { Authorization: "Bearer " + localStorage.getItem("lm_access") } });
    return (await r.json()).some((l) => (l.reason || "").includes(tag));
  }, TAG);
  // 같은 날짜가 이미 신청돼 있으면 서버가 409 로 막는다 — 그것도 정상 동작이므로 함께 인정한다.
  const msgs = await appErr(page);
  const conflict = msgs.some((m) => /겹칩니다/.test(m));
  chk(asked && (saved || conflict), "휴가 사후 신청 — 확인 후 접수(또는 기간중복 안내)",
      `확인모달=${asked} 저장됨=${saved} 중복안내=${conflict} 날짜=${day} 메시지=${JSON.stringify(msgs)}`);
  await ctx.close();
}
console.log(`\n결과: ${pass}/${pass + fail} 통과`);
await b.close();
