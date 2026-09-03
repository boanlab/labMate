// 퇴사·삭제된 구성원의 이름 표시.
// 구성원 목록(/members/users)은 학생에게 퇴사자를 감추므로 id→이름은 /members/directory 로 찾는다.
// 명부에도 없는 사람(삭제)은 아이디가 아니라 "(삭제된 구성원)"으로 보여야 한다.
import { newBrowser, newPage, uiLogin, settle } from "./lib.mjs";
import { PERSONAS, BASE, PW } from "./personas.mjs";

const b = await newBrowser();
const P = Object.fromEntries(PERSONAS.map((p) => [p.key, p]));
let pass = 0, fail = 0;
const chk = (ok, l, d) => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${l}${d ? "  — " + d : ""}`); };
const TEMP = "TempPass!2026";

const { ctx: cp, page: prof } = await newPage(b, { w: 1280, h: 900 });
await uiLogin(prof, P.prof.email);

// 시험용 구성원을 만들고, 그 사람 이름으로 글을 하나 남긴다
const email = `퇴사시험-${Date.now()}@qa.kloud.zone`;
const u = await prof.evaluate(async (e) => {
  const H = { "Content-Type": "application/json", Authorization: "Bearer " + localStorage.getItem("lm_access") };
  return await (await fetch("/api/members/users", { method: "POST", headers: H, body: JSON.stringify({ email: e, name: "홍퇴사", role: "master", temp_password: "TempPass!2026" }) })).json();
}, email);

const { ctx: c2, page: p2 } = await newPage(b, { w: 1000, h: 800 });
await p2.goto(BASE + "/login");
const postId = await p2.evaluate(async ([e, pw, temp]) => {
  const login = async (password) => (await (await fetch("/api/members/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e, password }) })).json()).access;
  let t = await login(temp);
  await fetch("/api/members/change-password", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t }, body: JSON.stringify({ current_password: temp, new_password: pw }) });
  t = await login(pw);
  const r = await fetch("/api/boards/posts", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t }, body: JSON.stringify({ title: "퇴사자표시시험", body: "<p>본문</p>", ptype: "자유게시판" }) });
  return (await r.json()).id;
}, [email, PW, TEMP]);
await c2.close();

// 오프보딩(비활성화)
await prof.evaluate(async (id) => {
  await fetch(`/api/members/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: "Bearer " + localStorage.getItem("lm_access") }, body: JSON.stringify({ active: false }) });
}, u.id);

const authorCell = async (page) => {
  await page.goto(BASE + "/board"); await settle(page, 1800);
  return await page.evaluate(() => {
    const tr = [...document.querySelectorAll("tbody tr")].find((r) => r.innerText.includes("퇴사자표시시험"));
    return tr ? [...tr.cells].map((c) => c.innerText.trim()) : null;
  });
};

const { ctx: c3, page: p3 } = await newPage(b, { w: 1440, h: 900 });
await uiLogin(p3, P.master.email);

// 근본 원인 자체를 못박아 둔다 — 목록에서는 빠지지만 명부에서는 나와야 한다
const api = await p3.evaluate(async (id) => {
  const H = { Authorization: "Bearer " + localStorage.getItem("lm_access") };
  const users = await (await fetch("/api/members/users", { headers: H })).json();
  const dir = await (await fetch("/api/members/directory", { headers: H })).json();
  return { inList: users.some((x) => x.id === id), inDir: dir.some((x) => x.id === id), dirName: dir.find((x) => x.id === id)?.name };
}, u.id);
chk(!api.inList, "학생 구성원 목록에서는 퇴사자가 빠진다(의도된 동작)");
chk(api.inDir && api.dirName === "홍퇴사", "이름 명부에는 퇴사자도 남는다", String(api.dirName));

const row = await authorCell(p3);
chk(!!row && row.includes("홍퇴사"), "비활성 구성원의 글도 작성자가 이름", JSON.stringify(row));
await c3.close();

// 완전 삭제
await prof.evaluate(async (id) => {
  await fetch(`/api/members/users/${id}`, { method: "DELETE", headers: { Authorization: "Bearer " + localStorage.getItem("lm_access") } });
}, u.id);

const { ctx: c4, page: p4 } = await newPage(b, { w: 1440, h: 900 });
await uiLogin(p4, P.master.email);
const row2 = await authorCell(p4);
chk(!!row2 && row2.includes("(삭제된 구성원)"), "삭제된 구성원은 아이디가 아니라 안내 문구", JSON.stringify(row2));
chk(!!row2 && !row2.some((c) => /^[0-9a-f]{6}$/.test(c) || /^[0-9a-f]{32}$/.test(c)), "어느 경우에도 아이디값은 노출되지 않는다");
await c4.close();

// 뒷정리 — 시험 글 제거(다음 회차 목록·페이징에 영향 주지 않도록)
await prof.evaluate(async (id) => {
  await fetch(`/api/boards/posts/${id}`, { method: "DELETE", headers: { Authorization: "Bearer " + localStorage.getItem("lm_access") } });
}, postId);
await cp.close();

console.log(`\n결과: ${pass}/${pass + fail} 통과`);
await b.close();
