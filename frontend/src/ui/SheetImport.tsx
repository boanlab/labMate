// 시트(XLSX) 기반 일괄 업로드 — 엔티티 정의로 재사용. 실적처럼 종류별 다중 탭(시트) 지원.
import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { api, apiError } from "../api/client";

// 하나의 시트(탭) 정의
export type SheetDef = {
  name: string;                   // 탭(시트) 이름
  cols: [string, string][];       // [필드, 한글헤더]
  example: string[];
  required?: string[];
  intFields?: string[];
  createDefaults?: Record<string, any>;
  transform?: (r: any) => any;
};

export type SheetEntity = {
  label: string;
  create: string;                 // POST 생성 엔드포인트
  list?: string;                  // upsert용 기존 목록 조회
  patchBase?: string;             // upsert용 PATCH 베이스(`/x/`)
  matchKey?: string;              // upsert 매칭 키(단일 필드)
  matchKeyFn?: (r: any) => string;   // upsert 매칭 키(복합 — 예: 랙+위치). matchKey보다 우선.
  required: string[];
  cols?: [string, string][];      // 단일 시트
  example?: string[];
  intFields?: string[];
  createDefaults?: Record<string, any>;
  transform?: (r: any) => any;
  resolver?: () => Promise<(r: any) => any | null>;   // 과제코드→project_id 등 참조 해결
  tabs?: SheetDef[];                                   // 정적 다중 탭
  buildTabs?: () => Promise<SheetDef[]>;               // 동적 다중 탭(실적 종류별)
  exportList?: string;                                 // 내보내기 데이터 조회(없으면 list 사용)
  exportResolve?: (rows: any[]) => Promise<any[]>;     // 내보내기 행 보정(참조 필드 채우기: project_id→code 등)
};

// 시트 이름은 31자 제한
const safeName = (s: string) => (s || "Sheet").slice(0, 31);

// cellDates로 읽은 Date 셀 → ISO(YYYY-MM-DD) 문자열. UTC 자정이므로 getUTC*로 뽑아 시간대 밀림 방지
function normalizeDateCells(wb: XLSX.WorkBook) {
  const p = (n: number) => String(n).padStart(2, "0");
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    for (const addr in ws) {
      if (addr[0] === "!") continue;
      const cell = (ws as any)[addr];
      if (cell && cell.t === "d" && cell.v instanceof Date) {
        const d: Date = cell.v;
        cell.v = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
        cell.t = "s";
        delete cell.w; delete cell.z;
      }
    }
  }
}

export function SheetImport({ entity, onDone, onResult, testid = "sheet" }: { entity: SheetEntity; onDone?: () => void; onResult?: (r: { label: string; msg: string; errors: string[] }) => void; testid?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  async function defs(): Promise<SheetDef[]> {
    if (entity.buildTabs) return entity.buildTabs();
    if (entity.tabs) return entity.tabs;
    return [{ name: entity.label, cols: entity.cols || [], example: entity.example || [], required: entity.required, intFields: entity.intFields, createDefaults: entity.createDefaults, transform: entity.transform }];
  }

  async function downloadTemplate() {
    setBusy(true);
    try {
      const ds = await defs();
      const wb = XLSX.utils.book_new();
      const used = new Set<string>();
      ds.forEach((d) => {
        const ws = XLSX.utils.aoa_to_sheet([d.cols.map(([, ko]) => ko), d.example]);
        let nm = safeName(d.name); let i = 2;
        while (used.has(nm)) nm = safeName(d.name + i++);
        used.add(nm);
        XLSX.utils.book_append_sheet(wb, ws, nm);
      });
      XLSX.writeFile(wb, `labmate-${entity.label}-양식.xlsx`);
    } catch (e) { setMsg(apiError(e)); } finally { setBusy(false); }
  }

  // 현재 데이터 → 시트(XLSX). 값은 top-level 필드(없으면 meta 하위), 다중 탭은 kind로 분리
  async function downloadData() {
    const src = entity.exportList || entity.list;
    if (!src) { setMsg("이 항목은 내보내기를 지원하지 않습니다."); return; }
    setBusy(true); setMsg("내보내는 중…"); setErrors([]);
    try {
      let items = (await api.get<any[]>(src)).data;
      if (entity.exportResolve) items = await entity.exportResolve(items);
      const ds = await defs();
      const multi = ds.length > 1;
      const cell = (o: any, f: string) => { const v = o?.[f] ?? o?.meta?.[f]; return v == null ? "" : String(v); };
      const wb = XLSX.utils.book_new();
      const used = new Set<string>();
      ds.forEach((d) => {
        const rows = multi ? items.filter((it) => String(it.kind || "") === d.name) : items;
        const aoa = [d.cols.map(([, ko]) => ko), ...rows.map((it) => d.cols.map(([field]) => cell(it, field)))];
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        let nm = safeName(d.name); let i = 2;
        while (used.has(nm)) nm = safeName(d.name + i++);
        used.add(nm);
        XLSX.utils.book_append_sheet(wb, ws, nm);
      });
      XLSX.writeFile(wb, `labmate-${entity.label}-데이터.xlsx`);
      setMsg(`내보내기 완료 — ${items.length}건`);
    } catch (e) { setMsg(apiError(e)); } finally { setBusy(false); }
  }

  async function upload(file: File) {
    setBusy(true); setMsg("처리 중…"); setErrors([]);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      normalizeDateCells(wb);   // 엑셀 날짜 셀 → ISO 문자열(서버 date 검증 통과)
      const ds = await defs();
      const multi = ds.length > 1;
      let byKey: Record<string, any> = {};
      // upsert 매칭 키 — 복합(matchKeyFn) 우선, 없으면 단일(matchKey).
      const keyOf = entity.matchKeyFn ? entity.matchKeyFn : (entity.matchKey ? (x: any) => x[entity.matchKey!] : null);
      if (keyOf && entity.list) {
        const existing = (await api.get<any[]>(entity.list)).data;
        byKey = Object.fromEntries(existing.map((x) => [String(keyOf(x)), x]));
      }
      const mapRow = entity.resolver ? await entity.resolver() : null;
      let added = 0, updated = 0; const errs: string[] = [];

      for (const d of ds) {
        // 다중 탭이면 시트명으로, 단일이면 첫 시트
        const sheetName = multi ? (wb.SheetNames.find((n) => n === safeName(d.name) || n === d.name) || "") : wb.SheetNames[0];
        if (!sheetName || !wb.Sheets[sheetName]) continue;
        const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: "" });
        if (rows.length < 2) continue;
        const koToKey = Object.fromEntries(d.cols.map(([k, ko]) => [String(ko).trim(), k]));
        const fields = rows[0].map((h: any) => koToKey[String(h).trim()] || String(h).trim());
        const req = d.required || entity.required;
        for (let r = 1; r < rows.length; r++) {
          if (!rows[r] || !rows[r].some((c: any) => String(c ?? "").trim())) continue;
          let rec: any = {};
          fields.forEach((f: string, i: number) => { rec[f] = String(rows[r][i] ?? "").trim(); });
          const miss = req.filter((f) => !rec[f]);
          if (miss.length) { errs.push(`[${d.name}] ${r}행: ${miss.join("·")} 누락`); continue; }
          for (const f of d.intFields || []) { const n = parseInt(String(rec[f]).replace(/[^0-9-]/g, ""), 10); if (Number.isNaN(n)) delete rec[f]; else rec[f] = n; }
          if (d.transform) rec = d.transform(rec);
          if (mapRow) { const m = mapRow(rec); if (m == null) { errs.push(`[${d.name}] ${r}행: 참조(예: 과제 관리코드)를 찾을 수 없음`); continue; } rec = m; }
          try {
            const recKey = keyOf ? String(keyOf(rec)) : "";
            const ex = keyOf ? byKey[recKey] : null;
            if (ex && entity.patchBase) { await api.patch(`${entity.patchBase}${ex.id}`, rec); updated++; }   // 매칭키 포함 전송(ProjectIn.code 등 필수 필드 보존)
            else {
              const cr = await api.post(entity.create, { ...rec, ...(d.createDefaults || entity.createDefaults || {}) }); added++;
              if (keyOf && cr?.data?.id) byKey[recKey] = cr.data;   // 같은 파일 내 중복 방지
            }
          } catch (e) { errs.push(`[${d.name}] ${r}행(${rec[req[0]] || ""}): ${apiError(e)}`); }
        }
      }
      const summary = `완료 — 추가 ${added}건, 수정 ${updated}건${errs.length ? `, 오류 ${errs.length}건` : ""}.`;
      setMsg(summary);
      setErrors(errs);
      onResult?.({ label: entity.label, msg: summary, errors: errs });
      if (added + updated > 0) onDone?.();
    } catch (e) { const m = apiError(e); setMsg(m); onResult?.({ label: entity.label, msg: m, errors: [] }); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }


  return (
    <>
      <button type="button" className="btn ghost" data-testid={`${testid}-open`} onClick={() => { setOpen(true); setMsg(""); setErrors([]); }}>📄 시트 업로드</button>
      {open && (
        <div className="modal-ovl" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="modal" data-testid={`${testid}-modal`} style={{ width: 560, maxWidth: "92%" }}>
            <div className="modal-h"><b>{entity.label} 시트 일괄 업로드</b><button className="btn ghost sm" onClick={() => setOpen(false)}>✕</button></div>
            <div className="modal-b">
              <ol className="muted small" style={{ margin: "0 0 10px", paddingLeft: 18, lineHeight: 1.7 }}>
                <li>아래 <b>엑셀 양식(XLSX)</b>을 내려받아 데이터를 채웁니다. (헤더 행 유지{(entity.tabs || entity.buildTabs) ? ", 종류별 탭에 입력" : ""})</li>
                <li>엑셀 파일을 선택하면 즉시 일괄 등록됩니다. {entity.matchKey ? "동일 키는 갱신(upsert)됩니다." : ""}</li>
              </ol>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button type="button" className="btn ghost sm" data-testid={`${testid}-tpl`} disabled={busy} onClick={downloadTemplate}>⬇ 엑셀 양식(XLSX)</button>
                {(entity.exportList || entity.list) && <button type="button" className="btn ghost sm" data-testid={`${testid}-export`} disabled={busy} onClick={downloadData}>⬆ 현재 데이터 내보내기</button>}
                <input ref={fileRef} type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-testid={`${testid}-file`} disabled={busy}
                  style={{ minWidth: 0, maxWidth: "100%" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
              </div>
              {msg && <div className="io" style={{ marginTop: 10 }} data-testid={`${testid}-msg`}>{msg}</div>}
              {!!errors.length && (
                <div className="form-err" style={{ marginTop: 8, maxHeight: 160, overflow: "auto" }}>
                  {errors.slice(0, 50).map((e, i) => <div key={i} className="small">{e}</div>)}
                </div>
              )}
            </div>
            <div className="modal-f"><button className="btn ghost" onClick={() => setOpen(false)}>닫기</button></div>
          </div>
        </div>
      )}
    </>
  );
}
