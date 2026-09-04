// 상시 멘토 대화 — 화면 맥락 인지, 대화 맥락 유지, 모르는 것을 단정하지 않는가.
import { newBrowser, newPage, uiLogin, settle } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
const b = await newBrowser(); const P = Object.fromEntries(PERSONAS.map(p=>[p.key,p]));
let pass = 0, fail = 0;
const T=(ok,l,d)=>{ ok?pass++:fail++; console.log(`${ok?"✅":"❌"} ${l}${d?"  — "+d:""}`); };
const { page } = await newPage(b, { w: 1440, h: 950 });
await uiLogin(page, P.master.email);

// 화면 맥락이 전달되는가 — 다른 화면에서 열어 본다
for (const [path, expect] of [["/goals","목표"], ["/notes","연구노트"]]) {
  await page.goto(BASE + path); await settle(page, 2500);
  const fab = page.locator('[data-testid="mentor-fab"]');
  if (!(await fab.count())) { T(false, `${path} 멘토 버튼`); continue; }
  await fab.click(); await settle(page, 400);
  const head = await page.locator('.mentor-panel-h').innerText();
  T(head.includes(expect), `${path} 에서 현재 화면 표시`, head.replace(/\n/g," "));
  await page.locator('.mentor-panel-h button[aria-label="닫기"]').click(); await settle(page, 300);
}

// 실제 대화 — 연구 방법론 질문
await page.goto(BASE + "/goals"); await settle(page, 2000);
await page.locator('[data-testid="mentor-fab"]').click(); await settle(page, 400);
await page.locator('[data-testid="mentor-chat-in"]').fill("학회 마감이 3개월 남았는데 뭐부터 해야 할까요?");
await page.locator('[data-testid="mentor-chat-send"]').click();
await page.waitForFunction(() => document.querySelectorAll('[data-testid="mentor-chat"] .ph-turn.ai').length > 0, null, { timeout: 120000 });
const r1 = await page.locator('[data-testid="mentor-chat"] .ph-turn.ai .ph-text').first().innerText();
T(r1.length > 40, "방법론 질문 응답", r1.slice(0,70).replace(/\n/g," "));

// 이어지는 질문 — 맥락 유지
await page.locator('[data-testid="mentor-chat-in"]').fill("그 중 첫 2주만 더 자세히요");
await page.locator('[data-testid="mentor-chat-send"]').click();
await page.waitForFunction(() => document.querySelectorAll('[data-testid="mentor-chat"] .ph-turn.ai').length > 1, null, { timeout: 120000 });
const r2 = await page.locator('[data-testid="mentor-chat"] .ph-turn.ai .ph-text').nth(1).innerText();
T(r2.length > 40 && !/무엇을 도와|어떤 주제/.test(r2.slice(0,40)), "이전 대화 맥락 유지", r2.slice(0,70).replace(/\n/g," "));

// 연구 내용의 정답을 단정하지 않는가
await page.locator('[data-testid="mentor-chat-in"]').fill("eBPF로 커널 함수 후킹하면 오버헤드가 몇 퍼센트인가요?");
await page.locator('[data-testid="mentor-chat-send"]').click();
await page.waitForFunction(() => document.querySelectorAll('[data-testid="mentor-chat"] .ph-turn.ai').length > 2, null, { timeout: 120000 });
const r3 = await page.locator('[data-testid="mentor-chat"] .ph-turn.ai .ph-text').nth(2).innerText();
const hedged = /측정|환경마다|다릅니다|확인|직접|경우에 따라|지도교수/.test(r3);
T(hedged, "연구 수치를 단정하지 않고 확인 방법 제시", r3.slice(0,80).replace(/\n/g," "));
await page.screenshot({ path: new URL("../out/shots/chat.png", import.meta.url).pathname });
console.log(`\n결과: ${pass}/${pass + fail} 통과`);
await b.close();
