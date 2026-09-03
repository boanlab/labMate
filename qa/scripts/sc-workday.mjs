// 실제 연구실 업무일 재현 — 5개 페르소나가 순차적으로 자기 업무를 수행
import { newBrowser, newPage, uiLogin, settle, shot, save } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
import { fillLabel, clickBtn, recorder } from "./helpers.mjs";

const P = Object.fromEntries(PERSONAS.map((p) => [p.key, p]));
const b = await newBrowser();
const findings = [];
const note = (sev, area, title, detail) => { findings.push({ sev, area, title, detail }); console.log(`  [${sev}] ${area} — ${title}`); };

async function session(key, fn) {
  const s = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(s.page, P[key].email);
  try { await fn(s.page, s.errors, recorder(key)); } finally { await s.ctx.close(); }
}

// ═══ 1. 지도교수: 공지 발행 + 자산 등록 + 회의록
await session("prof", async (page, errors, R) => {
  console.log("\n=== 지도교수 ===");
  await R.run("공지 작성", async () => {
    await page.goto(BASE + "/notices"); await settle(page);
    await clickBtn(page, "+ 공지 작성");
    await page.locator('[data-testid="n-title"]').fill("2026학년도 1학기 연구실 세미나 일정 안내");
    await page.locator('[data-testid="n-due"]').fill("2026-03-15");
    await page.locator('[data-testid="n-required"]').check();
    const ed = page.locator(".ck-editor__editable").first();
    await ed.click(); await ed.type("매주 화요일 16시, 소프트웨어ICT관 401호에서 정기 세미나를 진행합니다. 전원 참석 필수입니다.", { delay: 3 });
    await clickBtn(page, "작성");
    await settle(page, 1500);
    await page.locator('[data-testid="notice-search"]').fill("세미나 일정 안내"); await settle(page, 700);
    await page.waitForSelector("text=2026학년도 1학기 연구실 세미나 일정 안내", { timeout: 8000 });
  });
  await shot(page, "wd-01-notice");

  await R.run("자산 등록", async () => {
    await page.goto(BASE + "/assets"); await settle(page);
    await clickBtn(page, "+ 자산 등록");
    await page.locator('[data-testid="as-name"]').fill("GPU 서버 (A100 80GB x4)");
    await page.locator('[data-testid="as-asset_no"]').fill("2026-0011");
    await page.locator('[data-testid="as-buy"]').fill("2026-03-10");
    await page.locator('[data-testid="as-spec"]').fill("4U 랙마운트 / 2TB RAM");
    await page.locator('[data-testid="as-model"]').fill("Dell PowerEdge XE8545");
    await page.locator('[data-testid="as-building"]').fill("소프트웨어ICT관");
    await page.locator('[data-testid="as-floor"]').fill("4");
    await page.locator('[data-testid="as-room"]').fill("401");
    await page.locator('[data-testid="as-owner"]').fill("이박사");
    await clickBtn(page, "등록", { exact: true });
    await settle(page, 1200);
    await page.waitForSelector("text=GPU 서버 (A100 80GB x4)", { timeout: 8000 });
  });
  await shot(page, "wd-02-asset");

  await R.run("회의록 작성", async () => {
    await page.goto(BASE + "/meetings"); await settle(page);
    await clickBtn(page, "+ 회의록 작성");
    await page.locator('[data-testid="mt-title"]').fill("3월 1주차 정기 연구미팅");
    await page.locator('[data-testid="mt-date"]').fill("2026-03-03");
    // 참석자 체크
    for (const n of ["이박사", "최석사"]) {
      const btn = page.getByRole("button", { name: n, exact: true }).first();
      if (await btn.count()) await btn.click();
    }
    const ed = page.locator(".ck-editor__editable").first();
    await ed.click(); await ed.type("eBPF 프로브 설계 방향을 syscall 후킹으로 확정. 4월 중간발표 전까지 프로토타입 완료 목표.", { delay: 3 });
    await clickBtn(page, "저장");
    await settle(page, 1500);
  });
  await shot(page, "wd-03-meeting");
  const bad = R.report();
  if (bad.length) bad.forEach((s) => note("BUG", "지도교수", s.label + " 실패", s.err));
  errors.filter((e) => e.kind === "http" || e.kind === "pageerror").forEach((e) => note("ERR", "지도교수", e.kind, e.text));
});

// ═══ 2. 박사과정: 출근 → 업무 확인 → 연구노트 → 게시판
await session("phd", async (page, errors, R) => {
  console.log("\n=== 박사과정 ===");
  await R.run("출근 체크", async () => {
    await page.goto(BASE + "/attendance"); await settle(page);
    const btn = page.locator('[data-testid="att-checkin"]');
    if (await btn.isDisabled()) return "이미 출근 처리됨(정상)";
    await btn.click();
    await settle(page, 1200);
    const txt = await page.locator("table").first().innerText();
    if (!/\d{2}:\d{2}/.test(txt)) throw new Error("출근 시각이 표에 표시되지 않음: " + txt.slice(0, 200));
    return txt.split("\n").slice(0, 3).join(" / ");
  });
  await shot(page, "wd-04-attendance-in");

  await R.run("내 세부업무 확인", async () => {
    await page.goto(BASE + "/tasks"); await settle(page);
    const txt = await page.locator("body").innerText();
    if (!/eBPF 프로브 프로토타입 구현/.test(txt)) throw new Error("교수가 배정한 업무가 보이지 않음");
    return "배정 업무 확인됨";
  });
  await shot(page, "wd-05-mytasks");

  await R.run("공지 확인(필독)", async () => {
    await page.goto(BASE + "/notices"); await settle(page);
    await page.locator('[data-testid="notice-search"]').fill("세미나 일정 안내"); await settle(page, 700);
    const txt = await page.locator("body").innerText();
    if (!/세미나 일정 안내/.test(txt)) throw new Error("교수 공지가 보이지 않음");
    return "공지 노출 확인";
  });

  await R.run("연구노트 작성", async () => {
    await page.goto(BASE + "/notes"); await settle(page);
    await clickBtn(page, "+ 새 페이지");
    await settle(page, 900);
    await page.locator('[data-testid="note-title-input"]').fill("2026-03-03 eBPF 프로브 설계 검토");
    const ed = page.locator(".ck-editor__editable").first();
    await ed.click(); await ed.type("tracepoint vs kprobe 비교. tracepoint가 ABI 안정성 측면에서 유리하나 커버리지가 제한적.", { delay: 3 });
    await settle(page, 1500);
  });
  await shot(page, "wd-06-note");

  await R.run("게시판 글쓰기", async () => {
    await page.goto(BASE + "/board"); await settle(page);
    await clickBtn(page, "+ 글쓰기");
    await page.locator('[data-testid="b-title"]').fill("[논문리뷰] Falco 런타임 탐지 아키텍처 정리");
    await page.locator('[data-testid="b-cat"]').selectOption({ label: "논문리뷰" });
    const ed = page.locator(".ck-editor__editable").first();
    await ed.click(); await ed.type("Falco의 커널 모듈 방식과 eBPF 방식의 성능 차이를 정리했습니다.", { delay: 3 });
    await clickBtn(page, "등록", { exact: true });
    await settle(page, 1500);
    await page.waitForSelector("text=Falco 런타임 탐지 아키텍처 정리", { timeout: 8000 });
  });
  await shot(page, "wd-07-board");

  await R.run("실적 등록 가능 여부", async () => {
    await page.goto(BASE + "/publications"); await settle(page);
    const canAdd = await page.locator('[data-testid="pub-add-open"]').count();
    return canAdd ? "등록 가능" : "조회 전용(등록 버튼 없음)";
  });

  const bad = R.report();
  if (bad.length) bad.forEach((s) => note("BUG", "박사과정", s.label + " 실패", s.err));
  errors.filter((e) => e.kind === "http" || e.kind === "pageerror").forEach((e) => note("ERR", "박사과정", e.kind, e.text));
});

save("workday-findings.json", findings);
console.log("\n\n===== 발견 사항 =====");
findings.forEach((f) => console.log(`[${f.sev}] ${f.area} — ${f.title}\n     ${String(f.detail).slice(0, 300)}`));
await b.close();
