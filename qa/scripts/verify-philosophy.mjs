// 지도 철학 인터뷰 — 대화에서 지침을 뽑아 승인하면 학생 지도에 반영되는가.
//
// 이 사슬(교수 대화 → 지침 추출 → 승인 → 학생 가이드)이 끊기면 철학 계층 전체가
// 무의미해진다. 사슬 끝까지 실제로 이어지는지 본다.
import { newBrowser, newPage, uiLogin, settle } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
const b = await newBrowser(); const P = Object.fromEntries(PERSONAS.map(p=>[p.key,p]));
let pass = 0, fail = 0;
const T=(ok,l,d)=>{ ok?pass++:fail++; console.log(`${ok?"✅":"❌"} ${l}${d?"  — "+d:""}`); };
const { page } = await newPage(b, { w: 1440, h: 1000 });
await uiLogin(page, P.prof.email);
await page.goto(BASE + "/philosophy"); await settle(page, 1500);
await page.locator('[data-testid="ph-cat-research"]').click(); await settle(page, 1200);

// 대화 초기화 후 처음부터
const reset = await page.locator('button:has-text("대화 지우기")').count();
if (reset) { await page.locator('button:has-text("대화 지우기")').click(); await settle(page, 600);
  const ok = page.getByRole("button", { name: /확인/ }).first();
  if (await ok.count()) { await ok.click(); await settle(page, 1200); } }

await page.locator('[data-testid="ph-start"]').click(); await settle(page, 2000);
const q1 = await page.locator('.ph-turn.ai .ph-text').first().innerText();
T(q1.length > 20, "인터뷰 첫 질문", q1.slice(0,60));

await page.locator('[data-testid="ph-answer"]').fill("좋은 연구는 남이 재현할 수 있어야 합니다. 재현이 안 되면 결과가 아무리 좋아도 의미가 없습니다. 학생들이 실험 조건을 대충 적고 넘어가는 걸 자주 봅니다.");
await page.locator('[data-testid="ph-send"]').click();
await page.waitForFunction(() => document.querySelectorAll('.ph-turn.ai').length >= 2, null, { timeout: 120000 });
const q2 = await page.locator('.ph-turn.ai .ph-text').nth(1).innerText();
T(q2.length > 20, "후속 질문 생성", q2.slice(0,70));

await page.locator('[data-testid="ph-answer"]').fill("작년에 학생이 쓴 논문을 후배가 재현하려다 3주를 날렸습니다. 시드값과 데이터 버전이 안 적혀 있어서요. 그 뒤로 노트에 조건을 반드시 적게 했습니다.");
await page.locator('[data-testid="ph-send"]').click();
await page.waitForFunction(() => document.querySelectorAll('.ph-turn.ai').length >= 3, null, { timeout: 120000 });

const beforeDraft = await page.locator('[data-testid="ph-draft"]').count();
await page.locator('[data-testid="ph-extract"]').click();
await page.waitForFunction((n) => document.querySelectorAll('[data-testid="ph-draft"]').length > n, beforeDraft, { timeout: 150000 }).catch(()=>{});
const drafts = await page.locator('[data-testid="ph-draft"]').count();
T(drafts > beforeDraft, "대화에서 지침 초안 추출", `${drafts}건`);
if (drafts) console.log("   초안:", await page.locator('[data-testid="ph-draft-text"]').first().inputValue());

// 승인 → 학생에게 반영
await page.locator('[data-testid="ph-approve"]').first().click(); await settle(page, 1500);
const approvedText = await page.locator('.ph-list li b').last().innerText().catch(()=>"");
T(!!approvedText, "승인하면 적용 목록으로 이동", approvedText.slice(0,50));
await page.screenshot({ path: new URL("../out/shots/ph-flow.png", import.meta.url).pathname, fullPage: true });

// 승인된 지침이 학생 점검에 실제로 근거로 쓰이는가
const { page: stu } = await newPage(b, { w: 1024, h: 768 });
await uiLogin(stu, P.phd.email);
const guided = await stu.evaluate(async () => {
  const r = await fetch("/api/mentor/review", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + localStorage.getItem("lm_access") },
    body: JSON.stringify({ feature: "note", title: "실험 기록", body: "오늘 실험을 돌렸다. 저번보다 나아졌다." }),
  });
  return (await r.json()).text || "";
});
T(/지침|지도교수/.test(guided), "승인된 지침이 학생 지도의 근거로 쓰임", guided.slice(0, 60).replace(/\n/g, " "));

// 뒷정리 — 이 검증이 만든 초안을 지운다(다음 회차가 깨끗한 상태에서 시작하도록)
await page.evaluate(async () => {
  const H = { Authorization: "Bearer " + localStorage.getItem("lm_access") };
  const ps = await (await fetch("/api/mentor/philosophy/principles", { headers: H })).json();
  for (const p of ps.filter((x) => !x.approved && x.category === "research")) {
    await fetch(`/api/mentor/philosophy/principles/${p.id}`, { method: "DELETE", headers: H });
  }
});

console.log(`\n결과: ${pass}/${pass + fail} 통과`);
await b.close();
