// 라벨 텍스트로 폼 컨트롤을 찾는 헬퍼 (label-input 연결이 없는 마크업 대응)
export function fieldByLabel(page, label) {
  return page.locator(`div:has(> label:text-is("${label}")) >> :is(input,select,textarea)`).first();
}
export function fieldByLabelContains(page, label) {
  return page.locator(`div:has(> label:has-text("${label}")) >> :is(input,select,textarea)`).first();
}
export async function fillLabel(page, label, value) {
  const el = fieldByLabelContains(page, label);
  await el.waitFor({ state: "visible", timeout: 8000 });
  const info = await el.evaluate((e) => ({ tag: e.tagName.toLowerCase(), type: (e.type || "").toLowerCase() }));
  if (info.tag === "select") { await el.selectOption({ label: value }); return; }
  // date/time/number 등 특수 입력은 타이핑 대신 fill (브라우저 파싱 규칙 회피)
  if (["date", "time", "datetime-local", "month", "number"].includes(info.type)) { await el.fill(value); return; }
  await el.click(); await el.fill(""); await el.type(value, { delay: 8 });
}
export async function clickBtn(page, name, { exact = true, nth = 0 } = {}) {
  const b = page.getByRole("button", { name, exact }).nth(nth);
  await b.waitFor({ state: "visible", timeout: 8000 });
  await b.click();
}
/** 단계 결과 기록기 */
export function recorder(name) {
  const steps = [];
  return {
    steps,
    async run(label, fn) {
      const t0 = Date.now();
      try { const v = await fn(); steps.push({ label, ok: true, ms: Date.now() - t0, note: typeof v === "string" ? v : undefined }); return v; }
      catch (e) { steps.push({ label, ok: false, ms: Date.now() - t0, err: String(e).split("\n").slice(0, 4).join(" | ").slice(0, 500) }); return null; }
    },
    report() {
      const bad = steps.filter((s) => !s.ok);
      console.log(`\n── ${name}: ${steps.length - bad.length}/${steps.length} 성공`);
      for (const s of steps) console.log(`  ${s.ok ? "✓" : "✗"} ${s.label}${s.ok ? "" : "\n      " + s.err}${s.note ? "\n      " + s.note : ""}`);
      return bad;
    },
  };
}
