// 두 사용자가 같은 문서를 동시에 편집할 때 무슨 일이 벌어지는가
import { newBrowser, newPage, uiLogin, settle, shot, save } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
import { clickBtn } from "./helpers.mjs";
const b = await newBrowser();
const P = Object.fromEntries(PERSONAS.map((p) => [p.key, p]));
const findings = [];
const note = (s, t, d) => { findings.push({ sev: s, title: t, detail: String(d).slice(0, 400) }); console.log(`[${s}] ${t}\n     ${d}`); };
const TAG = "CC" + Date.now().toString().slice(-5);

// ── 1) 공지 동시 수정
{
  console.log("=== 1) 공지 동시 수정 ===");
  const A = await newPage(b, { w: 1440, h: 900 });   // 교수
  await uiLogin(A.page, P.prof.email);
  // 대상 공지 생성
  await A.page.goto(BASE + "/notices"); await settle(A.page, 800);
  await clickBtn(A.page, "+ 공지 작성"); await settle(A.page, 600);
  await A.page.locator('[data-testid="n-title"]').fill(`${TAG} 동시편집 대상`);
  const ed = A.page.locator(".ck-editor__editable").first(); await ed.click(); await ed.type("원본 내용", { delay: 2 });
  await clickBtn(A.page, "작성"); await settle(A.page, 1600);

  const B = await newPage(b, { w: 1440, h: 900 });   // 위임자(관리 권한)
  await uiLogin(B.page, P.deleg.email);

  // 양쪽 모두 수정 화면 진입
  for (const S of [A, B]) {
    await S.page.goto(BASE + "/notices"); await settle(S.page, 900);
    const row = S.page.locator("table tbody tr", { hasText: TAG }).first();
    if (!await row.count()) { console.log("   대상 공지를 찾지 못함"); continue; }
    await row.locator("a").first().click(); await settle(S.page, 900);
    const edit = S.page.getByRole("button", { name: /^수정$/ }).first();
    if (await edit.count()) { await edit.click(); await settle(S.page, 900); }
  }
  const aEditable = await A.page.locator('[data-testid="n-title"]').count();
  const bEditable = await B.page.locator('[data-testid="n-title"]').count();
  console.log(`   교수 수정폼=${!!aEditable}  위임자 수정폼=${!!bEditable}`);
  if (aEditable && bEditable) {
    // A 가 먼저 저장
    await A.page.locator('[data-testid="n-title"]').fill(`${TAG} 교수가 고친 제목`);
    await A.page.locator('[data-testid="notice-add-submit"]').click(); await settle(A.page, 1500);
    // B 가 뒤이어 저장(A 의 변경을 모른 채)
    await B.page.locator('[data-testid="n-title"]').fill(`${TAG} 위임자가 고친 제목`);
    await B.page.locator('[data-testid="notice-add-submit"]').click(); await settle(B.page, 1500);
    const bMsg = await B.page.evaluate(() => [...document.querySelectorAll(".form-err,[role=alert],[data-testid='app-dialog']")].filter(e=>e.getClientRects().length).map(e=>e.innerText.trim().slice(0,140)));
    // 최종 상태 확인
    await A.page.goto(BASE + "/notices"); await settle(A.page, 1000);
    const finalTitle = await A.page.evaluate((t) => {
      const tr = [...document.querySelectorAll("table tbody tr")].find(r => r.innerText.includes(t));
      return tr ? tr.innerText.split("\n")[0].slice(0, 60) : null;
    }, TAG);
    console.log(`   B 저장 시 경고: ${JSON.stringify(bMsg)}`);
    console.log(`   최종 제목: "${finalTitle}"`);
    if (/위임자가 고친/.test(finalTitle || "") && !bMsg.length) {
      note("WARN", "공지 동시 수정 시 나중 저장이 앞선 수정을 조용히 덮어씀", `최종="${finalTitle}" · 충돌 경고 없음(lost update)`);
    } else if (bMsg.length) {
      note("OK", "공지 동시 수정 시 충돌을 알림", JSON.stringify(bMsg));
    }
    await shot(A.page, "cc-notice-a"); await shot(B.page, "cc-notice-b");
  }
  await A.ctx.close(); await B.ctx.close();
}

// ── 2) 결재 동시 승인 (같은 문서를 두 번 승인 시도)
{
  console.log("\n=== 2) 같은 결재 문서 중복 승인 ===");
  const A = await newPage(b, { w: 1440, h: 900 });
  const B = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(A.page, P.prof.email); await uiLogin(B.page, P.prof.email);   // 동일 사용자 두 탭
  for (const S of [A, B]) { await S.page.goto(BASE + "/approvals"); await settle(S.page, 1000); }
  const btnA = A.page.locator('[data-testid^="a-approve-"]').first();
  if (await btnA.count()) {
    const id = await btnA.getAttribute("data-testid");
    const btnB = B.page.locator(`[data-testid="${id}"]`);
    // A 승인
    await btnA.click(); await settle(A.page, 700);
    await A.page.getByRole("button", { name: /^확인$/ }).last().click(); await settle(A.page, 1500);
    // B 도 같은 문서 승인 시도(이미 처리됨)
    const existsB = await btnB.count();
    let bResult = "버튼 없음(목록 갱신됨)";
    if (existsB) {
      await btnB.click(); await settle(B.page, 700);
      const ok = B.page.getByRole("button", { name: /^확인$/ }).last();
      if (await ok.count()) { await ok.click(); await settle(B.page, 1500); }
      const msg = await B.page.evaluate(() => [...document.querySelectorAll(".form-err,[role=alert],[data-testid='app-dialog']")].filter(e=>e.getClientRects().length).map(e=>e.innerText.trim().slice(0,140)));
      const http = B.errors.filter(e=>e.kind==="http");
      bResult = `메시지=${JSON.stringify(msg)} HTTP=${JSON.stringify(http.map(e=>e.text))}`;
    }
    console.log(`   두 번째 승인 시도 결과: ${bResult}`);
    note("INFO", "중복 승인 처리", bResult);
  } else console.log("   대기 중 결재 문서 없음 — 건너뜀");
  await A.ctx.close(); await B.ctx.close();
}

// ── 3) 예산 동시 편성
{
  console.log("\n=== 3) 예산 동시 편성 ===");
  const A = await newPage(b, { w: 1440, h: 900 });
  const B = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(A.page, P.prof.email); await uiLogin(B.page, P.deleg.email);
  for (const S of [A, B]) {
    await S.page.goto(BASE + "/budget"); await settle(S.page, 1000);
    const btn = S.page.getByRole("button", { name: "예산 편성", exact: true }).first();
    if (await btn.count()) { await btn.click(); await settle(S.page, 700); }
  }
  const setAndSave = async (S, val, reason) => {
    const el = S.page.locator('[data-testid="bg-allocated-재료비"]');
    if (!await el.count()) return "입력칸 없음";
    await el.fill(""); await el.type(val, { delay: 4 });
    const r = S.page.locator('[data-testid="bg-reason"]');
    if (await r.count()) await r.fill(reason);
    await S.page.locator('[data-testid="bg-save"]').click(); await settle(S.page, 1600);
    return "저장 시도";
  };
  console.log("   교수:", await setAndSave(A, "44000000", "교수 조정"));
  console.log("   위임자:", await setAndSave(B, "55000000", "위임자 조정"));
  await A.page.goto(BASE + "/budget"); await settle(A.page, 1200);
  const finalVal = await A.page.evaluate(() => {
    const tds = [...document.querySelectorAll("table tbody td")].map(e=>e.textContent.trim());
    return tds.filter(t=>/44,000,000|55,000,000/.test(t));
  });
  console.log(`   최종 재료비 값: ${JSON.stringify(finalVal)}`);
  note("INFO", "예산 동시 편성 최종값", JSON.stringify(finalVal));
  await A.ctx.close(); await B.ctx.close();
}
save("concurrency.json", findings);
await b.close();
