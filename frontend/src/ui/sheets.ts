// 시트(XLSX) 업로드 엔티티 레지스트리 — 관리자 환경설정 '시트 가져오기'에서 사용.
import { api } from "../api/client";
import type { SheetEntity, SheetDef } from "./SheetImport";

const ROLE_FROM_KO: Record<string, string> = {
  "교수": "prof", "지도교수": "prof", "박사과정": "phd", "박사": "phd", "석사과정": "master", "석사": "master",
  "학사과정": "under", "학부": "under", "학부과정": "under", "행정": "staff", "관리자": "admin",
  prof: "prof", phd: "phd", master: "master", under: "under", staff: "staff", admin: "admin",
};

// 날짜 정규화 — 연도만("2024")/연월("2024-05")도 유효한 date로 보정. 빈값/'-'는 null.
function normDate(v: any): string | null {
  const s = String(v ?? "").trim();
  if (!s || /^[-–—]+$/.test(s)) return null;
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  const mm = s.match(/^(\d{4})-(\d{1,2})$/);
  if (mm) return `${mm[1]}-${mm[2].padStart(2, "0")}-01`;
  return s;
}

// 실적: 종류 → 입력 양식 계열, 종류별 탭(시트) 정의
function pubFamily(k: string): "논문" | "학술대회" | "특허" | "기타" {
  if (/특허/.test(k)) return "특허";
  if (/학술대회|학회/.test(k)) return "학술대회";
  if (/논문|SCI|KCI/i.test(k)) return "논문";
  return "기타";
}
function pubTab(kind: string): SheetDef {
  const fam = pubFamily(kind);
  const intl = /국제|국외|해외/.test(kind);
  const scope = intl ? "국외" : "국내";
  const base = (r: any, meta: any) => ({ kind, title: r.title, scope, index_type: kind, authors: r.authors || "", funding: r.funding || "", pub_date: normDate(r.pub_date), status: "게재완료", meta, files: [] });
  if (fam === "논문") return {
    name: kind, required: ["title"],
    cols: [["title", "논문제목"], ["journal", "학술지명"], ["vol", "게재권/집"], ["no", "게재호"], ["pages", "페이지"], ["pub_date", "게재일"], ["publisher", "발행처"], ["country", "발행국가"], ["doi", "DOI"], ["issn", "ISSN"], ["lang", "논문언어"], ["first_authors", "제1저자수"], ["corr_authors", "교신저자수"], ["total_authors", "전체저자수"], ["authors", "저자(소속)"], ["funding", "사사(과제 관리코드)"]],
    example: ["샘플 논문 제목", "OO Journal", "1", "1", "1-10", "2025-03-01", "OO Publisher", "대한민국", "10.0000/sample", "0000-0000", "영어", "1", "1", "2", "홍길동(OO대), 김철수(OO대)", "2025-0001"],
    transform: (r) => base(r, { journal: r.journal, vol: r.vol, no: r.no, pages: r.pages, publisher: r.publisher, country: r.country, lang: r.lang, issn: r.issn, doi: r.doi, first_authors: r.first_authors, corr_authors: r.corr_authors, total_authors: r.total_authors }),
  };
  if (fam === "학술대회") return {
    name: kind, required: ["title"],
    cols: [["title", "제목"], ["conf", "학술대회명"], ["conf_start", "시작일"], ["conf_end", "종료일"], ["pub_date", "발표일"], ["host", "주최기관"], ["proceedings", "논문집명"], ["pages", "페이지"], ["host_country", "개최국"], ["venue", "발표장소"], ["part_countries", "참가국명"], ["co_authors", "공동저자수"], ["total_authors", "전체저자수"], ["authors", "저자(소속)"], ["funding", "사사(과제 관리코드)"]],
    example: ["샘플 학술대회 발표", "OO International Conference", "2025-11-26", "2025-11-28", "2025-11-27", "OO Society", "-", "1-6", "대한민국", "OO City", "대한민국, 미국", "0", "2", "홍길동(OO대)", "2025-0001"],
    transform: (r) => base(r, { conf: r.conf, conf_start: r.conf_start, conf_end: r.conf_end, pages: r.pages, host: r.host, venue: r.venue, proceedings: r.proceedings, host_country: r.host_country, part_countries: r.part_countries, co_authors: r.co_authors, total_authors: r.total_authors }),
  };
  if (fam === "특허") return {
    name: kind, required: ["title"],
    cols: [["title", "특허이름"], ["reg_no", "출원/등록번호"], ["applicant", "출원인"], ["pub_date", "출원/등록일"], ["inv_count", "발명자수"], ["authors", "발명자(소속)"], ["funding", "특허사사(과제 관리코드)"]],
    example: ["샘플 발명 명칭", "10-2025-0000000", "OO대학교 산학협력단", "2025-01-01", "2", "홍길동(OO대), 김철수(OO대)", "2025-0001"],
    transform: (r) => base(r, { pstat: kind.includes("등록") ? "등록" : "출원", reg_no: r.reg_no, applicant: r.applicant, inv_count: r.inv_count }),
  };
  return {   // 기타
    name: kind, required: ["title"],
    cols: [["title", "실적명"], ["pub_date", "등록일"], ["authors", "저자(소속)"], ["funding", "사사(과제 관리코드)"]],
    example: ["샘플 실적명", "2025-06-01", "홍길동(OO대)", "2025-0001"],
    transform: (r) => ({ ...base(r, {}), scope: "국내" }),
  };
}

export const SHEETS: Record<string, SheetEntity> = {
  members: {
    label: "구성원", create: "/members/users", list: "/members/users", patchBase: "/members/users/", matchKey: "email", required: ["email", "name"],
    cols: [["name", "이름"], ["name_en", "영문이름"], ["birth", "생년월일"], ["gender", "성별"], ["phone", "휴대폰"], ["email", "이메일"], ["temp_password", "임시 비밀번호"], ["join_date", "입실일"], ["exit_date", "퇴실일"], ["dept", "학과"], ["student_id", "학번"], ["role", "직급"], ["researcher_no", "과학기술인번호"], ["degree", "최종학위"], ["major", "전공"], ["grad_year", "학위취득년도"], ["note", "비고"]],
    example: ["홍길동", "Hong", "2000-01-01", "남", "010-0000-0000", "hong@labmate.io", "", "2025-01-01", "", "OO학과", "2025001", "석사과정", "", "학사", "OO전공", "2025", "신규 입실"],
    transform: (r) => { if (r.role) r.role = ROLE_FROM_KO[r.role] || r.role; if (!r.temp_password) delete r.temp_password; for (const k of ["birth", "join_date", "exit_date"]) if (!r[k]) delete r[k]; return r; },   // 임시 비번 미입력: 기존 회원 비번 유지(신규는 서버 기본값)
  },
  grants: {
    // 책임자(PI)는 폼과 동일하게 지도교수(prof) 자동 지정 → 시트 컬럼 없음.
    // 실무 담당자(pm)·참여 연구원(members)은 이메일/이름으로 입력 → 구성원 ID로 해석.
    label: "연구과제", create: "/projects/projects", list: "/projects/projects?kind=grant", patchBase: "/projects/projects/", matchKey: "code", required: ["code", "name"],
    cols: [["code", "관리코드"], ["name", "과제명"], ["agency", "전담기관"], ["program", "사업명"], ["start", "총 과제기간 (시작)"], ["end", "총 과제기간 (종료)"], ["year_start", "해당 연도 기간 (시작)"], ["year_end", "해당 연도 기간 (종료)"], ["host_org", "주관기관"], ["host_pi", "주관기관 연구책임자"], ["partner_orgs", "참여기관 (선택)"], ["partner_pis", "참여기관 연구책임자 (선택)"], ["budget_total", "총 연구비 (원)"], ["budget_year", "해당 연도 연구비 (원)"], ["pm", "실무 담당자 (이메일/이름)"], ["members", "참여 연구원 (이메일/이름; 쉼표 구분)"], ["ack_ko", "국문 사사 (선택)"], ["ack_en", "영문 사사 (선택)"]],
    example: ["2025-0001", "OO 기초연구 과제", "NRF", "개인기초연구", "2025-01-01", "2026-12-31", "2025-01-01", "2025-12-31", "OO대학교 산학협력단", "홍길동", "", "", "100000000", "50000000", "hong@labmate.io", "hong@labmate.io, kim@labmate.io", "본 성과는 OO재단 지원으로 수행됨", "This work was supported by OO."],
    createDefaults: { kind: "grant", status: "진행 중" },
    exportResolve: async (rows) => {   // pm_id·members(ID) → 이메일/이름
      const users = (await api.get<any[]>("/members/users")).data;
      const byId: Record<string, any> = Object.fromEntries(users.map((u) => [u.id, u]));
      const nm = (id: string) => byId[id]?.email || byId[id]?.name || "";
      return rows.map((p) => ({ ...p, pm: nm(p.pm_id), members: (p.members || []).map(nm).filter(Boolean).join(", ") }));
    },
    resolver: async () => {
      const users = (await api.get<any[]>("/members/users")).data;
      const umap: Record<string, any> = {};
      users.forEach((u) => { if (u.email) umap[u.email] = u; if (u.name) umap[u.name] = u; });
      const prof = users.find((u) => u.role === "prof");
      return (r: any) => {
        const meta = { year_start: r.year_start || "", year_end: r.year_end || "", host_org: r.host_org || "", host_pi: r.host_pi || "", partner_orgs: r.partner_orgs || "", partner_pis: r.partner_pis || "", budget_total: r.budget_total || "", budget_year: r.budget_year || "", ack_ko: r.ack_ko || "", ack_en: r.ack_en || "" };
        const out: any = { code: r.code, name: r.name, agency: r.agency || "", program: r.program || "", category: "과제", meta };
        if (r.start) out.start = r.start;
        if (r.end) out.end = r.end;
        if (prof) out.lead_id = prof.id;
        const pm = umap[String(r.pm || "").trim()];
        if (pm) out.pm_id = pm.id;
        const mem = String(r.members || "").split(/[,;]/).map((s) => umap[s.trim()]?.id).filter(Boolean);
        if (mem.length) out.members = mem;
        return out;
      };
    },
  },
  budget: {
    label: "예산 편성", create: "/funds/budgets/set", required: ["code", "category", "allocated"],
    cols: [["code", "관리코드"], ["category", "비목"], ["allocated", "편성액"]],
    example: ["2025-0001", "학생인건비", "30000000"],
    intFields: ["allocated"],
    exportList: "/funds/budgets",
    exportResolve: async (rows) => {   // project_id → 관리코드
      const grants = (await api.get<any[]>("/projects/projects?kind=grant")).data;
      const codeById: Record<string, string> = Object.fromEntries(grants.map((g) => [g.id, g.code]));
      return rows.map((b) => ({ ...b, code: codeById[b.project_id] || "" }));
    },
    resolver: async () => {
      const grants = (await api.get<any[]>("/projects/projects?kind=grant")).data;
      const map = Object.fromEntries(grants.map((g) => [g.code, g.id]));
      return (r: any) => { const pid = map[r.code]; if (!pid) return null; return { project_id: pid, category: r.category, allocated: r.allocated, reason: "시트 일괄 편성" }; };
    },
  },
  payroll: {
    label: "인건비 참여율", create: "/funds/participations/set", required: ["code", "member", "year", "month"],
    // 참여율·금액 중 하나만 입력하면 나머지를 등급 월단가로 자동 계산(참여율 우선)
    cols: [["code", "관리코드"], ["member", "구성원(이메일/이름)"], ["year", "연도"], ["month", "월"], ["rate_pct", "참여율(%)"], ["amount", "금액(원)"]],
    example: ["2025-0001", "hong@labmate.io", "2025", "3", "50", ""],
    intFields: ["year", "month", "amount"],
    exportList: "/funds/participations/all",
    exportResolve: async (rows) => {   // {project_id,uid,month,rate_pct} → 관리코드·구성원·연월 + 금액(등급단가×참여율)
      const [grants, users, cfg] = await Promise.all([api.get<any[]>("/projects/projects?kind=grant"), api.get<any[]>("/members/users"), api.get<any>("/funds/config")]);
      const codeById: Record<string, string> = Object.fromEntries(grants.data.map((g) => [g.id, g.code]));
      const userById: Record<string, any> = Object.fromEntries(users.data.map((u) => [u.id, u]));
      const rates: Record<string, number> = (cfg.data && cfg.data.grade_rates) || {};
      const gradeOf = (u: any) => u?.grade || (u?.role === "phd" ? "박사과정" : u?.role === "master" ? "석사과정" : "학사과정");
      return rows.map((p) => ({
        code: codeById[p.project_id] || "",
        member: userById[p.uid]?.email || userById[p.uid]?.name || "",
        year: String(p.month || "").slice(0, 4),
        month: Number(String(p.month || "").slice(5, 7)) || "",
        rate_pct: p.rate_pct,
        amount: Math.round((rates[gradeOf(userById[p.uid])] || 0) * (p.rate_pct || 0) / 100),
      }));
    },
    resolver: async () => {
      const [projs, users, cfg] = await Promise.all([
        api.get<any[]>("/projects/projects?kind=grant"), api.get<any[]>("/members/users"), api.get<any>("/funds/config"),
      ]);
      const codeMap = Object.fromEntries(projs.data.map((p) => [p.code, p.id]));
      const userMap: Record<string, any> = {};
      users.data.forEach((u) => { userMap[u.email] = u; if (u.name) userMap[u.name] = u; });
      const rates: Record<string, number> = (cfg.data && cfg.data.grade_rates) || {};
      const gradeOf = (u: any) => u.grade || (u.role === "phd" ? "박사과정" : u.role === "master" ? "석사과정" : "학사과정");
      return (r: any) => {
        const pid = codeMap[r.code]; const u = userMap[r.member]; if (!pid || !u) return null;
        const month = `${r.year}-${String(r.month).padStart(2, "0")}`;
        const base = rates[gradeOf(u)] || 0;
        const rateIn = Number(r.rate_pct) || 0; const amtIn = Number(r.amount) || 0;
        let rate_pct: number, amount: number;
        if (rateIn > 0) { rate_pct = rateIn; amount = Math.round(base * rate_pct / 100); }               // 참여율 → 금액
        else if (amtIn > 0) { amount = amtIn; rate_pct = base > 0 ? Math.round(amtIn / base * 10000) / 100 : 0; }   // 금액 → 참여율
        else return null;   // 둘 다 없음 → 건너뜀
        return { uid: u.id, project_id: pid, month, rate_pct, amount };
      };
    },
  },
  expenses: {
    label: "연구비 집행", create: "/funds/expenses", required: ["code", "category", "title", "amount"],
    cols: [["code", "관리코드"], ["claim_date", "집행일자"], ["category", "비목"], ["subcategory", "세목(선택)"], ["title", "집행 내용"], ["amount", "금액(원)"]],
    example: ["2025-0001", "2025-03-15", "연구활동비", "국내여비", "출장 여비", "300000"],
    intFields: ["amount"],
    exportList: "/funds/expenses",
    exportResolve: async (rows) => {   // project_id → 관리코드
      const grants = (await api.get<any[]>("/projects/projects?kind=grant")).data;
      const codeById: Record<string, string> = Object.fromEntries(grants.map((g) => [g.id, g.code]));
      return rows.map((e) => ({ ...e, code: codeById[e.project_id] || "" }));
    },
    resolver: async () => {
      const grants = (await api.get<any[]>("/projects/projects?kind=grant")).data;
      const map = Object.fromEntries(grants.map((g) => [g.code, g.id]));
      return (r: any) => { const pid = map[r.code]; if (!pid) return null; return { project_id: pid, category: r.category, subcategory: r.subcategory || "", title: r.title, claim_date: r.claim_date || null, amount: r.amount, files: [] }; };
    },
  },
  // 실적 — 종류별 탭(시트). 종류는 마스터데이터(pub_types)에서 동적으로 가져온다.
  // 사사(funding)가 기존 연구과제(관리코드)와 연결될 때만 등록(단, '기타' 계열은 과제 연결 없이도 허용).
  publications: {
    // 제목(title) 기준 upsert
    label: "실적", create: "/projects/publications", list: "/projects/publications", patchBase: "/projects/publications/", matchKey: "title", required: ["title"],
    buildTabs: async () => {
      let kinds: string[] = [];
      try { kinds = (await api.get<any>("/projects/config")).data?.pub_types || []; } catch { }
      if (!kinds.length) kinds = ["국제논문지", "국내논문지", "국제학술대회", "국내학술대회", "국제특허", "국내특허", "기타"];
      return kinds.map((k) => pubTab(k));
    },
    resolver: async () => {
      const grants = (await api.get<any[]>("/projects/projects?kind=grant")).data;
      const map = Object.fromEntries(grants.map((g) => [g.code, g.id]));
      // 사사 = 연구과제 관리코드. 관대하게 처리: 없음/미등록/다중 코드 모두 업로드 허용.
      return (r: any) => {
        const raw = String(r.funding || "").trim();
        const funding = (!raw || /^[-–—]+$/.test(raw)) ? "" : raw;   // '-'·빈값 = 사사 없음(모든 계열 공통)
        if (pubFamily(r.kind) === "기타") return { ...r, funding };
        if (!funding) return { ...r, funding: "" };
        // 다중 사사(쉼표/세미콜론) 중 등록된 과제만 연결, 미등록 코드는 문구만 유지
        const pid = funding.split(/[,;]/).map((s) => map[s.trim()]).find(Boolean);
        return pid ? { ...r, project_id: pid, funding } : { ...r, funding };
      };
    },
  },
  // 자산 — 분류가 '산학협력단'이면 연결될 연구과제(관리코드)가 있어야 등록.
  assets: {
    label: "자산", create: "/resource/assets", list: "/resource/assets", patchBase: "/resource/assets/", matchKey: "asset_no", required: ["name"],
    cols: [["asset_class", "자산분류"], ["asset_no", "자산번호"], ["name", "자산명"], ["buy_date", "구매일자"], ["spec", "규격"], ["model", "모델"], ["building", "건물"], ["floor", "층"], ["room", "호실"], ["location", "위치"], ["owner_id", "책임자"], ["project_code", "과제 관리코드(산학협력단 자산)"], ["note", "비고"]],
    example: ["연구실", "2025-0001", "노트북", "2025-01-01", "OO-0000", "OO", "OO관", "5", "000", "책상", "홍길동", "", ""],
    transform: (r) => { if (!r.buy_date) delete r.buy_date; return r; },
    resolver: async () => {
      const grants = (await api.get<any[]>("/projects/projects?kind=grant")).data;
      const map = Object.fromEntries(grants.map((g) => [g.code, g.id]));
      return (r: any) => {
        const code = r.project_code; delete r.project_code;
        if (r.asset_class === "산학협력단") { const pid = map[code]; if (!pid) return null; return { ...r, project_id: pid }; }
        if (code && map[code]) r.project_id = map[code];
        return r;
      };
    },
  },
  devices: {
    // 랙+위치(시작 U) 복합 키 upsert
    label: "인프라 장비", create: "/resource/devices", list: "/resource/devices", patchBase: "/resource/devices/",
    matchKeyFn: (r) => `${String(r.rack || "").trim()}#${r.pos}`, required: ["rack", "name"],
    cols: [["rack", "랙"], ["type", "종류"], ["name", "장비명"], ["ip", "IP주소"], ["pos", "위치(시작 U)"], ["size", "크기(U)"], ["note", "비고"]],
    example: ["R1", "서버", "OO 노드 1", "192.168.0.10", "1", "2", "보증 만료 2026-12"],
    intFields: ["pos", "size"],
  },
};
