// 수정 검증 — 작성 중 토글 재클릭 시 (1)확인 모달이 뜨고 (2)취소하면 내용이 보존되는가
import { newBrowser, newPage, uiLogin, settle, shot } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
const b = await newBrowser();
const CASES = [
  { key: "prof",  route: "/notices",  open: "+ 공지 작성",     tid: "notice-add-open",  sel: '[data-testid="n-title"]', label: "공지사항" },
  { key: "phd",   route: "/board",    open: "+ 글쓰기",        tid: "board-add-open",   sel: '[data-testid="b-title"]', label: "게시판" },
  { key: "prof",  route: "/assets",   open: "+ 자산 등록",     tid: "asset-add-open",   sel: '[data-testid="as-name"]', label: "자산" },
  { key: "deleg", route: "/expenses", open: "+ 집행 등록",     tid: "exp-add-open",     sel: '[data-testid="e-title"]', label: "연구비집행" },
  { key: "master",route: "/booking",  open: "+ 예약",          tid: "booking-add-open", sel: '[data-testid="bk-purpose"]', label: "자원예약" },
  { key: "prof",  route: "/grants",   open: "+ 연구과제 추가", tid: "project-add-open", sel: '[data-testid="p-name"]', label: "연구과제" },
];
const sessions = new Map();
let pass = 0, fail = 0;
for (const c of CASES) {
  if (!sessions.has(c.key)) {
    const s = await newPage(b, { w: 1440, h: 900 });
    await uiLogin(s.page, PERSONAS.find((p) => p.key === c.key).email);
    sessions.set(c.key, s);
  }
  const { page } = sessions.get(c.key);
  await page.goto(BASE + c.route, { waitUntil: "domcontentloaded" });
  await settle(page, 700);
  const tgl = page.locator(`[data-testid="${c.tid}"]`);
  const labelClosed = (await tgl.innerText()).trim();
  await tgl.click(); await settle(page, 600);
  const labelOpen = (await tgl.innerText()).trim();
  const VAL = "작성중인 소중한 내용";
  await page.locator(c.sel).fill(VAL);

  // 1) 토글 재클릭 → 확인 모달
  await tgl.click(); await settle(page, 700);
  const dlgText = await page.evaluate(() => {
    const d = [...document.querySelectorAll(".modal,[role=dialog],.dlg,.dlg-card")].filter((e) => e.offsetParent !== null);
    return d.length ? d[d.length - 1].innerText.replace(/\n/g, " ").slice(0, 120) : null;
  });
  // 2) '취소'로 되돌리면 입력이 살아있는가
  let kept = null;
  if (dlgText) {
    const cancel = page.getByRole("button", { name: /취소|아니|닫지/ }).last();
    if (await cancel.count()) { await cancel.click(); await settle(page, 600); }
    kept = await page.locator(c.sel).count() ? await page.locator(c.sel).inputValue() : "(필드없음)";
  }
  const ok = !!dlgText && kept === VAL;
  ok ? pass++ : fail++;
  console.log(`${ok ? "✅" : "❌"} ${c.label} (${c.route})`);
  console.log(`    버튼 라벨: "${labelClosed}" → 열린 뒤 "${labelOpen}"`);
  console.log(`    확인 모달: ${dlgText || "❌ 안 뜸"}`);
  console.log(`    취소 후 입력값 보존: ${kept === VAL ? "✅ 유지" : `❌ "${kept}"`}`);
}
console.log(`\n결과: ${pass}/${pass + fail} 통과`);
for (const s of sessions.values()) await s.ctx.close();
await b.close();
