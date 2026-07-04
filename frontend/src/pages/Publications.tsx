import { useEffect, useState } from "react";
import { api, apiError } from "../api/client";
import { todayKST } from "../lib/date";
import { useAuth } from "../auth/AuthContext";
import { PageHeader, Card } from "../ui/kit";
import { DataTable, Col } from "../ui/DataTable";
import { confirmDialog } from "../ui/dialog";
import { useConfig, names } from "../api/config";

interface PubFile { name: string; url: string; }
interface Pub {
  id: string; kind: string; title: string; project_id: string; scope: string; index_type: string;
  index_grade: string; authors: string; funding: string; status: string; pub_date: string | null; meta: any;
  abstract?: string; files?: PubFile[];
}
// 고정 실적 종류 6종 — 전용 양식(그 외는 기타 양식)
const FIXED_KINDS = ["국제논문지", "국내논문지", "국제학술대회", "국내학술대회", "국제특허", "국내특허"];
const KINDS_FB = [...FIXED_KINDS];

// 실적 종류 → 양식 계열(고정 6종만 전용, 그 외 기타)
function family(k: string): "논문" | "학술대회" | "특허" | "기타" {
  if (/특허/.test(k)) return "특허";
  if (/학술대회|학회/.test(k)) return "학술대회";
  if (/논문|SCI|KCI/i.test(k)) return "논문";
  return "기타";
}
function scopeOf(u: Pub) { return u.scope || "국외"; }
// 실적 연도 = pub_date 연도. 비면 특허=등록번호, 학술대회=종료/시작일에서 보조 추출
function yearOf(u: Pub) {
  const m = u.meta || {};
  let d = u.pub_date || "";
  if (!d && family(u.kind) === "학술대회") d = m.conf_end || m.conf_start || "";
  if (!d && family(u.kind) === "특허") {
    const mt = String(m.reg_no || "").match(/-(\d{4})-/) || String(m.reg_no || "").match(/\b(20\d{2})\b/);
    if (mt) return mt[1];
  }
  return (d || "").slice(0, 4) || "미상";
}
// 실적 → 고정 6종 라벨(커스텀은 그대로, 구 데이터는 6종 매핑)
function seriesOf(u: Pub): string {
  const k = u.kind || "";
  if (FIXED_KINDS.includes(k)) return k;
  const fam = family(k);
  if (fam === "논문") {
    const ix = u.index_grade || u.index_type || k;
    return /SSCI|SCIE|SCI|SCOPUS|A&HCI/i.test(ix) ? "국제논문지" : "국내논문지";
  }
  const intl = scopeOf(u) === "국외" || /국제|국외|해외/.test(k);
  if (fam === "학술대회") return intl ? "국제학술대회" : "국내학술대회";
  if (fam === "특허") return intl ? "국제특허" : "국내특허";
  return k;   // 기타(커스텀 종류)
}

// 실적 상세 항목 — [라벨, 값, span]. span: full/half/third
type Span = "full" | "half" | "third";
function pubRows(u: Pub): [string, any, Span][] {
  const m = u.meta || {};
  const fam = family(u.kind);
  const rows: [string, any, Span][] = [["종류", u.kind, "third"]];
  if (fam === "논문") {
    rows.push(["논문제목", u.title, "full"], ["학술지명", m.journal, "full"],
      ["게재권/집", m.vol, "third"], ["게재호", m.no, "third"], ["페이지", m.pages, "third"],
      ["게재일", u.pub_date, "third"], ["발행처", m.publisher, "third"], ["발행국가", m.country, "third"],
      ["DOI", m.doi, "third"], ["ISSN", m.issn, "third"], ["논문언어", m.lang, "third"],
      ["제1저자수", m.first_authors, "third"], ["교신저자수", m.corr_authors, "third"], ["전체저자수", m.total_authors, "third"],
      ["저자(소속)", u.authors, "full"]);
  } else if (fam === "학술대회") {
    rows.push(["제목", u.title, "full"], ["학술대회명", m.conf, "full"],
      ["시작일", m.conf_start, "third"], ["종료일", m.conf_end, "third"], ["발표일", u.pub_date, "third"],
      ["주최기관", m.host, "third"], ["논문집명", m.proceedings, "third"], ["페이지", m.pages, "third"],
      ["개최국", m.host_country, "third"], ["발표장소", m.venue, "third"], ["참가국명", m.part_countries, "third"],
      ["공동저자수", m.co_authors, "half"], ["전체저자수", m.total_authors, "half"],
      ["저자(소속)", u.authors, "full"]);
  } else if (fam === "특허") {
    rows.push(["특허이름", u.title, "full"],
      ["출원/등록번호", m.reg_no, "half"], ["출원인", m.applicant, "half"],
      ["출원/등록일", u.pub_date, "half"], ["발명자수", m.inv_count, "half"],
      ["발명자(소속)", u.authors, "full"]);
  } else {
    rows.push(["실적명", u.title, "full"], ["등록일", u.pub_date, "third"], ["저자(소속)", u.authors, "full"]);
  }
  rows.push(["사사(과제)", u.funding, "full"]);
  return rows;
}

const EMPTY = {
  kind: "국제논문지", title: "", project_id: "", funding: "", funding_type: "연구과제", status: "게재완료", pub_date: "",
  authors: "", index_grade: "SCI", abstract: "",
  // 논문
  journal: "", vol: "", no: "", pages: "", publisher: "", country: "", lang: "영어", issn: "", doi: "",
  first_authors: "", corr_authors: "", total_authors: "",
  // 학술대회
  conf: "", conf_start: "", conf_end: "", host: "", venue: "", proceedings: "", host_country: "", part_countries: "", co_authors: "",
  // 특허
  reg_no: "", applicant: "",
};

export default function Publications() {
  const { me } = useAuth();
  const canAdd = !!me && (["prof", "staff", "admin"].includes(me.role) || !!me.delegated_admin);
  const [items, setItems] = useState<Pub[]>([]);
  const [projects, setProjects] = useState<{ id: string; code: string }[]>([]);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState("");
  const [detail, setDetail] = useState<Pub | null>(null);
  const KINDS = names(useConfig("pub_types", KINDS_FB));
  const [f, setF] = useState({ ...EMPTY });
  const up = (k: string, v: any) => setF((s) => ({ ...s, [k]: v }));
  // 발명자(소속) 콤마 구분 인원수 — 발명자수 자동 반영
  const invCount = f.authors.split(",").map((s) => s.trim()).filter(Boolean).length;
  // 사사 중복 선택 — funding에 과제 코드 쉼표 결합 저장
  const selFunding = f.funding ? f.funding.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const toggleFunding = (code: string) => {
    const set = new Set(selFunding);
    if (set.has(code)) set.delete(code); else set.add(code);
    up("funding", [...set].join(", "));
  };
  const [files, setFiles] = useState<PubFile[]>([]);
  const [uploading, setUploading] = useState(false);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const fl = e.target.files; if (!fl || !fl.length) return;
    setUploading(true); setErr("");
    const fd = new FormData();
    Array.from(fl).forEach((file) => fd.append("files", file));
    try {
      const r = await api.post<PubFile[]>("/projects/uploads", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setFiles((prev) => [...prev, ...r.data]);
    } catch (e) { setErr(apiError(e)); }
    finally { setUploading(false); e.target.value = ""; }
  }

  async function load() {
    try {
      setItems((await api.get<Pub[]>("/projects/publications")).data);
      setProjects((await api.get("/projects/projects?kind=grant")).data);
    } catch (e) { setErr(apiError(e)); }
  }
  useEffect(() => { load(); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    const fam = family(f.kind);
    const scope = /국제|국외|해외/.test(f.kind) ? "국외" : "국내";
    let meta: any = {};
    if (fam === "논문") meta = { journal: f.journal, vol: f.vol, no: f.no, pages: f.pages, publisher: f.publisher, country: f.country, lang: f.lang, issn: f.issn, doi: f.doi, first_authors: f.first_authors, corr_authors: f.corr_authors, total_authors: f.total_authors };
    else if (fam === "학술대회") meta = { conf: f.conf, conf_start: f.conf_start, conf_end: f.conf_end, host: f.host, venue: f.venue, proceedings: f.proceedings, host_country: f.host_country, part_countries: f.part_countries, co_authors: f.co_authors, total_authors: f.total_authors, pages: f.pages };
    else if (fam === "특허") meta = { pstat: f.kind.includes("등록") ? "등록" : "출원", reg_no: f.reg_no, applicant: f.applicant, inv_count: invCount };
    // 선택 사사 중 첫 매칭 과제를 project_id로 연결 — 과제 성과 집계 반영
    const fundPid = f.funding_type === "연구과제"
      ? (f.funding.split(",").map((c) => projects.find((p) => p.code === c.trim())?.id).find(Boolean) || "")
      : "";
    const body = {
      kind: f.kind, title: f.title, project_id: fundPid, scope, index_type: f.kind,
      index_grade: fam === "논문" ? f.index_grade : "", authors: f.authors, funding: f.funding,
      status: f.status, pub_date: f.pub_date || null, abstract: f.abstract, meta, files,
    };
    try {
      if (editId) await api.patch(`/projects/publications/${editId}`, body);
      else await api.post("/projects/publications", body);
      setAdding(false); setEditId(""); setF({ ...EMPTY }); setFiles([]); load();
    } catch (e) { setErr(apiError(e)); }
  }

  // 수정 폼 채우기 — meta를 폼 필드로 역매핑
  function startEdit(u: Pub) {
    const m = u.meta || {};
    const known = !!u.funding && u.funding.split(",").map((s) => s.trim()).some((c) => projects.some((p) => p.code === c));
    setF({
      ...EMPTY,
      kind: u.kind, title: u.title, project_id: u.project_id || "", funding: u.funding || "",
      funding_type: u.funding && !known ? "기타" : "연구과제",
      status: u.status || "게재완료", pub_date: u.pub_date || "", authors: u.authors || "",
      index_grade: u.index_grade || "SCI", abstract: u.abstract || "",
      journal: m.journal || "", vol: m.vol || "", no: m.no || "", pages: m.pages || "", publisher: m.publisher || "", country: m.country || "", lang: m.lang || "영어", issn: m.issn || "", doi: m.doi || "",
      first_authors: m.first_authors || "", corr_authors: m.corr_authors || "", total_authors: m.total_authors || "",
      conf: m.conf || "", conf_start: m.conf_start || "", conf_end: m.conf_end || "", host: m.host || "", venue: m.venue || "", proceedings: m.proceedings || "", host_country: m.host_country || "", part_countries: m.part_countries || "", co_authors: m.co_authors || "",
      reg_no: m.reg_no || "", applicant: m.applicant || "",
    });
    setFiles(u.files || []); setEditId(u.id); setDetail(null); setAdding(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function delPub(u: Pub): Promise<boolean> {
    if (!await confirmDialog(`실적 "${u.title}"을(를) 삭제할까요? 되돌릴 수 없습니다.`, { danger: true })) return false;
    try { await api.delete(`/projects/publications/${u.id}`); setDetail(null); load(); return true; } catch (e) { setErr(apiError(e)); return false; }
  }

  // 최근 5년 실적 표 — 실적 종류(pub_types) 사용
  const thisYear = Number(todayKST().slice(0, 4));
  const recentYears = Array.from({ length: 5 }, (_, i) => String(thisYear - 4 + i));
  const countOf = (k: string, y: string) => items.filter((u) => seriesOf(u) === k && yearOf(u) === y).length;

  const cols: Col<Pub>[] = [
    { key: "kind", label: "종류", value: (u) => seriesOf(u), render: (u) => <span className="badge s-info">{seriesOf(u)}</span>, nowrap: true },
    { key: "title", label: "제목", value: (u) => u.title, render: (u) => <a className="lnk" style={{ fontWeight: 700, cursor: "pointer", whiteSpace: "normal", overflowWrap: "anywhere" }} title={u.title} data-testid={`pub-open-${u.id}`} onClick={() => setDetail(u)}>{u.title}</a> },
    { key: "authors", label: "저자", render: (u) => <span className="small" style={{ whiteSpace: "normal", overflowWrap: "anywhere" }} title={u.authors}>{u.authors}</span> },
    { key: "funding", label: "사사", value: (u) => u.funding, render: (u) => <span className="small">{u.funding || "-"}</span>, nowrap: true },
    { key: "files", label: "첨부", nowrap: true, render: (u) => (u.files && u.files.length) ? <span className="small">{u.files.map((fi, i) => <a key={i} className="lnk" href={fi.url} target="_blank" rel="noreferrer" title={fi.name} style={{ marginRight: 4 }}>📎{u.files!.length > 1 ? i + 1 : ""}</a>)}</span> : <span className="muted small">—</span> },
    { key: "year", label: "연도", value: (u) => yearOf(u), nowrap: true, render: (u) => yearOf(u) },
  ];

  return (
    <div data-testid="page-publications">
      <PageHeader crumb="연구실 › 실적" title="실적" action={
        canAdd ? <button className="btn primary" data-testid="pub-add-open" onClick={() => { if (!adding) { setEditId(""); setFiles([]); setF({ ...EMPTY, kind: KINDS[0] || "SCI" }); } setAdding((v) => !v); }}>+ 실적 등록</button> : <span className="muted small">조회 전용</span>
      } />
      {err && <div className="form-err" data-testid="pub-error">{err}</div>}
      {adding && (
        <form className="card" onSubmit={add} data-testid="pub-form">
          <div className="card-h"><b>{editId ? "실적 수정" : "실적 등록"}</b></div>
          <div className="bd">
            {/* 종류 선택에 따라 아래 입력 항목 변경 */}
            <label>종류</label>
            <select data-testid="u-kind" value={f.kind} onChange={(e) => up("kind", e.target.value)}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
            <label style={{ marginTop: 10 }}>{family(f.kind) === "특허" ? "특허 이름" : family(f.kind) === "기타" ? "실적명" : "논문제목"}</label>
            <input data-testid="u-title" value={f.title} onChange={(e) => up("title", e.target.value)} />

            {family(f.kind) === "논문" && (<>
              <h3 style={{ fontSize: 13, color: "var(--brand)", margin: "14px 0 6px" }}>논문 정보 <span className="muted small">({f.kind})</span></h3>
              <label>학술지명</label>
              <input value={f.journal} onChange={(e) => up("journal", e.target.value)} />
              <div className="grid3">
                <div><label>게재권/집</label><input value={f.vol} onChange={(e) => up("vol", e.target.value)} /></div>
                <div><label>게재호</label><input value={f.no} onChange={(e) => up("no", e.target.value)} /></div>
                <div><label>페이지</label><input value={f.pages} onChange={(e) => up("pages", e.target.value)} /></div>
              </div>
              <div className="grid3">
                <div><label>게재일</label><input type="date" data-testid="u-date" value={f.pub_date} onChange={(e) => up("pub_date", e.target.value)} /></div>
                <div><label>발행처</label><input value={f.publisher} onChange={(e) => up("publisher", e.target.value)} /></div>
                <div><label>발행국가</label><input value={f.country} onChange={(e) => up("country", e.target.value)} /></div>
              </div>
              <div className="grid3">
                <div><label>DOI</label><input value={f.doi} onChange={(e) => up("doi", e.target.value)} /></div>
                <div><label>ISSN</label><input value={f.issn} onChange={(e) => up("issn", e.target.value)} /></div>
                <div><label>논문언어</label><select value={f.lang} onChange={(e) => up("lang", e.target.value)}><option>영어</option><option>한글</option></select></div>
              </div>
              <div className="grid3">
                <div><label>제1저자수</label><input value={f.first_authors} onChange={(e) => up("first_authors", e.target.value)} /></div>
                <div><label>교신저자수</label><input value={f.corr_authors} onChange={(e) => up("corr_authors", e.target.value)} /></div>
                <div><label>전체저자수</label><input value={f.total_authors} onChange={(e) => up("total_authors", e.target.value)} /></div>
              </div>
            </>)}
            {family(f.kind) === "학술대회" && (<>
              <h3 style={{ fontSize: 13, color: "var(--brand)", margin: "14px 0 6px" }}>학술대회 정보</h3>
              <label>학술대회명</label>
              <input value={f.conf} onChange={(e) => up("conf", e.target.value)} />
              <div className="grid3">
                <div><label>시작일</label><input type="date" value={f.conf_start} onChange={(e) => up("conf_start", e.target.value)} /></div>
                <div><label>종료일</label><input type="date" value={f.conf_end} onChange={(e) => up("conf_end", e.target.value)} /></div>
                <div><label>발표일</label><input type="date" data-testid="u-date" value={f.pub_date} onChange={(e) => up("pub_date", e.target.value)} /></div>
              </div>
              <div className="grid3">
                <div><label>주최기관</label><input value={f.host} onChange={(e) => up("host", e.target.value)} /></div>
                <div><label>논문집명</label><input value={f.proceedings} onChange={(e) => up("proceedings", e.target.value)} /></div>
                <div><label>페이지</label><input value={f.pages} onChange={(e) => up("pages", e.target.value)} /></div>
              </div>
              <div className="grid3">
                <div><label>개최국</label><input value={f.host_country} onChange={(e) => up("host_country", e.target.value)} /></div>
                <div><label>발표장소</label><input value={f.venue} onChange={(e) => up("venue", e.target.value)} /></div>
                <div><label>참가국명</label><input value={f.part_countries} onChange={(e) => up("part_countries", e.target.value)} /></div>
              </div>
              <div className="grid2">
                <div><label>공동저자수</label><input value={f.co_authors} onChange={(e) => up("co_authors", e.target.value)} /></div>
                <div><label>전체저자수</label><input value={f.total_authors} onChange={(e) => up("total_authors", e.target.value)} /></div>
              </div>
            </>)}
            {family(f.kind) === "특허" && (<>
              <h3 style={{ fontSize: 13, color: "var(--brand)", margin: "14px 0 6px" }}>특허 정보 <span className="muted small">({f.kind})</span></h3>
              <div className="grid2">
                <div><label>출원/등록번호</label><input value={f.reg_no} onChange={(e) => up("reg_no", e.target.value)} /></div>
                <div><label>출원인</label><input value={f.applicant} onChange={(e) => up("applicant", e.target.value)} /></div>
              </div>
              <div className="grid2">
                <div><label>출원/등록일</label><input type="date" data-testid="u-date" value={f.pub_date} onChange={(e) => up("pub_date", e.target.value)} /></div>
                <div><label>발명자수</label><input data-testid="u-invcount" value={invCount} readOnly title="발명자(소속)을 콤마(,)로 구분해 자동 계산" style={{ background: "var(--soft)", cursor: "not-allowed" }} /></div>
              </div>
            </>)}
            {family(f.kind) === "기타" && (
              <div className="grid2" style={{ marginTop: 10 }}>
                <div><label>등록일</label><input type="date" data-testid="u-date" value={f.pub_date} onChange={(e) => up("pub_date", e.target.value)} /></div>
              </div>
            )}

            <label style={{ marginTop: 10 }}>{family(f.kind) === "특허" ? "발명자(소속)" : "저자(소속)"}</label>
            <input data-testid="u-authors" value={f.authors} onChange={(e) => up("authors", e.target.value)} placeholder="예: 홍길동(단국대), 김연구(단국대)" />
            <label style={{ marginTop: 10 }}>{family(f.kind) === "특허" ? "특허사사" : "사사"}{f.funding_type === "연구과제" && selFunding.length ? ` · ${selFunding.length}건 선택` : ""} {f.funding_type === "연구과제" && <span className="muted small">(과제 중복 선택 가능)</span>}</label>
            <div className="grid3">
              <select data-testid="u-funding-type" value={f.funding_type} onChange={(e) => setF((s) => ({ ...s, funding_type: e.target.value, funding: "" }))}>
                <option>연구과제</option><option>기타</option>
              </select>
              <div style={{ gridColumn: "span 2" }}>
                {f.funding_type === "연구과제"
                  ? <div className="fchips" data-testid="u-funding">
                      {projects.length ? projects.map((p) => <button type="button" key={p.id} className={"chip" + (selFunding.includes(p.code) ? " on" : "")} onClick={() => toggleFunding(p.code)}>{p.code}</button>) : <span className="muted small">등록된 과제 없음</span>}
                    </div>
                  : <input data-testid="u-funding" value={f.funding} onChange={(e) => up("funding", e.target.value)} placeholder="사사 문구 직접 입력" />}
              </div>
            </div>
            <label style={{ marginTop: 10 }}>증빙 파일 첨부 (PDF·이미지 등, 여러 개 가능)</label>
            <input type="file" multiple data-testid="u-file" onChange={onUpload} />
            {uploading && <div className="muted small">업로드 중…</div>}
            {files.map((fi, i) => (
              <div key={i} className="io" style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                <span>📎 {fi.name}</span>
                <button type="button" className="btn ghost sm" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>삭제</button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
              <button className="btn primary" data-testid="pub-add-submit">{editId ? "저장" : "등록"}</button>
              <button type="button" className="btn ghost" data-testid="pub-add-cancel" onClick={() => { setAdding(false); setEditId(""); setFiles([]); }}>취소</button>
              {editId && <button type="button" data-testid="pub-del" onClick={async () => { const u = items.find((x) => x.id === editId); if (u && await delPub(u)) { setAdding(false); setEditId(""); setFiles([]); } }} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--bad)", fontSize: 11.5, textDecoration: "underline", cursor: "pointer", opacity: 0.85 }}>삭제</button>}
            </div>
          </div>
        </form>
      )}


      <Card title="최근 5년 실적 현황" testid="pub-yeartable">
        <table className="tbl" style={{ minWidth: 0 }}>
          <thead><tr><th>성과지표</th>{recentYears.map((y) => <th key={y} style={{ textAlign: "center" }}>{y}</th>)}<th style={{ textAlign: "center" }}>합계</th></tr></thead>
          <tbody>
            {KINDS.map((k) => {
              const counts = recentYears.map((y) => countOf(k, y));
              const sum = counts.reduce((a, b) => a + b, 0);
              return (
                <tr key={k}>
                  <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>{k}</th>
                  {counts.map((c, i) => <td key={i} style={{ textAlign: "center" }} className={c ? "" : "muted"}>{c || "-"}</td>)}
                  <td style={{ textAlign: "center", fontWeight: 700 }}>{sum || "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>


      <DataTable rows={items} cols={cols} testid="pub-table" searchPlaceholder="제목·저자·학술지 검색…"
        searchKeys={(u) => [u.title, u.authors, u.funding].join(" ")} pageSize={12} defaultSort="year" defaultDir={-1}
        chips={{ get: seriesOf, values: KINDS }} empty="실적 없음" />

      {detail && (
        <div className="modal-ovl" onClick={(e) => { if (e.target === e.currentTarget) setDetail(null); }}>
          <div className="modal" data-testid="pub-detail" style={{ width: 620, maxWidth: "94%" }}>
            <div className="modal-h">
              <b>실적 세부정보</b>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {canAdd && <button className="btn ghost sm" data-testid="pub-detail-edit" onClick={() => startEdit(detail)}>수정</button>}
                <button className="btn ghost sm" onClick={() => setDetail(null)}>✕</button>
              </span>
            </div>
            <div className="modal-b">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "13px 20px" }}>
                {pubRows(detail).filter(([, v]) => v != null && v !== "").map(([k, v, span]) => (
                  <div key={k} style={{ gridColumn: span === "full" ? "1 / -1" : `span ${span === "half" ? 3 : 2}`, minWidth: 0 }}>
                    <div className="muted" style={{ fontSize: 12.5 }}>{k}</div>
                    <div style={{ marginTop: 3, fontSize: 15, lineHeight: 1.5, overflowWrap: "anywhere" }}>{v || "—"}</div>
                  </div>
                ))}
              </div>
              {detail.abstract && <div style={{ marginTop: 12 }}><div className="muted small">요약</div><div className="small" style={{ whiteSpace: "pre-wrap", marginTop: 4, lineHeight: 1.6 }}>{detail.abstract}</div></div>}
              {!!(detail.files && detail.files.length) && <div style={{ marginTop: 12 }}><div className="muted small">첨부</div><div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>{detail.files.map((fi, i) => <a key={i} className="badge s-info" href={fi.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>📎 {fi.name}</a>)}</div></div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
