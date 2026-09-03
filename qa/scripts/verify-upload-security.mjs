// 첨부 보안 — 업로드(형식·크기)와 다운로드(인증·응답 헤더), 로그인 시도 제한.
// 첨부는 앱과 같은 출처에서 서빙되므로 실행 가능한 형식이 올라가면 저장형 XSS 가 된다.
import { newBrowser, newPage, uiLogin, settle } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";

const b = await newBrowser();
const P = Object.fromEntries(PERSONAS.map((p) => [p.key, p]));
let pass = 0, fail = 0;
const chk = (ok, l, d) => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${l}${d ? "  — " + d : ""}`); };

const post = (page, files) => page.evaluate(async (specs) => {
  const fd = new FormData();
  for (const s of specs) fd.append("files", new File([s.body ?? "x"], s.name, { type: s.type || "" }));
  const r = await fetch("/api/projects/uploads", {
    method: "POST", headers: { Authorization: "Bearer " + localStorage.getItem("lm_access") }, body: fd,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}, files);

const { ctx, page } = await newPage(b, { w: 1024, h: 768 });
await uiLogin(page, P.phd.email);
await page.goto(BASE + "/board"); await settle(page, 1000);

// 1) 스크립트가 될 수 있는 형식은 받지 않는다
for (const [name, type] of [["poc.html", "text/html"], ["poc.svg", "image/svg+xml"], ["poc.js", "text/javascript"], ["poc", ""]]) {
  const r = await post(page, [{ name, type, body: "<script>alert(1)</script>" }]);
  chk(r.status === 400, `위험 형식 거부 ${name}`, "HTTP " + r.status);
}

// 2) 정상 문서는 그대로 올라간다
const ok = await post(page, [{ name: "연구계획 v1.txt", type: "text/plain", body: "hello" }]);
chk(ok.status === 200 && ok.body?.[0]?.url?.endsWith(".txt"), "정상 첨부 업로드", JSON.stringify(ok.body || {}).slice(0, 70));
const URL_ = ok.body?.[0]?.url;

// 3) 여러 개 중 하나만 어긋나도 통째로 막는다(반쪽 저장 방지)
const mixed = await post(page, [{ name: "정상.txt" }, { name: "나쁨.html", type: "text/html" }]);
chk(mixed.status === 400, "섞어 올려도 위험 형식이 있으면 전부 거부", "HTTP " + mixed.status);

// 4) 크기 상한
const big = await page.evaluate(async () => {
  const fd = new FormData();
  fd.append("files", new File([new Uint8Array(31 << 20)], "big.zip", { type: "application/zip" }));
  const r = await fetch("/api/projects/uploads", { method: "POST", headers: { Authorization: "Bearer " + localStorage.getItem("lm_access") }, body: fd });
  return r.status;
});
chk(big === 413, "크기 상한 초과 거부", "HTTP " + big);

if (URL_) {
  // 5) 내려줄 때 헤더
  const h = await page.evaluate(async (u) => {
    const r = await fetch(u, { cache: "no-store" });
    return { s: r.status, disp: r.headers.get("content-disposition"), sniff: r.headers.get("x-content-type-options"), csp: r.headers.get("content-security-policy") };
  }, URL_);
  chk(h.s === 200, "로그인 사용자는 첨부 열림", "HTTP " + h.s);
  chk(h.disp === "attachment", "문서는 브라우저에서 열지 않고 내려받기", String(h.disp));
  chk(h.sniff === "nosniff", "내용 추측(sniffing) 차단", String(h.sniff));
  chk(!!h.csp && h.csp.includes("default-src 'none'"), "첨부에 CSP 적용", String(h.csp || "없음"));

  // 6) 다운로드 쿠키는 스크립트가 못 읽고, API 에는 통하지 않는다
  const dl = (await ctx.cookies()).find((c) => c.name === "lm_dl");
  chk(!!dl && dl.httpOnly, "다운로드 쿠키가 httpOnly", dl ? `httpOnly=${dl.httpOnly} sameSite=${dl.sameSite}` : "쿠키 없음");
  chk(await page.evaluate(() => !document.cookie.includes("lm_dl")), "스크립트에서 쿠키 안 보임");

  // 7) 로그인하지 않으면 URL 을 알아도 열리지 않는다
  const anon = await newPage(b, { w: 800, h: 600 });
  await anon.page.goto(BASE + "/login");                 // 같은 출처에서 물어봐야 의미가 있다
  const st = await anon.page.evaluate(async (u) => (await fetch(u, { cache: "no-store" })).status, URL_).catch(() => 0);
  chk(st === 401, "로그인 없이는 첨부 차단", "HTTP " + st);
  await anon.ctx.close();

  // 8) 로그아웃하면 즉시 막힌다(캐시에 남은 것도 재검증된다)
  await page.locator('[data-testid="user-menu-btn"]').click(); await settle(page, 400);
  await page.locator(".menu-pop").getByText("로그아웃").first().click(); await settle(page, 1500);
  const after = await page.evaluate(async (u) => (await fetch(u)).status, URL_);
  chk(after === 401, "로그아웃 후 첨부 차단", "HTTP " + after);
}
await ctx.close();

// 9) 로그인 시도 제한 — 틀린 비밀번호를 반복하면 잠긴다
{
  const { ctx: c2, page: p2 } = await newPage(b, { w: 800, h: 600 });
  await p2.goto(BASE + "/login");
  // 잠금은 5분간 남으므로 회차마다 다른 주소를 쓴다 — 앞 회차의 잠금이 이번 판정을 흐리지 않게.
  const victim = `잠금시험-${Date.now()}@qa.kloud.zone`;
  const codes = await p2.evaluate(async (email) => {
    const out = [];
    for (let i = 0; i < 7; i++) {
      const r = await fetch("/api/members/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "wrong" + i }),
      });
      out.push(r.status);
    }
    return out;
  }, victim);
  chk(codes.slice(0, 5).every((c) => c === 401), "틀린 비밀번호는 401", codes.join(","));
  chk(codes.slice(5).some((c) => c === 429), "반복 시도는 잠금(429)", codes.join(","));
  // 뒷정리 — 성공 로그인 한 번이면 이 IP 의 실패 카운터가 지워진다.
  // 남겨 두면 다음 검증이 같은 IP 에서 막힐 수 있다.
  await uiLogin(p2, P.phd.email);
  await c2.close();
}

console.log(`\n결과: ${pass}/${pass + fail} 통과`);
await b.close();
