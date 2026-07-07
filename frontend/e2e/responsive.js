// 반응형 테이블 검증 — 여러 브라우저 폭에서 목록 페이지의 가로 오버플로우·컬럼 최소폭 측정 + 스크린샷.
// 토큰은 런타임에 JWT_SECRET(.env)으로 서명해 주입(비밀번호/시크릿 노출 없음).
const crypto = require("crypto");
const fs = require("fs");
const { chromium } = require("playwright");

const b64url = (b) => Buffer.from(b).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
function signJWT(payload, secret) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + 1800, jti: crypto.randomBytes(8).toString("hex") }));
  const sig = b64url(crypto.createHmac("sha256", secret).update(header + "." + body).digest());
  return `${header}.${body}.${sig}`;
}

const SECRET = process.env.JWT_SECRET;
const PROF_ID = process.env.PROF_ID;
if (!SECRET || !PROF_ID) { console.error("JWT_SECRET/PROF_ID 필요"); process.exit(2); }
const TOKEN = signJWT({ sub: PROF_ID, role: "prof", name: "E2E", delegated_admin: false, infra_manager: false, org: "lab1", type: "access" }, SECRET);

const BASE = "http://localhost:8090";
const WIDTHS = [360, 390, 768, 1024, 1440];
const PAGES = [
  ["/board", "board-table"],
  ["/grants", "project-table"],
  ["/notices", "notice-table"],
  ["/meetings", "meeting-table"],
  ["/tasks", "mytasks-table"],
  ["/approvals", null],
  ["/leave", "leave-table"],
  ["/expenses", "exp-table"],
  ["/budget", null],
  ["/audit", "audit-table"],
];
const SHOTS = "/work/shots";
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addInitScript((t) => { try { localStorage.setItem("lm_access", t); } catch (e) {} }, TOKEN);
  const page = await ctx.newPage();
  const report = [];
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 820 });
    for (const [path, testid] of PAGES) {
      let row = { w, path, ok: true, notes: [] };
      try {
        await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 20000 });
        if (page.url().includes("/login")) { row.ok = false; row.notes.push("LOGIN_REDIRECT"); report.push(row); continue; }
        await page.waitForSelector(".tbl", { timeout: 8000 }).catch(() => row.notes.push("no .tbl"));
        const info = await page.evaluate(() => {
          const de = document.documentElement;
          const pageOverflow = de.scrollWidth - de.clientWidth;
          const tbl = document.querySelector(".tbl");
          let cols = [], tblOverflow = 0, fit = false;
          if (tbl) {
            fit = tbl.classList.contains("fit");
            const sc = tbl.closest(".card, .scroll, [class*=card]") || tbl.parentElement;
            tblOverflow = tbl.scrollWidth - (sc ? sc.clientWidth : tbl.clientWidth);
            const ths = [...tbl.querySelectorAll("thead th")].filter((th) => th.getClientRects().length > 0);
            cols = ths.map((th) => ({ t: th.textContent.trim().slice(0, 8), w: Math.round(th.getBoundingClientRect().width) }));
          }
          return { pageOverflow, tblOverflow, cols, fit };
        });
        row.fit = info.fit;
        row.pageOverflow = info.pageOverflow;
        row.tblOverflow = info.tblOverflow;
        row.cols = info.cols;
        const minW = info.cols.length ? Math.min(...info.cols.map((c) => c.w)) : null;
        row.minCol = minW;
        if (info.pageOverflow > 2) { row.ok = false; row.notes.push(`PAGE_OVERFLOW ${info.pageOverflow}`); }
        if (info.fit && minW != null && minW < 32) { row.ok = false; row.notes.push(`TINY_COL ${minW}px`); }
        await page.screenshot({ path: `${SHOTS}/${w}${path.replace(/\//g, "_")}.png`, fullPage: false });
      } catch (e) { row.ok = false; row.notes.push("ERR " + String(e).slice(0, 80)); }
      report.push(row);
    }
  }
  await browser.close();
  fs.writeFileSync("/work/report.json", JSON.stringify(report, null, 1));
  // 요약 출력
  for (const r of report) {
    const cols = (r.cols || []).map((c) => `${c.t}:${c.w}`).join(" ");
    console.log(`${r.ok ? "OK " : "!! "} ${String(r.w).padStart(4)} ${r.path.padEnd(11)} fit=${r.fit ? "Y" : "n"} pOv=${r.pageOverflow ?? "-"} tOv=${r.tblOverflow ?? "-"} min=${r.minCol ?? "-"} ${r.notes.join(",")} | ${cols}`);
  }
  const bad = report.filter((r) => !r.ok).length;
  console.log(`\n=== ${report.length}건 중 문제 ${bad}건 ===`);
})().catch((e) => { console.error(e); process.exit(1); });
