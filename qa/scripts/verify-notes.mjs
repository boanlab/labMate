// 연구노트 검색·태그 필터
import { newBrowser, newPage, uiLogin, settle, shot } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
import { clickBtn } from "./helpers.mjs";
const b = await newBrowser();
let pass = 0, fail = 0;
const chk = (ok, l, d) => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${l}${d ? "  — " + d : ""}`); };
const TAG = "노트" + Date.now().toString().slice(-4);
const { page, errors } = await newPage(b, { w: 1440, h: 900 });
await uiLogin(page, PERSONAS.find((p) => p.key === "phd").email);
await page.goto(BASE + "/notes"); await settle(page, 1300);

// 검색 대상 노트 2개 생성(하나에는 태그)
for (const [title, tag] of [[`${TAG} 커널 프로브 실험`, "eBPF"], [`${TAG} 논문 초안 정리`, ""]]) {
  await clickBtn(page, "+ 새 페이지"); await settle(page, 1100);
  await page.locator('[data-testid="note-title-input"]').fill(title);
  if (tag) {
    const ti = page.locator('input[placeholder="+태그"]').first();
    if (await ti.count()) { await ti.fill(tag); await ti.press("Enter"); await settle(page, 600); }
  }
  await settle(page, 1400);
}
await page.reload({ waitUntil: "domcontentloaded" }); await settle(page, 1600);

const treeText = () => page.evaluate(() => document.querySelector(".notes-tree")?.innerText.replace(/\n/g, " | ") || "");
chk(await page.locator('[data-testid="note-search"]').count() > 0, "노트 검색창 존재");

// 제목 검색
await page.locator('[data-testid="note-search"]').fill("커널 프로브"); await settle(page, 700);
const t1 = await treeText();
chk(/검색 결과/.test(t1) && /커널 프로브/.test(t1) && !/논문 초안/.test(t1), "제목 검색으로 좁혀짐", t1.slice(0, 90));

// 태그 검색
await page.locator('[data-testid="note-search"]').fill("eBPF"); await settle(page, 700);
const t2 = await treeText();
chk(/커널 프로브/.test(t2), "태그로도 검색됨", t2.slice(0, 90));

// 태그 칩 필터
await page.locator('[data-testid="note-search"]').fill(""); await settle(page, 600);
const chip = page.locator('[data-testid="note-tagbar"] .chip').filter({ hasText: "eBPF" }).first();
if (await chip.count()) {
  await chip.click(); await settle(page, 700);
  const t3 = await treeText();
  chk(/#eBPF/.test(t3) && /커널 프로브/.test(t3), "태그 칩으로 필터", t3.slice(0, 90));
  await chip.click(); await settle(page, 600);
  const t4 = await treeText();
  chk(/내 연구노트/.test(t4), "태그 칩 재클릭 시 트리로 복귀", t4.slice(0, 70));
} else chk(false, "태그 칩을 찾지 못함");

// 결과 없음
await page.locator('[data-testid="note-search"]').fill("존재하지않는키워드XYZ"); await settle(page, 700);
chk(/조건에 맞는 노트가 없습니다/.test(await treeText()), "검색 결과 없음 안내");
chk(errors.filter((e) => e.kind === "http" || e.kind === "pageerror").length === 0, "오류 없음",
    JSON.stringify(errors.filter((e) => e.kind === "http" || e.kind === "pageerror")));
await shot(page, "notes-search");
console.log(`\n결과: ${pass}/${pass + fail} 통과`);
await b.close();
