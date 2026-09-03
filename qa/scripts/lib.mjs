import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, PW } from "./personas.mjs";

// 산출물(리포트·스크린샷) 위치 — 실행 위치와 무관하게 qa/out/ 아래.
export const OUT_DIR = process.env.LM_OUT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "out");

export const ROUTES = [
  { p: "/",             label: "대시보드" },
  { p: "/calendar",     label: "캘린더" },
  { p: "/grants",       label: "연구과제" },
  { p: "/projects",     label: "프로젝트" },
  { p: "/tasks",        label: "세부업무" },
  { p: "/notes",        label: "연구노트" },
  { p: "/approvals",    label: "전자결재" },
  { p: "/booking",      label: "자원예약" },
  { p: "/notices",      label: "공지사항" },
  { p: "/board",        label: "게시판" },
  { p: "/meetings",     label: "회의록" },
  { p: "/budget",       label: "예산" },
  { p: "/payroll",      label: "학생인건비" },
  { p: "/expenses",     label: "연구비집행" },
  { p: "/attendance",   label: "출퇴근" },
  { p: "/leave",        label: "휴가" },
  { p: "/members",      label: "구성원" },
  { p: "/att-admin",    label: "근태관리" },
  { p: "/publications", label: "실적" },
  { p: "/library",      label: "교육" },
  { p: "/archive",      label: "아카이브" },
  { p: "/assets",       label: "자산" },
  { p: "/infra",        label: "인프라" },
  { p: "/mypage",       label: "마이페이지" },
];

export const VIEWPORTS = [
  { w: 360,  h: 740,  name: "phone-360" },
  { w: 390,  h: 844,  name: "phone-390" },
  { w: 768,  h: 1024, name: "tablet-768" },
  { w: 1024, h: 768,  name: "tablet-land-1024" },
  { w: 1280, h: 800,  name: "laptop-1280" },
  { w: 1920, h: 1080, name: "desktop-1920" },
];

export async function newBrowser() {
  return chromium.launch({ args: ["--disable-dev-shm-usage"] });
}

/** 새 컨텍스트 + 콘솔/네트워크 오류 수집기 부착 */
export async function newPage(browser, { w = 1280, h = 800 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push({ kind: "console", text: m.text().slice(0, 400), url: page.url() });
  });
  page.on("pageerror", (e) => errors.push({ kind: "pageerror", text: String(e).slice(0, 400), url: page.url() }));
  page.on("requestfailed", (r) => {
    const f = r.failure()?.errorText || "";
    if (!/ERR_ABORTED/.test(f)) errors.push({ kind: "netfail", text: `${r.method()} ${r.url()} — ${f}`, url: page.url() });
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && r.url().includes("/api/")) {
      errors.push({ kind: "http", text: `${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`, url: page.url() });
    }
  });
  page._lmErrors = errors;
  return { ctx, page, errors };
}

/** 실제 사용자처럼 로그인 폼을 채워 로그인 */
export async function uiLogin(page, email, password = PW) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="login-email"]', { timeout: 15000 });
  await page.fill('[data-testid="login-email"]', email);
  await page.fill('[data-testid="login-password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 }),
    page.click('[data-testid="login-submit"]'),
  ]);
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** 페이지가 안정될 때까지 대기 */
export async function settle(page, ms = 700) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
}

/** 브라우저 안에서 레이아웃 결함을 탐지 */
export const AUDIT_FN = `() => {
  const out = { hOverflow: null, offenders: [], clipped: [], tiny: [], overlaps: [], contrast: [] };
  const de = document.documentElement;
  const vw = window.innerWidth;
  if (de.scrollWidth > vw + 1) out.hOverflow = { scrollWidth: de.scrollWidth, viewport: vw, excess: de.scrollWidth - vw };

  const els = Array.from(document.querySelectorAll('body *'));
  const vis = (el) => {
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && el.offsetParent !== null;
  };
  const desc = (el) => {
    const id = el.id ? '#' + el.id : '';
    const cls = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\\s+/).slice(0,3).join('.') : '';
    const tid = el.getAttribute && el.getAttribute('data-testid') ? '[' + el.getAttribute('data-testid') + ']' : '';
    return el.tagName.toLowerCase() + id + cls + tid;
  };

  for (const el of els) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const s = getComputedStyle(el);

    // 1) 뷰포트 오른쪽 밖으로 밀려난 요소(스크롤 컨테이너 내부는 제외)
    if (r.right > vw + 1 && r.width < vw * 3) {
      let inScroller = false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (/(auto|scroll)/.test(ps.overflowX)) { inScroller = true; break; }
      }
      if (!inScroller) out.offenders.push({ sel: desc(el), right: Math.round(r.right), vw, text: (el.textContent||'').trim().slice(0,60) });
    }

    // 2) 텍스트가 잘림 — overflow hidden 이면서 내용이 넘침
    const leaf = el.children.length === 0 && (el.textContent||'').trim().length > 0;
    if (leaf && /hidden|clip/.test(s.overflowX + s.overflowY)) {
      if (el.scrollWidth > el.clientWidth + 1 && s.textOverflow !== 'ellipsis') {
        out.clipped.push({ sel: desc(el), scrollW: el.scrollWidth, clientW: el.clientWidth, text: (el.textContent||'').trim().slice(0,60), ellipsis: false });
      } else if (el.scrollHeight > el.clientHeight + 2) {
        out.clipped.push({ sel: desc(el), scrollH: el.scrollHeight, clientH: el.clientHeight, text: (el.textContent||'').trim().slice(0,60), vertical: true });
      }
    }

    // 3) 터치 타깃 과소(모바일)
    if (vw <= 480 && /^(button|a)$/.test(el.tagName.toLowerCase()) && (el.textContent||'').trim()) {
      if ((r.height > 0 && r.height < 32) || (r.width > 0 && r.width < 24)) {
        out.tiny.push({ sel: desc(el), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent||'').trim().slice(0,40) });
      }
    }
  }
  // 중복 제거
  const uniq = (arr, k) => { const m = new Map(); for (const x of arr) if (!m.has(k(x))) m.set(k(x), x); return [...m.values()]; };
  out.offenders = uniq(out.offenders, x => x.sel + x.text).slice(0, 25);
  out.clipped   = uniq(out.clipped,   x => x.sel + x.text).slice(0, 25);
  out.tiny      = uniq(out.tiny,      x => x.sel + x.text).slice(0, 25);
  return out;
}`;

export async function audit(page) {
  return page.evaluate(`(${AUDIT_FN})()`);
}

export function save(name, data) {
  const f = path.join(OUT_DIR, "reports", name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data, null, 2));
  return f;
}

export async function shot(page, name) {
  const f = path.join(OUT_DIR, "shots", name.replace(/[^\w.-]/g, "_") + ".png");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  await page.screenshot({ path: f, fullPage: false });
  return f;
}
