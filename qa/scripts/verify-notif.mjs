// 알림 폴링 — 요청 수·병렬성·내용 동등성 검증
import { newBrowser, newPage, uiLogin, settle, shot } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
const b = await newBrowser();
let pass = 0, fail = 0;
const chk = (ok, l, d) => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${l}${d ? "\n     " + d : ""}`); };

for (const key of ["prof", "under"]) {
  const { ctx, page, errors } = await newPage(b, { w: 1440, h: 900 });
  const reqs = [];
  page.on("request", (r) => { if (r.url().includes("/api/")) reqs.push({ u: r.url().split("/api")[1].split("?")[0], t: Date.now() }); });
  await uiLogin(page, PERSONAS.find((p) => p.key === key).email);
  reqs.length = 0;                                    // 로그인 이후부터 센다
  await page.goto(BASE + "/mypage", { waitUntil: "domcontentloaded" });
  await settle(page, 2200);

  const notif = reqs.filter((r) => /\/notifications$/.test(r.u));
  chk(notif.length === 3, `${key}: 알림 폴링이 서비스당 1회(총 3회)`, `${notif.length}회 — ${notif.map((n) => n.u).join(", ")}`);
  const span = notif.length ? Math.max(...notif.map((n) => n.t)) - Math.min(...notif.map((n) => n.t)) : 0;
  chk(span < 300, `${key}: 3건이 병렬로 나감`, `첫 요청과 마지막 요청 간격 ${span}ms`);
  // 종이 더 이상 목록 API 를 긁지 않는지
  const leaked = reqs.filter((r) => /\/(notices|meetings|projects|budgets|leaves\/inbox|correct-requests)$/.test(r.u));
  chk(leaked.length === 0, `${key}: 알림용 목록 API 추가 호출 없음`, leaked.map((r) => r.u).join(", ") || "없음");

  // 내용 확인
  await page.locator('[data-testid="notif-bell"]').click(); await settle(page, 1200);
  const txt = await page.locator('[data-testid="notif-pop"]').innerText();
  console.log(`     ${key} 알림: ${txt.split("\n").filter(Boolean).slice(0, 4).join(" | ").slice(0, 150)}`);
  if (key === "prof") {
    chk(/필독 공지 미확인|휴가 승인 요청|결재|배정|종료 D-/.test(txt), "파생 항목이 서버에서 내려옴");
    await shot(page, "notif-server-derived");
  }
  chk(errors.filter((e) => e.kind === "http" || e.kind === "pageerror").length === 0, `${key}: 오류 없음`,
      JSON.stringify(errors.filter((e) => e.kind === "http" || e.kind === "pageerror")));
  await ctx.close();
}
console.log(`\n결과: ${pass}/${pass + fail} 통과`);
await b.close();
