// AI 멘토 화면 — 권한·기본 꺼짐·레이아웃·접근성을 페르소나별로 확인한다.
//
// 멘토 기능은 관리자가 켜야만 동작하고, 교수 전용 화면은 학생에게 보이면 안 된다.
// 화면이 늘어난 만큼 이 경계가 새기 쉬워 따로 묶어 둔다.
import { newBrowser, newPage, uiLogin, settle, audit, shot } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";

const b = await newBrowser();
const P = Object.fromEntries(PERSONAS.map((p) => [p.key, p]));
let pass = 0, fail = 0;
const chk = (ok, l, d) => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${l}${d ? "  — " + d : ""}`); };

const NEW_ROUTES = [
  { p: "/daily", label: "업무일지", allow: ["prof", "phd", "master", "under", "deleg"] },
  { p: "/goals", label: "목표", allow: ["prof", "phd", "master", "under", "deleg"] },
  { p: "/philosophy", label: "지도 철학", allow: ["prof", "phd", "master", "under", "deleg"] },
  { p: "/coaching", label: "지도 현황", allow: ["prof"] },
];

// ── 권한 경계 ──
for (const who of ["prof", "phd", "master", "under", "deleg"]) {
  const { ctx, page, errors } = await newPage(b, { w: 1440, h: 950 });
  await uiLogin(page, P[who].email);
  for (const r of NEW_ROUTES) {
    await page.goto(BASE + r.p, { waitUntil: "domcontentloaded" });
    await settle(page, 1200);
    const denied = (await page.locator('[data-testid="no-access"]').count()) > 0
                || /권한이 없|만 볼 수 있습니다/.test(await page.innerText("body"));
    const should = r.allow.includes(who);
    chk(should !== denied, `${P[who].label} → ${r.label} ${should ? "접근" : "차단"}`, denied ? "차단됨" : "열림");
  }
  const httpErr = errors.filter((e) => e.kind === "http" || e.kind === "pageerror");
  chk(httpErr.length === 0, `${P[who].label} 새 화면에서 오류 없음`, httpErr.map((e) => e.text).slice(0, 2).join(" / "));
  await ctx.close();
}

// ── 레이아웃(좁은 폭 포함) ──
{
  const { ctx, page } = await newPage(b, { w: 320, h: 640 });
  await uiLogin(page, P.prof.email);
  for (const r of NEW_ROUTES) {
    await page.goto(BASE + r.p, { waitUntil: "domcontentloaded" });
    await settle(page, 900);
    const a = await audit(page);
    const bad = !!a.hOverflow || a.offenders.length > 0 || a.clipped.length > 0;
    chk(!bad, `320px ${r.label} 레이아웃`, bad ? `넘침 ${a.hOverflow ? a.hOverflow.excess + "px" : 0} · 이탈 ${a.offenders.length} · 잘림 ${a.clipped.length}` : "");
  }
  await ctx.close();
}

// ── 라벨-입력 연결(접근성) ──
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 950 });
  await uiLogin(page, P.prof.email);
  for (const r of NEW_ROUTES) {
    await page.goto(BASE + r.p, { waitUntil: "domcontentloaded" });
    await settle(page, 900);
    const res = await page.evaluate(() => {
      const ctrls = [...document.querySelectorAll("input:not([type=hidden]), select, textarea")];
      let linked = 0;
      for (const el of ctrls) {
        const id = el.getAttribute("id");
        const ok = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`))
          || el.closest("label") || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby")
          || el.getAttribute("placeholder");
        if (ok) linked++;
      }
      return { total: ctrls.length, linked };
    });
    chk(res.linked === res.total, `${r.label} 라벨 연결`, `${res.linked}/${res.total}`);
  }
  await ctx.close();
}

// ── 멘토 기능이 꺼져 있으면 버튼이 사라지는가 ──
{
  const adm = await newPage(b, { w: 1024, h: 768 });
  await uiLogin(adm.page, process.env.LM_ADMIN_EMAIL || "", process.env.LM_ADMIN_PW || "");
  const setFeature = (v) => adm.page.evaluate(async (val) => {
    const H = { "Content-Type": "application/json", Authorization: "Bearer " + localStorage.getItem("lm_access") };
    const cur = await (await fetch("/api/mentor/config", { headers: H })).json();
    await fetch("/api/mentor/config/ai_features", { method: "PUT", headers: H,
      body: JSON.stringify({ value: { ...cur.ai_features, note: val } }) });
  }, v);

  const stu = await newPage(b, { w: 1280, h: 900 });
  await uiLogin(stu.page, P.phd.email);

  // 노트를 하나 열어야 편집 영역이 생긴다 — 열지 않으면 버튼 유무를 잴 수 없다.
  const openNote = async () => {
    await stu.page.goto(BASE + "/notes"); await settle(stu.page, 2000);
    if (!(await stu.page.locator('[data-testid="note-title-input"]').count())) {
      await stu.page.locator('[data-testid="note-new"]').click();
      await settle(stu.page, 1800);
    }
    return (await stu.page.locator('[data-testid="note-title-input"]').count()) > 0;
  };

  await setFeature(true);
  chk(await openNote(), "연구노트 편집 영역 열림");
  const on = await stu.page.locator('[data-testid="mentor-note"]').count();
  chk(on > 0, "기능 켜면 멘토 버튼 표시", `${on}개`);

  await setFeature(false);
  await openNote();
  chk((await stu.page.locator('[data-testid="mentor-note"]').count()) === 0, "기능 끄면 멘토 버튼 사라짐");

  await setFeature(true);   // 뒷정리 — 다음 검증이 켜진 상태를 전제한다
  await shot(stu.page, "mentor-note-button");
  await adm.ctx.close(); await stu.ctx.close();
}

console.log(`\n결과: ${pass}/${pass + fail} 통과`);
await b.close();
