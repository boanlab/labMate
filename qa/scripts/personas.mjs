// 페르소나 정의 — LabMate 역할 체계에 대응
export const BASE = process.env.LM_BASE || "http://localhost:8080";
export const API = `${BASE}/api/members`;
export const PW = "LabmateQA!2026";

export const PERSONAS = [
  { key: "prof",   email: "prof.qa@qa.kloud.zone",   name: "김지도",  role: "prof",   label: "지도교수",   delegated: false },
  { key: "phd",    email: "phd.qa@qa.kloud.zone",    name: "이박사",  role: "phd",    label: "박사과정",   delegated: false },
  { key: "master", email: "master.qa@qa.kloud.zone", name: "최석사",  role: "master", label: "석사과정",   delegated: false },
  { key: "under",  email: "under.qa@qa.kloud.zone",  name: "정학부",  role: "under",  label: "학부연구생", delegated: false },
  { key: "deleg",  email: "deleg.qa@qa.kloud.zone",  name: "한위임",  role: "master", label: "권한위임",   delegated: true  },
];

export async function j(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
  const txt = await r.text();
  let body; try { body = txt ? JSON.parse(txt) : null; } catch { body = txt; }
  return { ok: r.ok, status: r.status, body };
}

export async function login(email, password) {
  const r = await j(`${API}/login`, { method: "POST", body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error(`login ${email} 실패: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
