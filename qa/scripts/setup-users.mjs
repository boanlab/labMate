// 페르소나 계정 생성 + 초기 비밀번호 변경(must_change_password 해제)
import { API, PERSONAS, PW, j, login } from "./personas.mjs";
import fs from "node:fs";
import path from "node:path";
import { OUT_DIR } from "./lib.mjs";

const ADMIN_EMAIL = process.env.LM_ADMIN_EMAIL;
const ADMIN_PW = process.env.LM_ADMIN_PW;
const TEMP = "TempPass!2026";

const admin = await login(ADMIN_EMAIL, ADMIN_PW);
const H = (t) => ({ Authorization: `Bearer ${t}` });

const existing = await j(`${API}/users`, { headers: H(admin.access) });
const byEmail = new Map((existing.body || []).map((u) => [u.email, u]));

for (const p of PERSONAS) {
  let u = byEmail.get(p.email);
  if (!u) {
    const r = await j(`${API}/users`, {
      method: "POST", headers: H(admin.access),
      body: JSON.stringify({ email: p.email, name: p.name, role: p.role, temp_password: TEMP }),
    });
    if (!r.ok) { console.error(`✗ ${p.key} 생성 실패`, r.status, r.body); continue; }
    u = r.body;
    console.log(`+ 생성 ${p.key} (${p.role}) ${p.email}`);
  } else {
    // 비밀번호를 알려진 값으로 재설정
    const r = await j(`${API}/users/${u.id}`, { method: "PATCH", headers: H(admin.access), body: JSON.stringify({ temp_password: TEMP }) });
    if (!r.ok) console.error(`✗ ${p.key} 임시비번 재설정 실패`, r.status, r.body);
    console.log(`= 기존 ${p.key} ${p.email}`);
  }
  if (p.delegated) {
    const r = await j(`${API}/users/${u.id}`, { method: "PATCH", headers: H(admin.access), body: JSON.stringify({ delegated_admin: true }) });
    if (!r.ok) console.error(`✗ ${p.key} 위임 설정 실패`, r.status, r.body);
  }
  // 첫 로그인 → 비밀번호 변경으로 must_change_password 해제
  const t = await login(p.email, TEMP);
  const cp = await j(`${API}/change-password`, {
    method: "POST", headers: H(t.access),
    body: JSON.stringify({ current_password: TEMP, new_password: PW }),
  });
  if (!cp.ok) { console.error(`✗ ${p.key} 비번변경 실패`, cp.status, cp.body); continue; }
  const chk = await login(p.email, PW);
  console.log(`  ✓ ${p.key} 준비완료 (must_change=${chk.must_change_password})`);
}

const all = await j(`${API}/users`, { headers: H(admin.access) });
fs.mkdirSync(path.join(OUT_DIR, "reports"), { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "reports", "users.json"), JSON.stringify(all.body, null, 2));
console.log(`\n총 사용자 ${all.body.length}명`);
