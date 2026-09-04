// 표 정밀 검사 — 모든 화면의 표를 여러 폭에서 훑는다.
//
// 보는 것:
//  1) 셀 텍스트가 잘리는가(말줄임 없이 넘치거나, 말줄임인데 title 이 없어 원문을 볼 수 없는 경우)
//  2) 표가 카드 밖으로 넘쳐 페이지에 가로 스크롤을 만드는가
//  3) 머리글이 두 줄로 접히거나 잘리는가
//  4) 컬럼 폭 조절·정렬이 붙어 있는가(붙은 표는 실제로 끌어서 폭이 바뀌는가)
import { newBrowser, newPage, uiLogin, settle } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";

const b = await newBrowser();
const P = Object.fromEntries(PERSONAS.map((p) => [p.key, p]));
let pass = 0, fail = 0;
const chk = (ok, l, d) => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${l}${d ? "  — " + d : ""}`); };

// 표가 있는 화면과, 그 표를 볼 수 있는 페르소나
const PAGES = [
  { p: "/notices", who: "prof", label: "공지사항" },
  { p: "/board", who: "phd", label: "게시판" },
  { p: "/meetings", who: "prof", label: "회의록" },
  { p: "/approvals", who: "prof", label: "전자결재" },
  { p: "/tasks", who: "phd", label: "세부업무" },
  { p: "/booking", who: "master", label: "자원예약" },
  { p: "/leave", who: "master", label: "휴가" },
  { p: "/expenses", who: "prof", label: "연구비집행" },
  { p: "/budget", who: "prof", label: "예산" },
  { p: "/payroll", who: "prof", label: "학생인건비" },
  { p: "/members", who: "prof", label: "구성원" },
  { p: "/attendance", who: "phd", label: "출퇴근" },
  { p: "/att-admin", who: "prof", label: "근태 관리" },
  { p: "/publications", who: "prof", label: "실적" },
  { p: "/assets", who: "prof", label: "자산" },
  { p: "/coaching", who: "prof", label: "지도 현황" },
  { p: "/audit", who: "admin", label: "감사로그" },
];

const WIDTHS = [360, 768, 1280, 1920];

/** 화면 안의 모든 표를 살펴 결함을 모은다. */
const INSPECT = `() => {
  const out = [];
  document.querySelectorAll("table").forEach((tbl, ti) => {
    const r = tbl.getBoundingClientRect();
    if (!r.width) return;                              // 숨겨진 표는 건너뛴다
    const wrap = tbl.closest(".scroll, .card, .bd") || tbl.parentElement;
    const wr = wrap ? wrap.getBoundingClientRect() : r;
    const info = { ti, cols: tbl.querySelectorAll("thead th").length,
                   rows: tbl.querySelectorAll("tbody tr").length,
                   overflowsWrap: r.width > wr.width + 1 && wrap && getComputedStyle(wrap).overflowX === "visible",
                   clipped: [], headWrap: [], noTitle: [] };
    // 머리글이 접히거나 잘리는가
    tbl.querySelectorAll("thead th").forEach((th) => {
      const s = getComputedStyle(th);
      // 실제 글자 높이만 본다 — 패딩을 포함하면 안 접힌 머리글도 접힌 것으로 잡힌다.
      const pad = parseFloat(s.paddingTop) + parseFloat(s.paddingBottom);
      const textH = th.clientHeight - pad;
      const oneLine = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.3 || 16;
      if (th.scrollWidth > th.clientWidth + 1 && s.textOverflow !== "ellipsis") {
        info.headWrap.push({ t: th.innerText.trim().slice(0, 14), cut: true });
      } else if (textH > oneLine * 1.6 && th.innerText.trim().length > 1) {
        info.headWrap.push({ t: th.innerText.trim().slice(0, 14), wrapped: true });
      }
    });
    // 본문 셀 — 넘치는데 말줄임이 아니거나, 말줄임인데 title 이 없는 경우
    tbl.querySelectorAll("tbody td").forEach((td) => {
      const s = getComputedStyle(td);
      const over = td.scrollWidth > td.clientWidth + 1;
      if (!over) return;
      const txt = td.innerText.trim().slice(0, 20);
      if (!txt) return;
      if (s.textOverflow !== "ellipsis") { info.clipped.push(txt); return; }
      // Layout 이 hover 시 title 을 위임으로 채운다 — 그 경로가 동작하는지 흉내 내 확인한다.
      if (!td.getAttribute("title") && !td.querySelector("[title]")) {
        td.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        if (!td.getAttribute("title") && !td.querySelector("[title]")) info.noTitle.push(txt);
      }
    });
    info.clipped = [...new Set(info.clipped)].slice(0, 3);
    info.noTitle = [...new Set(info.noTitle)].slice(0, 3);
    out.push(info);
  });
  return { tables: out, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
}`;

const sessions = new Map();
async function pageFor(who, w, h) {
  const key = `${who}-${w}`;
  if (!sessions.has(key)) {
    const s = await newPage(b, { w, h });
    const email = who === "admin" ? (process.env.LM_ADMIN_EMAIL || "") : P[who].email;
    const pw = who === "admin" ? (process.env.LM_ADMIN_PW || "") : undefined;
    await uiLogin(s.page, email, pw);
    sessions.set(key, s);
  }
  return sessions.get(key).page;
}

for (const w of WIDTHS) {
  const bad = [];
  for (const pg of PAGES) {
    const page = await pageFor(pg.who, w, 900);
    await page.goto(BASE + pg.p, { waitUntil: "domcontentloaded" });
    await settle(page, 900);
    if (await page.locator('[data-testid="no-access"]').count()) continue;
    const r = await page.evaluate(`(${INSPECT})()`);
    for (const t of r.tables) {
      const probs = [];
      if (t.clipped.length) probs.push(`잘림 ${t.clipped.length}(${t.clipped.join("/")})`);
      if (t.noTitle.length) probs.push(`말줄임인데 title 없음 ${t.noTitle.length}(${t.noTitle.join("/")})`);
      if (t.headWrap.length) probs.push(`머리글 접힘·잘림 ${t.headWrap.map((x) => x.t).join("/")}`);
      if (t.overflowsWrap) probs.push("카드 밖으로 넘침");
      if (probs.length) bad.push(`${pg.label}#${t.ti}: ${probs.join(" · ")}`);
    }
    if (r.pageOverflow > 1) bad.push(`${pg.label}: 페이지 가로 스크롤 +${r.pageOverflow}px`);
  }
  chk(bad.length === 0, `${w}px 표 표시`, bad.slice(0, 4).join(" | "));
}

// 컬럼 폭 조절이 붙은 표는 실제로 끌어서 바뀌는가
{
  const page = await pageFor("phd", 1440, 900);
  for (const [path, col] of [["/board", "title"], ["/tasks", "title"]]) {
    await page.goto(BASE + path); await settle(page, 1200);
    const th = page.locator(`th[data-sort-key="${col}"]`);
    if (!(await th.count())) { chk(false, `${path} 정렬 가능한 머리글`); continue; }
    const before = Math.round((await th.boundingBox()).width);
    const bx = await th.boundingBox();
    await page.mouse.move(bx.x + bx.width - 3, bx.y + bx.height / 2);
    await page.mouse.down();
    await page.mouse.move(bx.x + bx.width - 3 - 90, bx.y + bx.height / 2, { steps: 8 });
    await page.mouse.up();
    await settle(page, 900);
    const after = Math.round((await th.boundingBox()).width);
    chk(Math.abs((before - after) - 90) <= 4, `${path} 컬럼 폭 끌어서 조절`, `${before} → ${after}`);
  }
}

// 폭 조절·정렬이 빠진 표를 찾아 알려 준다(있으면 안 되는 것은 아니지만 일관성 문제)
{
  const page = await pageFor("prof", 1440, 900);
  const missing = [];
  for (const pg of PAGES) {
    await page.goto(BASE + pg.p, { waitUntil: "domcontentloaded" });
    await settle(page, 800);
    if (await page.locator('[data-testid="no-access"]').count()) continue;
    const r = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll("table").forEach((t) => {
        const head = t.querySelectorAll("thead th").length;
        if (head < 3 || !t.querySelectorAll("tbody tr").length) return;   // 표다운 표만
        out.push({ head, sortable: t.querySelectorAll("th[data-sort-key]").length });
      });
      return out;
    });
    r.filter((t) => t.sortable === 0).forEach(() => missing.push(pg.label));
  }
  console.log(`\n정렬·폭조절 미적용 표: ${missing.length ? [...new Set(missing)].join(", ") : "없음"}`);
}

for (const s of sessions.values()) await s.ctx.close();
console.log(`\n결과: ${pass}/${pass + fail} 통과`);
await b.close();
