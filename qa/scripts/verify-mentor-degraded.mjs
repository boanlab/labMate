// 멘토 서비스가 죽어도 그룹웨어는 계속 쓸 수 있어야 한다.
//
// AI 는 부가 기능이다. 외부 API 나 mentor 서비스가 멈췄다고 연구실 업무가
// 막히면 안 된다. 서비스를 실제로 내렸다가 올리며 확인한다.
import { execSync } from "node:child_process";

import { newBrowser, newPage, uiLogin, settle } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
const compose = (cmd) => execSync(`docker compose -f /home/jn/labmate/docker-compose.yml ${cmd}`, { stdio: "pipe" });
compose("stop mentor-service");
await new Promise((r) => setTimeout(r, 3000));

const b = await newBrowser(); const P = Object.fromEntries(PERSONAS.map(p=>[p.key,p]));
let pass = 0, fail = 0;
const T=(ok,l,d)=>{ ok?pass++:fail++; console.log(`${ok?"✅":"❌"} ${l}${d?"  — "+d:""}`); };
const { page, errors } = await newPage(b, { w: 1440, h: 950 });
await uiLogin(page, P.phd.email);
for (const p of ["/", "/notes", "/goals", "/tasks"]) {
  await page.goto(BASE + p); await settle(page, 2500);
  const broken = await page.evaluate(() => !document.querySelector("main, .content") || document.body.innerText.length < 200);
  T(!broken, `${p} 화면 정상 렌더`, "");
}
T((await page.locator('[data-testid="mentor-fab"]').count()) === 0, "멘토 버튼 숨김(서비스 중단 시)");
T((await page.locator('[data-testid="mentor-nudge"]').count()) === 0, "독려 카드 숨김");
const je = errors.filter(e => e.kind === "pageerror");
T(je.length === 0, "자바스크립트 오류 없음", je.map(e=>e.text).slice(0,1).join(""));
console.log("  (멘토 502 " + errors.filter((e) => e.kind === "http").length + "건 — 서비스 중단 중이므로 정상)");
await b.close();

compose("start mentor-service");
await new Promise((r) => setTimeout(r, 6000));
console.log(`\n결과: ${pass}/${pass + fail} 통과`);
