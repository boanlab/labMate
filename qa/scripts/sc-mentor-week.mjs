// 멘토와 함께 보내는 한 주 — 실제 사용 순서대로 훑는다.
//
// 기능이 하나씩 되는 것과, 순서대로 이어 쓸 때 말이 되는 것은 다르다.
// 교수가 철학을 등록 → 학생이 그 기준으로 지도받고 → 목표를 세우고 →
// 밀린 일을 챙기고 → 주말에 회고하는 흐름을 그대로 재현한다.
import { newBrowser, newPage, uiLogin, settle, shot } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
import { recorder } from "./helpers.mjs";

const b = await newBrowser();
const P = Object.fromEntries(PERSONAS.map((p) => [p.key, p]));
const R = recorder();
const findings = [];
const note = (kind, who, what, detail) => findings.push({ kind, who, what, detail });

/** 멘토 응답이 나타날 때까지 기다린다(모델 응답은 수 초 걸린다). */
async function waitMentor(page, feature, ms = 90000) {
  await page.waitForSelector(`[data-testid="mentor-out-${feature}"]`, { timeout: ms });
  return page.locator(`[data-testid="mentor-out-${feature}"] .mentor-body`).innerText().catch(() => "");
}

// ── 1. 교수: 지침을 등록한다 ──
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 950 });
  await uiLogin(page, P.prof.email);
  await R.run("지도 철학 — 지침 직접 추가", async () => {
    await page.goto(BASE + "/philosophy"); await settle(page, 1500);
    await page.locator('[data-testid="ph-cat-practice"]').click(); await settle(page, 900);
    const before = await page.locator('.ph-list li').count();
    await page.locator('[data-testid="ph-new"]').fill("보고는 결론을 먼저 쓰고 근거를 뒤에 붙인다");
    await page.locator('[data-testid="ph-add"]').click(); await settle(page, 1500);
    const after = await page.locator('.ph-list li').count();
    if (after <= before) throw new Error(`지침이 추가되지 않음 (${before} → ${after})`);
    return `적용 중 지침 ${after}건`;
  });
  await shot(page, "mw-01-philosophy");
  await ctx.close();
}

// ── 2. 학생: 지침을 확인하고, 목표를 세운다 ──
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 950 });
  await uiLogin(page, P.master.email);

  await R.run("학생이 지도 기준을 확인", async () => {
    await page.goto(BASE + "/philosophy"); await settle(page, 1500);
    await page.locator('[data-testid="ph-cat-practice"]').click(); await settle(page, 900);
    const t = await page.innerText("body");
    if (!/결론을 먼저 쓰고/.test(t)) throw new Error("교수가 등록한 지침이 학생에게 보이지 않음");
    if (await page.locator('[data-testid="ph-start"]').count()) throw new Error("학생에게 인터뷰 버튼이 보임");
    return "승인된 지침만 열람";
  });

  await R.run("분기 목표와 결과지표 등록", async () => {
    await page.goto(BASE + "/goals"); await settle(page, 1500);
    if (!(await page.locator('[data-testid="okr-item"]').count())) {
      await page.locator('[data-testid="goal-add-open"]').click(); await settle(page, 500);
      await page.locator('[data-testid="goal-title"]').fill("1저자 논문 1편을 국제학회에 투고한다");
      await page.locator('[data-testid="goal-add-submit"]').click(); await settle(page, 1500);
    }
    if (!(await page.locator('[data-testid="kr-new"]').count())) throw new Error("결과지표 입력칸이 없음");
    return `목표 ${await page.locator('[data-testid="okr-item"]').count()}건`;
  });
  await shot(page, "mw-02-goals");

  await R.run("연구노트를 쓰고 멘토에게 점검받음", async () => {
    await page.goto(BASE + "/notes"); await settle(page, 2000);
    if (!(await page.locator('[data-testid="note-title-input"]').count())) {
      await page.locator('[data-testid="note-new"]').click(); await settle(page, 1800);
    }
    await page.locator('[data-testid="note-title-input"]').fill("실험 기록");
    const ed = page.locator(".ck-editor__editable").first();
    await ed.click(); await ed.type("오늘 실험을 돌렸다. 저번보다 좀 나아진 것 같다.", { delay: 3 });
    await settle(page, 1200);
    const btn = page.locator('[data-testid="mentor-note"]');
    if (!(await btn.count())) throw new Error("멘토 점검 버튼이 없음(기능이 꺼져 있는지 확인)");
    await btn.click();
    const text = await waitMentor(page, "note");
    if (text.length < 40) throw new Error(`멘토 응답이 비었거나 너무 짧음: ${text.slice(0, 80)}`);
    // 지침이 실제로 반영되는지 — 문구가 아니라 '점검이 이뤄졌는지'로 본다
    return text.replace(/\n/g, " ").slice(0, 90);
  });
  await shot(page, "mw-03-note-mentor");
  await ctx.close();
}

// ── 3. 학생: 밀린 일을 멘토가 짚어 준다 ──
{
  const { ctx, page, errors } = await newPage(b, { w: 1440, h: 1000 });
  await uiLogin(page, P.phd.email);
  await R.run("대시보드에서 밀린 일 안내", async () => {
    await page.goto(BASE + "/"); await settle(page, 4000);
    const card = page.locator('[data-testid="mentor-nudge"]');
    if (!(await card.count())) return "밀린 일이 없어 카드가 없음(정상)";
    await page.waitForSelector('[data-testid="nudge-text"]', { timeout: 90000 }).catch(() => {});
    const t = await page.locator('[data-testid="nudge-text"]').innerText().catch(() => "");
    if (!t) throw new Error("독려 문구가 표시되지 않음");
    for (const bad of ["왜 안", "실망", "게으"]) {
      if (t.includes(bad)) throw new Error(`나무라는 표현 사용: ${bad}`);
    }
    return t.replace(/\n/g, " ").slice(0, 90);
  });
  await shot(page, "mw-04-nudge");

  await R.run("주간 회고 초안 생성", async () => {
    const wr = page.locator('[data-testid="weekly-review"]');
    if (!(await wr.count())) throw new Error("주간 회고 카드가 없음");
    await page.locator('[data-testid="wr-open"]').click(); await settle(page, 600);
    await page.locator('[data-testid="wr-draft"]').click();
    await page.waitForFunction(() => (document.querySelector('[data-testid="wr-text"]') || {}).value?.length > 60,
      null, { timeout: 120000 });
    const v = await page.locator('[data-testid="wr-text"]').inputValue();
    await page.locator('[data-testid="wr-save"]').click(); await settle(page, 1500);
    return `${v.length}자 초안 저장`;
  });
  await shot(page, "mw-05-review");

  const httpErr = errors.filter((e) => e.kind === "http" || e.kind === "pageerror");
  httpErr.forEach((e) => note("ERR", "박사과정", e.kind, e.text));
  await ctx.close();
}

// ── 4. 교수: 누구를 챙겨야 하는지 본다 ──
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 950 });
  await uiLogin(page, P.prof.email);
  await R.run("지도 현황에서 위험 학생 식별", async () => {
    await page.goto(BASE + "/coaching"); await settle(page, 2500);
    const rows = await page.locator('[data-testid="coaching-table"] tbody tr').count();
    if (!rows) throw new Error("학생 행이 없음");
    const first = await page.locator('[data-testid="coaching-table"] tbody tr').first().innerText();
    return `${rows}명 · 상위: ${first.replace(/\n|\t/g, " ").slice(0, 60)}`;
  });
  await shot(page, "mw-06-coaching");
  await ctx.close();
}

const bad = R.report();
bad.forEach((s) => note("BUG", "", s.label + " 실패", s.err));
console.log("\n===== 발견 사항 =====");
if (!findings.length) console.log("(없음)");
findings.forEach((f) => console.log(`[${f.kind}] ${f.who} — ${f.what}\n     ${f.detail}`));
await b.close();
