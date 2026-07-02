import { useEffect, useRef, useState } from "react";
import { todayKST } from "../lib/date";
import { PageHeader, Card } from "../ui/kit";
import { useAuth } from "../auth/AuthContext";
import { api, apiError } from "../api/client";
import { confirmDialog } from "../ui/dialog";
import HtmlEditor from "../ui/HtmlEditorLazy";
import { SheetImport } from "../ui/SheetImport";
import { SHEETS } from "../ui/sheets";
import { saveConfig, clearConfigCache, CONFIG_SERVICE, fileUrl } from "../api/config";

// 역할별 모듈 접근 매트릭스(프론트 표현용 — 실제 권한은 각 서비스가 강제)
const MODULES = ["대시보드", "캘린더", "연구과제", "프로젝트", "전자결재", "자원예약", "공지", "게시판", "회의록", "연구비집행", "예산", "학생인건비", "근태", "휴가", "구성원", "실적", "교육", "자산", "인프라"];
function perm(role: string, mod: string): "rw" | "r" | "-" {
  // 관리자(admin)는 대시보드·구성원·환경설정만
  if (role === "admin") return mod === "대시보드" || mod === "구성원" ? "rw" : "-";
  const manage = role === "prof" || role === "staff";   // 도메인 관리자급
  switch (mod) {
    case "예산": case "연구비집행": return manage ? "rw" : "-";                // 연구비=교수·행정만
    case "학생인건비": return manage ? "rw" : "r";                                // 학생 전원 내 지급 조회
    case "구성원": return (role === "staff" || role === "prof") ? "rw" : "r";  // 관리=지도교수·행정, 그 외 조회
    case "휴가": return "rw";                                                 // 전원 신청 가능(학사 포함)
    case "연구과제": return role === "prof" ? "rw" : "r";                      // 생성·수정=교수·위임, 그 외 조회
    case "전자결재": case "프로젝트": case "자원예약": case "게시판": case "회의록": case "교육":
      return role === "staff" ? "-" : "rw";                                   // 행정 차단(위임 학생은 본인 역할로 접근)
    case "실적": case "자산": case "인프라": return manage ? "rw" : "r";       // 관리=교수·행정, 학생 전원 조회
    default: return "rw";
  }
}
const ROLES = [["prof", "지도교수"], ["phd", "박사과정"], ["master", "석사과정"], ["under", "학사과정"], ["staff", "행정"], ["admin", "관리자"]];

// 편집 가능한 마스터데이터 — 사용자 사이드 메뉴 그룹에 매핑
const MASTER_MENU: { group: string; items: { key: string; label: string; required?: string[] }[] }[] = [
  { group: "메인", items: [{ key: "event_types", label: "캘린더 일정 구분" }] },
  { group: "업무", items: [
    { key: "project_types", label: "과제 분류", required: ["과제"] },
    { key: "agencies", label: "전담기관" },
    { key: "approval_types", label: "결재 문서유형 · 양식" },
    { key: "booking_resources", label: "예약 자원" },
  ] },
  { group: "소통", items: [{ key: "post_types", label: "게시판 분류" }] },
  { group: "연구비", items: [
    { key: "budget_types", label: "비목·세목" },
    { key: "grade_rates", label: "학생인건비 기준단가" },
  ] },
  { group: "인사", items: [
    { key: "attendance_states", label: "근태 상태" },
    { key: "leave_types", label: "휴가 종류" },
    { key: "annual_leave_default", label: "연 부여 연차(일)" },
  ] },
  { group: "연구실", items: [
    { key: "pub_types", label: "실적 종류", required: ["국제논문지", "국내논문지", "국제학술대회", "국내학술대회", "국제특허", "국내특허"] },
    { key: "course_types", label: "교육 분류" },
    { key: "lesson_types", label: "강의 구성 유형" },
    { key: "asset_types", label: "자산 분류" },
    { key: "device_types", label: "장비 종류" },
  ] },
];

// 객체 배열 필드 한글 라벨
const FIELD_KO: Record<string, string> = { name: "이름", subs: "세목", deduct: "차감", fraction: "일수", prefix: "문서번호 접두" };

function ListEditor({ value, onChange, locked = [] }: { value: string[]; onChange: (v: string[]) => void; locked?: string[] }) {
  return (
    <div>
      {value.map((it, i) => {
        const lk = locked.includes(it);
        return (
          <div key={i} className="cfg-row">
            <input value={it} placeholder="항목" disabled={lk} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} />
            {lk ? <span className="badge s-info" style={{ flexShrink: 0 }} title="시스템 필수 항목 — 삭제할 수 없습니다">필수</span>
              : <button type="button" className="cfg-x" title="삭제" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>}
          </div>
        );
      })}
      <button type="button" className="btn ghost sm" onClick={() => onChange([...value, ""])}>+ 항목 추가</button>
    </div>
  );
}
function MapNumberEditor({ value, onChange }: { value: Record<string, number>; onChange: (v: any) => void }) {
  return (
    <table className="cfg-kv"><tbody>
      {Object.entries(value).map(([key, v]) => (
        <tr key={key}><th>{key}</th><td><input type="number" value={v} onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) })} /> <span className="muted small">원</span></td></tr>
      ))}
    </tbody></table>
  );
}
function MapTextEditor({ value, onChange }: { value: Record<string, string>; onChange: (v: any) => void }) {
  return (
    <div>
      {Object.entries(value).map(([key, v]) => (
        <div key={key} style={{ marginBottom: 10 }}>
          <label className="muted small">{key}</label>
          <textarea value={v} onChange={(e) => onChange({ ...value, [key]: e.target.value })} style={{ width: "100%", minHeight: 56, fontSize: 12.5 }} />
        </div>
      ))}
    </div>
  );
}
function ObjArrayEditor({ value, onChange }: { value: any[]; onChange: (v: any[]) => void }) {
  const fields = Array.from(new Set(value.flatMap((o) => Object.keys(o))));
  const ftype = (f: string) => { for (const o of value) if (o[f] !== undefined) return Array.isArray(o[f]) ? "array" : typeof o[f]; return "string"; };
  const upd = (i: number, f: string, v: any) => onChange(value.map((o, j) => (j === i ? { ...o, [f]: v } : o)));
  function addItem() { const blank: any = {}; fields.forEach((f) => { const t = ftype(f); blank[f] = t === "array" ? [] : t === "number" ? 0 : t === "boolean" ? false : ""; }); onChange([...value, blank]); }
  return (
    <div>
      {value.map((o, i) => (
        <div key={i} className="cfg-obj">
          {fields.map((f) => {
            const t = ftype(f);
            return (
              <span key={f} className="cfg-objf" style={t === "array" ? { flex: "2 1 340px" } : undefined}>
                <label className="muted small">{FIELD_KO[f] || f}</label>
                {t === "boolean" ? <input type="checkbox" checked={!!o[f]} onChange={(e) => upd(i, f, e.target.checked)} />
                  : t === "number" ? <input type="number" value={o[f] ?? 0} onChange={(e) => upd(i, f, Number(e.target.value))} />
                    : t === "array" ? <input style={{ width: "100%" }} value={(o[f] || []).join(", ")} placeholder="쉼표로 구분" onChange={(e) => upd(i, f, e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))} />
                      : <input value={o[f] ?? ""} onChange={(e) => upd(i, f, e.target.value)} />}
              </span>
            );
          })}
          <button type="button" className="cfg-x" title="삭제" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="btn ghost sm" onClick={addItem}>+ 항목 추가</button>
    </div>
  );
}

// 결재 문서유형·양식 편집
function ApprovalEditor() {
  const [types, setTypes] = useState<any[]>([]);
  const tpls = useRef<Record<number, string>>({});
  const nextK = useRef(0);
  const [sel, setSel] = useState(0);
  const [msg, setMsg] = useState("");
  const [tpl, setEditor] = useState("");

  async function load() {
    clearConfigCache("boards");
    try {
      const { data } = await api.get("/boards/config");
      const ts = (data.approval_types || []).map((t: any) => ({ ...t, _k: nextK.current++ }));
      const tmpl = data.approval_templates || {};
      tpls.current = {};
      ts.forEach((t: any) => { tpls.current[t._k] = tmpl[t.name] || ""; });
      setTypes(ts); setSel(0); setMsg("");
      setEditor(ts[0] ? tpls.current[ts[0]._k] : "");
    } catch (e) { setMsg(apiError(e)); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  function commit() { const cur = types[sel]; if (cur) tpls.current[cur._k] = tpl; }
  function pick(i: number) { commit(); setSel(i); setEditor(types[i] ? tpls.current[types[i]._k] : ""); }
  function upd(i: number, f: string, v: string) { setTypes(types.map((t, j) => (j === i ? { ...t, [f]: v } : t))); }
  function add() { commit(); const k = nextK.current++; tpls.current[k] = ""; const nt = [...types, { name: "새 유형", prefix: "DOC", _k: k }]; setTypes(nt); setSel(nt.length - 1); setEditor(""); }
  function remove(i: number) { delete tpls.current[types[i]._k]; const nt = types.filter((_, j) => j !== i); const ns = Math.max(0, Math.min(sel, nt.length - 1)); setTypes(nt); setSel(ns); setEditor(nt[ns] ? tpls.current[nt[ns]._k] : ""); }
  async function save() {
    commit();
    if (types.some((t) => !t.name.trim())) { setMsg("유형 이름을 입력하세요"); return; }
    const at = types.map(({ _k, ...t }) => t);
    const tm: Record<string, string> = {};
    types.forEach((t) => { tm[t.name] = tpls.current[t._k] || ""; });
    try { await saveConfig("boards", "approval_types", at); await saveConfig("boards", "approval_templates", tm); setMsg("저장됨 ✓"); }
    catch (e) { setMsg(apiError(e)); }
  }

  return (
    <div className="cfg-field" data-testid="cfg-approval">
      <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span><b>결재 문서유형 · 양식</b></span><span className="muted small">{msg}</span></label>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginTop: 6 }}>
        <div style={{ width: 180, flexShrink: 0 }}>
          {types.map((t, i) => (
            <div key={t._k} className={"cfg-side-item" + (sel === i ? " on" : "")} style={{ display: "flex", alignItems: "center", gap: 2, padding: "4px 6px" }}>
              <button type="button" data-testid={`appr-type-${i}`} style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} onClick={() => pick(i)}>{t.name || "(이름 없음)"}</button>
              <button type="button" className="cfg-x" title="삭제" onClick={() => remove(i)}>✕</button>
            </div>
          ))}
          <button type="button" className="btn ghost sm" style={{ marginTop: 6 }} data-testid="appr-add" onClick={add}>+ 유형 추가</button>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {types[sel] ? (
            <>
              <div className="grid2" style={{ marginBottom: 8 }}>
                <div><label className="muted small">유형 이름</label><input data-testid="appr-name" value={types[sel].name} onChange={(e) => upd(sel, "name", e.target.value)} /></div>
                <div><label className="muted small">문서번호 접두</label><input data-testid="appr-prefix" value={types[sel].prefix || ""} onChange={(e) => upd(sel, "prefix", e.target.value)} /></div>
              </div>
              <label className="muted small">문서 양식 <span className="muted">(기안 시 본문에 채워질 기본 양식)</span></label>
              <HtmlEditor value={tpl} onChange={setEditor} testid="appr-tpl" minHeight={140} />
            </>
          ) : <div className="muted small">유형을 추가하세요.</div>}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button className="btn primary sm" data-testid="cfg-save-approval" onClick={save}>저장</button>
        <button className="btn ghost sm" onClick={load}>되돌리기</button>
      </div>
    </div>
  );
}

function ConfigField({ service, k, label, required }: { service: string; k: string; label: string; required?: string[] }) {
  const [val, setVal] = useState<any>(undefined);
  const [orig, setOrig] = useState("");
  const [msg, setMsg] = useState("");
  const [raw, setRaw] = useState(false);
  const [rawText, setRawText] = useState("");
  async function load() {
    try {
      clearConfigCache(service);
      const { data } = await api.get(`/${service}/config`);
      setVal(data[k]); setOrig(JSON.stringify(data[k])); setMsg("");
    } catch (e) { setMsg(apiError(e)); }
  }
  useEffect(() => { load(); }, [service, k]);

  const current = raw ? (() => { try { return JSON.parse(rawText); } catch { return undefined; } })() : val;
  const dirty = current !== undefined && JSON.stringify(current) !== orig;
  async function save() {
    if (current === undefined) { setMsg("JSON 형식 오류"); return; }
    if (required && Array.isArray(current)) {
      const missing = required.filter((r) => !current.includes(r));
      if (missing.length) { setMsg(`필수 항목 '${missing.join(", ")}'은(는) 삭제할 수 없습니다`); return; }
    }
    try { await saveConfig(service, k, current); setVal(current); setOrig(JSON.stringify(current)); setMsg("저장됨 ✓"); }
    catch (e) { setMsg(apiError(e)); }
  }
  function toggleRaw() {
    if (!raw) setRawText(JSON.stringify(val, null, 2));
    else { try { setVal(JSON.parse(rawText)); } catch { /* keep */ } }
    setRaw((v) => !v);
  }

  function editor() {
    if (val === undefined) return <span className="muted small">불러오는 중…</span>;
    if (typeof val === "number") return <input type="number" value={val} onChange={(e) => setVal(Number(e.target.value))} style={{ width: 120 }} />;
    if (typeof val === "string") return <input value={val} onChange={(e) => setVal(e.target.value)} />;
    if (Array.isArray(val)) return (val.length === 0 || typeof val[0] === "string")
      ? <ListEditor value={val} onChange={setVal} locked={required} /> : <ObjArrayEditor value={val} onChange={setVal} />;
    if (val && typeof val === "object") return Object.values(val).every((v) => typeof v === "number")
      ? <MapNumberEditor value={val} onChange={setVal} /> : <MapTextEditor value={val} onChange={setVal} />;
    return null;
  }

  return (
    <div className="cfg-field" data-testid={`cfg-${k}`}>
      <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span><b>{label}</b></span>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {msg && <span className="muted small">{msg}</span>}
          <button type="button" className="lnk small" data-testid={`cfg-raw-${k}`} onClick={toggleRaw}>{raw ? "양식으로" : "JSON으로"}</button>
        </span>
      </label>
      {raw
        ? <textarea data-testid={`cfg-raw-text-${k}`} value={rawText} onChange={(e) => setRawText(e.target.value)} style={{ width: "100%", minHeight: 92, fontFamily: "monospace", fontSize: 12.5 }} />
        : <div style={{ marginTop: 4 }}>{editor()}</div>}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button className="btn primary sm" data-testid={`cfg-save-${k}`} disabled={!dirty} onClick={save}>저장</button>
        <button className="btn ghost sm" disabled={!dirty} onClick={() => { setVal(JSON.parse(orig)); setRaw(false); }}>되돌리기</button>
      </div>
    </div>
  );
}

function BrandingPanel() {
  const [logo, setLogo] = useState("");
  const [name, setName] = useState("");
  const [base, setBase] = useState("");
  const [loginLogo, setLoginLogo] = useState("");
  const [loginSub, setLoginSub] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    clearConfigCache("boards");
    try { const { data } = await api.get("/boards/config"); setLogo(data.brand_logo || ""); setName(data.lab_name || ""); setBase(data.base_url || ""); setLoginLogo(data.login_logo || ""); setLoginSub(data.login_subtitle || ""); }
    catch (e) { setMsg(apiError(e)); }
  }
  useEffect(() => { load(); }, []);
  async function uploadOne(file: File): Promise<string> {
    const fd = new FormData(); fd.append("files", file);
    const r = await api.post<{ url: string }[]>("/projects/uploads", fd, { headers: { "Content-Type": "multipart/form-data" } });
    return r.data?.[0]?.url || "";
  }
  async function uploadLogo(file: File) {
    setBusy(true); setMsg("업로드 중…");
    try { const url = await uploadOne(file); if (url) { await saveConfig("boards", "brand_logo", url); setLogo(url); setMsg("로고 적용됨 ✓"); } }
    catch (e) { setMsg(apiError(e)); } finally { setBusy(false); }
  }
  async function removeLogo() { try { await saveConfig("boards", "brand_logo", ""); setLogo(""); setMsg("기본 로고로 변경됨"); } catch (e) { setMsg(apiError(e)); } }
  async function uploadLoginLogo(file: File) {
    setBusy(true); setMsg("업로드 중…");
    try { const url = await uploadOne(file); if (url) { await saveConfig("boards", "login_logo", url); setLoginLogo(url); setMsg("로그인 로고 적용됨 ✓"); } }
    catch (e) { setMsg(apiError(e)); } finally { setBusy(false); }
  }
  async function removeLoginLogo() { try { await saveConfig("boards", "login_logo", ""); setLoginLogo(""); setMsg("기본 로고로 변경됨"); } catch (e) { setMsg(apiError(e)); } }
  async function saveLoginSub() { try { await saveConfig("boards", "login_subtitle", loginSub.trim()); setMsg("저장됨 ✓"); } catch (e) { setMsg(apiError(e)); } }
  async function saveName() { try { await saveConfig("boards", "lab_name", name.trim()); setMsg("저장됨 ✓"); } catch (e) { setMsg(apiError(e)); } }
  async function saveBase() { try { const v = base.trim().replace(/\/+$/, ""); setBase(v); await saveConfig("boards", "base_url", v); setMsg("저장됨 ✓"); } catch (e) { setMsg(apiError(e)); } }
  return (
    <div className="g2">
      <Card title="로그인 화면" testid="brand-login-card">
        <div className="muted small" style={{ marginBottom: 8 }}>로그인 페이지의 로고와 부제입니다. 로고가 없으면 <b>(L) LabMate</b>, 부제가 없으면 <b>연구실 그룹웨어</b>가 표시됩니다.</div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
          <div style={{ width: 150, height: 44, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--soft)", border: "1px solid var(--line2)", borderRadius: 8 }}>
            {loginLogo ? <img src={fileUrl(loginLogo)} alt="로고" style={{ maxWidth: 140, maxHeight: 38 }} /> : <span className="muted small">기본 (L) LabMate</span>}
          </div>
          {loginLogo && <button className="btn ghost sm" data-testid="brand-login-logo-remove" onClick={removeLoginLogo}>기본 로고 사용</button>}
        </div>
        <input type="file" accept="image/*" data-testid="brand-login-logo-upload" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLoginLogo(f); e.target.value = ""; }} />
        <label style={{ marginTop: 12 }}>로그인 부제 <span className="muted small">(기본값: "연구실 그룹웨어")</span></label>
        <div style={{ display: "flex", gap: 6 }}>
          <input data-testid="brand-login-sub" value={loginSub} placeholder="예: 소규모 연구실 그룹웨어 · 단독 운영" onChange={(e) => setLoginSub(e.target.value)} />
          <button className="btn primary sm" data-testid="brand-login-sub-save" onClick={saveLoginSub}>저장</button>
        </div>
      </Card>
      <Card title="상단 바 로고" testid="brand-logo-card">
        <div className="muted small" style={{ marginBottom: 8 }}>로고 이미지를 올리면 상단 바에 표시됩니다. 없으면 기본 <b>(L) LabMate</b>가 보입니다.</div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
          <div style={{ width: 150, height: 44, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--soft)", border: "1px solid var(--line2)", borderRadius: 8 }}>
            {logo ? <img src={fileUrl(logo)} alt="로고" style={{ maxWidth: 140, maxHeight: 38 }} /> : <span className="muted small">기본 (L) LabMate</span>}
          </div>
          {logo && <button className="btn ghost sm" data-testid="brand-logo-remove" onClick={removeLogo}>기본 로고 사용</button>}
        </div>
        <input type="file" accept="image/*" data-testid="brand-logo-upload" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ""; }} />
      </Card>
      <Card title="연구실 이름 · 도메인" testid="brand-meta-card">
        <label>연구실 이름 <span className="muted small">(기본값: "연구실 그룹웨어")</span></label>
        <div style={{ display: "flex", gap: 6 }}>
          <input data-testid="brand-name" value={name} placeholder="예: OOO 연구실" onChange={(e) => setName(e.target.value)} />
          <button className="btn primary sm" data-testid="brand-name-save" onClick={saveName}>저장</button>
        </div>
        <label style={{ marginTop: 12 }}>도메인 주소 <span className="muted small">(기본값: 현재 접속 주소)</span></label>
        <div style={{ display: "flex", gap: 6 }}>
          <input data-testid="brand-base" value={base} placeholder="예: https://lab.example.com" onChange={(e) => setBase(e.target.value)} />
          <button className="btn primary sm" data-testid="brand-base-save" onClick={saveBase}>저장</button>
        </div>
        <div className="muted small" style={{ marginTop: 6 }}>설정 시 새로 업로드되는 이미지·파일 경로를 이 도메인으로 생성합니다.</div>
        {msg && <div className="io" style={{ marginTop: 12, marginBottom: 0 }} data-testid="brand-msg">{msg}</div>}
      </Card>
    </div>
  );
}

export default function Admin() {
  const { me } = useAuth();
  const isAdmin = me?.role === "admin";
  const [tab, setTab] = useState<"perm" | "config" | "brand" | "data" | "sheet">("brand");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const SERVICES = ["members", "projects", "funds", "attendance", "boards", "resource"];
  const [cfgGroup, setCfgGroup] = useState(MASTER_MENU[0].group);
  const [sheetResult, setSheetResult] = useState<{ label: string; msg: string; errors: string[] } | null>(null);
  const [pubTabs, setPubTabs] = useState<{ name: string; cols: [string, string][] }[]>([]);
  useEffect(() => {
    if (tab === "sheet" && isAdmin && SHEETS.publications.buildTabs) {
      SHEETS.publications.buildTabs().then((ts) => setPubTabs(ts.map((t) => ({ name: t.name, cols: t.cols })))).catch(() => {});
    }
  }, [tab]);

  async function doExport() {
    setBusy(true); setMsg("내보내는 중…");
    try {
      const out: any = { app: "LabMate", version: 1, exported_at: new Date().toISOString(), services: {} };
      for (const s of SERVICES) out.services[s] = (await api.get(`/${s}/admin/data/export`)).data;
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `labmate-backup-${todayKST()}.json`; a.click();
      URL.revokeObjectURL(url);
      const total = Object.values(out.services).reduce((n: number, sv: any) => n + Object.values(sv.tables || {}).reduce((m: number, r: any) => m + r.length, 0), 0);
      setMsg(`백업 완료 — 총 ${total}건을 파일로 내려받았습니다.`);
    } catch (e) { setMsg(apiError(e)); } finally { setBusy(false); }
  }
  async function doImport(file: File) {
    if (!await confirmDialog("⚠ 현재 모든 데이터를 백업본으로 덮어씁니다(되돌릴 수 없음). 계속할까요?")) return;
    setBusy(true); setMsg("복구 중…");
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== "LabMate" || !data.services) throw new Error("LabMate 백업 파일이 아닙니다");
      const done: string[] = [];
      for (const s of Object.keys(data.services)) { await api.post(`/${s}/admin/data/import`, data.services[s]); done.push(s); }
      setMsg(`복구 완료: ${done.join(", ")}. 변경 반영을 위해 새로고침하세요.`);
    } catch (e: any) { setMsg(e?.message?.includes("JSON") ? "JSON 파싱 오류 — 올바른 백업 파일인지 확인하세요" : apiError(e)); }
    finally { setBusy(false); }
  }

  return (
    <div data-testid="page-admin">
      <PageHeader crumb="관리 › 환경설정" title="환경설정" />
      <div className="fchips" style={{ marginBottom: 12 }}>
        <button className={"chip" + (tab === "brand" ? " on" : "")} data-testid="admin-tab-brand" onClick={() => setTab("brand")}>브랜딩</button>
        <button className={"chip" + (tab === "config" ? " on" : "")} data-testid="admin-tab-config" onClick={() => setTab("config")}>마스터데이터</button>
        <button className={"chip" + (tab === "sheet" ? " on" : "")} data-testid="admin-tab-sheet" onClick={() => setTab("sheet")}>시트 가져오기</button>
        <button className={"chip" + (tab === "data" ? " on" : "")} data-testid="admin-tab-data" onClick={() => setTab("data")}>데이터 백업·복구</button>
        <button className={"chip" + (tab === "perm" ? " on" : "")} data-testid="admin-tab-perm" onClick={() => setTab("perm")}>권한 매트릭스</button>
      </div>


      {tab === "brand" && (
        <>
          {!isAdmin && <div className="form-err">관리자만 브랜딩을 설정할 수 있습니다.</div>}
          {isAdmin && <BrandingPanel />}
        </>
      )}

      {tab === "data" && (
        <>
          {!isAdmin && <div className="form-err">관리자만 백업·복구할 수 있습니다.</div>}
          {isAdmin && (
            <div className="g2">
              <Card title="📦 백업 (내보내기)" testid="data-backup">
                <div className="muted small" style={{ marginBottom: 10 }}>전체 데이터를 파일 1개로 저장합니다. 정기 백업·이전용으로 안전합니다.</div>
                <button className="btn primary" data-testid="data-export" disabled={busy} onClick={doExport}>⬇ 데이터 내보내기</button>
                <div className="muted small" style={{ marginTop: 8 }}>파일명: <code>labmate-backup-날짜.json</code></div>
              </Card>
              <Card title="♻ 복구 (가져오기)" testid="data-restore">
                <div className="callout-danger" style={{ marginBottom: 10 }}>⚠ 백업 파일로 <b>현재 데이터를 전부 대체</b>합니다. <b>되돌릴 수 없습니다.</b></div>
                <input type="file" accept="application/json,.json" data-testid="data-import" disabled={busy}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ""; }} />
              </Card>
              {msg && <div className="io" style={{ gridColumn: "1 / -1", marginBottom: 0 }} data-testid="data-msg">{msg}</div>}
            </div>
          )}
        </>
      )}

      {tab === "config" && (
        <>
          {!isAdmin && <div className="form-err">관리자만 마스터데이터를 편집할 수 있습니다.</div>}
          {isAdmin && (
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <div className="cfg-side" data-testid="cfg-side">
                {MASTER_MENU.map((g) => (
                  <button key={g.group} className={"cfg-side-item" + (cfgGroup === g.group ? " on" : "")} data-testid={`cfg-side-${g.group}`} onClick={() => setCfgGroup(g.group)}>{g.group}</button>
                ))}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {MASTER_MENU.filter((g) => g.group === cfgGroup).map((g) => (
                  <Card key={g.group} title={g.group} testid={`cfg-card-${g.group}`}>
                    {g.items.map((it) => it.key === "approval_types"
                      ? <ApprovalEditor key={it.key} />
                      : <ConfigField key={it.key} service={CONFIG_SERVICE[it.key]} k={it.key} label={it.label} required={it.required} />)}
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {tab === "sheet" && (
        <>
          {!isAdmin && <div className="form-err">관리자만 시트로 데이터를 가져올 수 있습니다.</div>}
          {isAdmin && (
            <Card title="시트 가져오기" testid="sheet-card">
              <div className="muted small" style={{ marginBottom: 12 }}>엔티티별 <b>엑셀 양식(XLSX)</b>을 내려받아 작성·업로드하면 일괄 등록됩니다. (키가 있는 항목은 동일 키 갱신, 실적은 종류별 탭)</div>
              <table className="tbl" data-testid="sheet-table">
                <tbody>
                  {Object.entries(SHEETS).map(([k, ent]) => (
                    <tr key={k} data-testid={`sheet-row-${k}`}>
                      <td style={{ width: 120, verticalAlign: "top", whiteSpace: "normal" }}><b>{ent.label}</b></td>
                      <td className="muted small" style={{ whiteSpace: "normal", wordBreak: "break-word", verticalAlign: "top" }}>
                        {ent.cols ? ent.cols.map(([, ko]) => ko).join(" · ") : (
                          <>
                            <div style={{ marginBottom: 4 }}>종류별 시트(탭)로 구성</div>
                            {pubTabs.map((t) => (
                              <div key={t.name} style={{ marginTop: 2 }}><b style={{ color: "var(--ink)" }}>{t.name}</b> : {t.cols.map(([, ko]) => ko).join(" · ")}</div>
                            ))}
                          </>
                        )}
                      </td>
                      <td style={{ width: 130, textAlign: "right", verticalAlign: "top" }}><SheetImport entity={ent} testid={`sheet-${k}`} onResult={setSheetResult} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sheetResult && (
                <div style={{ marginTop: 14 }} data-testid="sheet-result">
                  <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <b>최근 업로드 결과 — {sheetResult.label}</b>
                    <button className="btn ghost sm" data-testid="sheet-result-clear" onClick={() => setSheetResult(null)}>지우기</button>
                  </div>
                  <div className="io" style={{ marginTop: 0 }} data-testid="sheet-result-msg">{sheetResult.msg}</div>
                  {!!sheetResult.errors.length && (
                    <div className="form-err" style={{ marginTop: 8, maxHeight: 220, overflow: "auto" }} data-testid="sheet-result-errors">
                      <div className="small" style={{ fontWeight: 700, marginBottom: 4 }}>실패한 행 ({sheetResult.errors.length}건)</div>
                      {sheetResult.errors.map((e, i) => <div key={i} className="small">{e}</div>)}
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {tab === "perm" && (
        <Card pad={false}>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", padding: "12px 14px" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span className="badge s-ok">rw</span> 읽기·쓰기</span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span className="badge s-info">r</span> 조회만</span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span className="badge s-bad">−</span> 차단</span>
            <span className="muted small" style={{ marginLeft: "auto" }}>역할별 메뉴 접근 권한 (조회 전용)</span>
          </div>
          <table className="tbl" data-testid="perm-matrix">
            <thead><tr><th>모듈</th>{ROLES.map(([r, l]) => <th key={r}>{l}</th>)}</tr></thead>
            <tbody>
              {MODULES.map((m) => (
                <tr key={m}>
                  <td><b>{m}</b></td>
                  {ROLES.map(([r]) => {
                    const p = perm(r, m);
                    return <td key={r}><span className={"badge " + (p === "rw" ? "s-ok" : p === "r" ? "s-info" : "s-bad")}>{p}</span></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
