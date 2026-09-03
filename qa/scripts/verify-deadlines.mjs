// 마감 알림·캘린더 표시
import { newBrowser, newPage, uiLogin, settle, shot } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
const b = await newBrowser();
let pass = 0, fail = 0;
const chk = (ok, l, d) => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${l}${d ? "\n     " + d : ""}`); };
const P = Object.fromEntries(PERSONAS.map((p) => [p.key, p]));
const TAG = "DL" + Date.now().toString().slice(-5);
// 서버는 KST 기준으로 남은 일수를 센다 — 테스트도 KST 날짜로 맞춘다
const iso = (d) => new Date(Date.now() + 9 * 3600000 + d * 86400000).toISOString().slice(0, 10);

// 마감이 임박한 업무를 박사과정에게 배정
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.prof.email);
  const made = await page.evaluate(async ([tag, due, over]) => {
    const H = { "Content-Type": "application/json", Authorization: "Bearer " + localStorage.getItem("lm_access") };
    const us = await (await fetch("/api/members/users", { headers: H })).json();
    const phd = us.find((u) => u.name === "이박사");
    const ps = await (await fetch("/api/projects/projects?kind=activity", { headers: H })).json();
    const pid = ps[0]?.id;
    if (!pid) return { ok: false, why: "프로젝트 없음" };
    const mk = async (title, d) => (await fetch(`/api/projects/projects/${pid}/tasks`, {
      method: "POST", headers: H,
      body: JSON.stringify({ title, assignee_id: phd.id, status: "진행 중", start: null, due: d, body: "<p>마감 알림 검증</p>", link: "", files: [] }),
    })).status;
    return { ok: true, a: await mk(`${tag} 임박 업무`, due), b: await mk(`${tag} 지난 업무`, over), pid };
  }, [TAG, iso(3), iso(-2)]);
  chk(made.ok && made.a === 201 && made.b === 201, "마감 임박·초과 업무 생성", JSON.stringify(made));
  await ctx.close();
}
// 박사과정 알림에 뜨는지
{
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.phd.email); await settle(page, 1600);
  await page.locator('[data-testid="notif-bell"]').click(); await settle(page, 1400);
  const txt = await page.locator('[data-testid="notif-pop"]').innerText();
  chk(/업무 마감 D-3/.test(txt), "마감 임박 업무 알림", (txt.match(/업무 마감 D-\d+[\s\S]{0,40}/) || [""])[0].replace(/\n/g, " "));
  chk(/업무 마감 2일 지남/.test(txt), "마감 지난 업무 알림", (txt.match(/업무 마감 \d+일 지남[\s\S]{0,40}/) || [""])[0].replace(/\n/g, " "));
  await shot(page, "dl-notif");
  await ctx.close();
}
// 캘린더에 마감이 뜨는지 + 학생은 본인 것만
for (const key of ["phd", "master"]) {
  const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P[key].email);
  await page.goto(BASE + "/calendar"); await settle(page, 1800);
  // 한 날짜에 항목이 많으면 "+N건"으로 접히므로, 그 날을 열어 확인한다
  const has = await page.evaluate(async (title) => {
    if (document.body.innerText.includes(title)) return true;
    const cells = [...document.querySelectorAll(".cal .day, .cal td")];
    for (const c of cells) {
      if (!/\+\d+건/.test(c.textContent || "")) continue;
      c.click();
      await new Promise((r) => setTimeout(r, 400));
      const m = [...document.querySelectorAll(".modal")].find((e) => e.getClientRects().length);
      const hit = !!m && m.textContent.includes(title);
      document.querySelector(".modal-ovl")?.click();
      await new Promise((r) => setTimeout(r, 200));
      if (hit) return true;
    }
    return false;
  }, `${TAG} 임박 업무`);
  if (key === "phd") { chk(has, "담당자 캘린더에 업무 마감 표시"); await shot(page, "dl-calendar"); }
  else chk(!has, "다른 학생 캘린더에는 남의 업무 마감 미표시");
  await ctx.close();
}
// 교수는 전체가 보이는지
{
  const { ctx, page, errors } = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(page, P.prof.email);
  await page.goto(BASE + "/calendar"); await settle(page, 1800);
  const profHas = await page.evaluate(async (title) => {
    if (document.body.innerText.includes(title)) return true;
    for (const c of [...document.querySelectorAll(".cal .day, .cal td")]) {
      if (!/\+\d+건/.test(c.textContent || "")) continue;
      c.click();
      await new Promise((r) => setTimeout(r, 400));
      const m = [...document.querySelectorAll(".modal")].find((e) => e.getClientRects().length);
      const hit = !!m && m.textContent.includes(title);
      document.querySelector(".modal-ovl")?.click();
      await new Promise((r) => setTimeout(r, 200));
      if (hit) return true;
    }
    return false;
  }, `${TAG} 임박 업무`);
  chk(profHas, "교수 캘린더에는 구성원 마감도 표시");
  chk(errors.filter((e) => e.kind === "http" || e.kind === "pageerror").length === 0, "오류 없음",
      JSON.stringify(errors.filter((e) => e.kind === "http" || e.kind === "pageerror")));
  await ctx.close();
}
console.log(`\n결과: ${pass}/${pass + fail} 통과`);
await b.close();
