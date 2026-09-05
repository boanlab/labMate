// 업무일 재현 2 — 석사·학부연구생·권한위임·교수 승인 사이클
import { newBrowser, newPage, uiLogin, settle, shot, save } from "./lib.mjs";
import { PERSONAS, BASE } from "./personas.mjs";
import { clickBtn, recorder } from "./helpers.mjs";

const P = Object.fromEntries(PERSONAS.map((p) => [p.key, p]));
const b = await newBrowser();
const findings = [];
const note = (sev, area, title, detail) => findings.push({ sev, area, title, detail: String(detail).slice(0, 400) });

async function session(key, label, fn) {
  const s = await newPage(b, { w: 1440, h: 900 });
  await uiLogin(s.page, P[key].email);
  const R = recorder(label);
  try { await fn(s.page, s.errors, R); } catch (e) { console.log("세션 예외:", String(e).slice(0, 200)); }
  const bad = R.report();
  bad.forEach((st) => note("BUG", label, st.label, st.err));
  s.errors.filter((e) => e.kind === "http" || e.kind === "pageerror").forEach((e) => note("ERR", label, e.kind, e.text));
  await s.ctx.close();
}

// ═══ 석사과정: 휴가 신청 + 자원예약 + 전자결재 기안
await session("master", "석사과정", async (page, errors, R) => {
  await R.run("휴가 신청", async () => {
    await page.goto(BASE + "/leave"); await settle(page);
    await clickBtn(page, "+ 휴가 신청");
    await page.locator('[data-testid="l-start_date"]').fill("2026-03-20");
    await page.locator('[data-testid="l-end_date"]').fill("2026-03-22");
    await page.locator('[data-testid="l-reason"]').fill("가족 행사 참석");
    const days = await page.locator('[data-testid="l-days"]').inputValue();
    await clickBtn(page, "신청");
    await settle(page, 1200);
    const ok = await page.evaluate(async () => {
      const r = await fetch("/api/attendance/leaves/me", { headers: { Authorization: "Bearer " + localStorage.getItem("lm_access") } });
      return (await r.json()).some((l) => (l.reason || "").includes("가족 행사 참석"));
    });
    if (!ok) throw new Error("신청 내역에 반영되지 않음");
    return `자동계산 일수=${days}`;
  });
  await shot(page, "wd-08-leave");

  await R.run("자원예약 — 시간 형식 안내 확인", async () => {
    await page.goto(BASE + "/booking"); await settle(page);
    await page.locator('[data-testid="booking-add-open"]').click();
    const meta = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="bk-start"]');
      return { type: s?.type, ph: s?.placeholder || "", pattern: s?.getAttribute("pattern") || "", value: s?.value || "" };
    });
    return `시작 필드: type=${meta.type} placeholder="${meta.ph}" pattern="${meta.pattern}"`;
  });

  await R.run("자원예약 등록(정상 형식)", async () => {
    // 앞 회차가 남긴 같은 슬롯 예약을 먼저 지운다 — 안 지우면 서버가 중복 예약을 정상 거절해(400)
    // 시나리오가 아니라 뒷정리 문제로 오류가 잡힌다.
    await page.evaluate(async () => {
      const H = { Authorization: "Bearer " + localStorage.getItem("lm_access") };
      const rows = await (await fetch("/api/resource/bookings", { headers: H })).json();
      for (const r of rows.filter((x) => x.date === "2027-03-11" && x.purpose === "논문 세미나 준비")) {
        await fetch(`/api/resource/bookings/${r.id}`, { method: "DELETE", headers: H });
      }
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await settle(page, 1200);
    await page.locator('[data-testid="booking-add-open"]').click(); await settle(page, 400);
    await page.locator('[data-testid="bk-date"]').fill("2027-03-11");   // 목록 기본 뷰가 '예정'이라 미래 날짜로 잡는다
    await page.locator('[data-testid="bk-start"]').fill("14:00");
    await page.locator('[data-testid="bk-end"]').fill("16:00");
    await page.locator('[data-testid="bk-purpose"]').fill("논문 세미나 준비");
    await clickBtn(page, "예약");
    await settle(page, 1200);
    const txt = await page.locator("body").innerText();
    if (!/논문 세미나 준비/.test(txt)) throw new Error("예약이 목록에 반영되지 않음");
    return "등록됨";
  });
  await shot(page, "wd-09-booking");

  // 날짜·시간 검증은 scripts/verify-dates.mjs 에서 전담한다
  await shot(page, "wd-10-booking-badtime");

  await R.run("전자결재 기안", async () => {
    await page.goto(BASE + "/approvals"); await settle(page);
    await clickBtn(page, "+ 기안 작성");
    await settle(page, 800);
    await page.locator('[data-testid="a-title"]').fill("학회 출장 신청 (KCC 2026)");
    const ed = page.locator(".ck-editor__editable").first();
    await ed.click(); await ed.type("한국컴퓨터종합학술대회 참가를 위한 출장을 신청합니다. 기간: 2026-06-24 ~ 06-26, 장소: 제주", { delay: 3 });
    // 결재선 지정
    const sel = page.locator('[data-testid="a-approver"]');
    if (await sel.count()) {
      const opts = await sel.locator("option").allTextContents();
      const target = opts.find((o) => /김지도/.test(o));
      if (target) await sel.selectOption({ label: target });   // 고르면 바로 결재선에 들어간다
      await settle(page, 500);
    }
    await clickBtn(page, "상신");
    await settle(page, 1500);
    const txt = await page.locator("body").innerText();
    if (!/KCC 2026/.test(txt)) throw new Error("상신 문서가 목록에 없음");
    return "상신 완료";
  });
  await shot(page, "wd-11-approval");
});

// ═══ 학부연구생: 출퇴근 + 공지 확인 + 업무 조회
await session("under", "학부연구생", async (page, errors, R) => {
  await R.run("출근 체크", async () => {
    await page.goto(BASE + "/attendance"); await settle(page);
    const btn = page.locator('[data-testid="att-checkin"]');
    // 출근한 뒤에는 이 버튼이 자리비움으로 바뀌어 사라진다(비활성이 아니라 없음).
    if (!(await btn.count())) return "이미 출근 처리됨(정상)";
    await btn.click();
    await settle(page, 1200);
    return (await page.locator("table").first().innerText()).split("\n").slice(1, 2).join("");
  });
  await R.run("필독 공지 확인", async () => {
    await page.goto(BASE + "/notices"); await settle(page);
    await page.locator('[data-testid="notice-search"]').fill("세미나 일정 안내"); await settle(page, 700);
    const txt = await page.locator("body").innerText();
    if (!/세미나 일정 안내/.test(txt)) throw new Error("공지가 보이지 않음");
    // 확인 처리 버튼
    const btns = await page.evaluate(() => [...document.querySelectorAll("table button")].filter((e) => e.offsetParent).map((e) => e.textContent.trim()));
    return `공지 노출됨. 표 내 버튼=${JSON.stringify(btns)}`;
  });
  await shot(page, "wd-12-under-notices");
  await R.run("접근 제한 화면 문구 확인", async () => {
    await page.goto(BASE + "/budget"); await settle(page);
    const el = page.locator('[data-testid="no-access"]');
    if (!await el.count()) throw new Error("접근 제한 안내가 없음");
    return await el.innerText();
  });
  await shot(page, "wd-13-under-denied");
});

// ═══ 권한위임(석사+행정): 연구비 집행 등록
await session("deleg", "권한위임", async (page, errors, R) => {
  await R.run("연구비집행 등록", async () => {
    await page.goto(BASE + "/expenses"); await settle(page);
    await clickBtn(page, "+ 집행 등록");
    await settle(page, 700);
    await page.locator('[data-testid="e-date"]').fill("2026-03-12");
    const cat = page.locator('[data-testid="e-category"]');
    const opts = await cat.locator("option").allTextContents();
    await cat.selectOption({ label: opts.find((o) => /재료비/.test(o)) || opts[1] });
    await page.locator('[data-testid="e-title"]').fill("GPU 서버용 NVMe SSD 4TB x2");
    await page.locator('[data-testid="e-amount"]').fill("3200000");
    await clickBtn(page, "등록");
    await settle(page, 1500);
    const txt = await page.locator("body").innerText();
    if (!/NVMe SSD/.test(txt)) throw new Error("집행 내역에 반영되지 않음");
    return "등록됨";
  });
  await shot(page, "wd-14-expense");
  await R.run("예산 집행률 반영 확인", async () => {
    await page.goto(BASE + "/budget"); await settle(page);
    const txt = await page.locator("table").first().innerText();
    if (!/3,200,000/.test(txt)) return `집행액이 요약표에 미반영: ${txt.split("\n").slice(0,2).join(" / ")}`;
    return "반영됨";
  });
  await shot(page, "wd-15-budget-after-expense");
});

// ═══ 지도교수: 승인 사이클
await session("prof", "지도교수(승인)", async (page, errors, R) => {
  await R.run("전자결재 수신함 확인·승인", async () => {
    await page.goto(BASE + "/approvals"); await settle(page);
    // 결재함은 페이징되므로 화면 텍스트 대신 서버 목록으로 확인한다
    const inbox = await page.evaluate(async () => {
      const r = await fetch("/api/boards/approvals/inbox", { headers: { Authorization: "Bearer " + localStorage.getItem("lm_access") } });
      return await r.json();
    });
    if (!inbox.some((a) => /KCC 2026/.test(a.title || ""))) throw new Error("수신 결재함에 상신 문서가 없음");
    const btns = await page.evaluate(() => [...document.querySelectorAll("table button")].filter((e) => e.offsetParent).map((e) => e.textContent.trim()));
    return `수신 ${inbox.length}건 · 처리 버튼=${JSON.stringify(btns.slice(0, 4))}`;
  });
  await shot(page, "wd-16-prof-approvals");
  await R.run("휴가 승인 화면 확인", async () => {
    await page.goto(BASE + "/leave"); await settle(page);
    const txt = await page.locator("body").innerText();
    return /가족 행사 참석/.test(txt) ? "석사 신청 건 노출됨" : "석사 신청 건이 교수 화면에 안 보임";
  });
  await shot(page, "wd-17-prof-leave");
  await R.run("근태 관리 화면 확인", async () => {
    await page.goto(BASE + "/att-admin"); await settle(page);
    const txt = await page.locator("body").innerText();
    return /이박사|정학부/.test(txt) ? "구성원 근태 노출됨" : "구성원 근태 미노출";
  });
  await shot(page, "wd-18-prof-attadmin");
});

save("workday2-findings.json", findings);
console.log("\n\n===== 발견 사항 =====");
findings.forEach((f) => console.log(`[${f.sev}] ${f.area} — ${f.title}\n     ${f.detail}`));
await b.close();
