import { useEffect, useState, useId } from "react";
import { api, apiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useConfig } from "../api/config";
import { DataTable, type Col } from "../ui/DataTable";

import { confirmDialog } from "../ui/dialog";
import { formSnapshot, confirmDiscard } from "../ui/kit";

interface Asset {
  id: string; asset_class: string; asset_no: string; name: string; spec: string; model: string;
  owner_id: string; project_id: string; building: string; floor: string; room: string;
  location: string; buy_date: string | null; note: string; bookable?: boolean;
}
const CLS_FB = ["연구실", "단국대", "산학협력단", "공통"];
const EMPTY = { asset_class: "연구실", asset_no: "", name: "", spec: "", model: "", owner_id: "", project_id: "", building: "", floor: "", room: "", location: "", buy_date: "", note: "", bookable: false };

export default function Assets() {
  const uid = useId();   // 라벨-입력 연결용 고유 접두사
  const { me } = useAuth();
  const CLS = useConfig<string[]>("asset_types", CLS_FB);
  const canManage = !!me && (["prof", "staff", "admin"].includes(me.role) || !!me.delegated_admin || !!me.infra_manager);
  const [items, setItems] = useState<Asset[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [grants, setGrants] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState("");
  const [form, setForm] = useState({ ...EMPTY });
  const [snap, setSnap] = useState("");   // 폼 초기 상태 — 작성 중 이탈 경고 판정용
  const up = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const pcode = (id: string) => grants.find((p) => p.id === id)?.code || "";

  const [loaded, setLoaded] = useState(false);   // 첫 조회 완료 여부 — "없음"과 "불러오는 중"을 구분
  async function load() {
    try {
      setItems((await api.get<Asset[]>("/resource/assets")).data);
      setUsers((await api.get<any[]>("/members/users")).data);
      setGrants((await api.get<any[]>("/projects/projects?kind=grant")).data);
    } catch (e) { setErr(apiError(e)); } finally { setLoaded(true); }
  }
  useEffect(() => { load(); }, []);

  function openNew() { setEditId(""); setForm({ ...EMPTY }); setAdding(true); setSnap(formSnapshot({ ...EMPTY })); }
  // 상단 토글 — 작성 중이면 확인 후 닫는다
  async function toggleForm() {
    if (!adding) return openNew();
    if (!(await confirmDiscard(formSnapshot(form) !== snap))) return;
    closeForm();
  }
  function editAsset(a: Asset) {
    setForm({ asset_class: a.asset_class, asset_no: a.asset_no, name: a.name, spec: a.spec, model: a.model, owner_id: a.owner_id || "", project_id: a.project_id || "", building: a.building || "", floor: a.floor || "", room: a.room || "", location: a.location || "", buy_date: a.buy_date || "", note: a.note || "", bookable: !!a.bookable });
    setEditId(a.id); setAdding(true); window.scrollTo({ top: 0, behavior: "smooth" });
    setSnap(formSnapshot({ asset_class: a.asset_class, asset_no: a.asset_no, name: a.name, spec: a.spec, model: a.model, owner_id: a.owner_id || "", project_id: a.project_id || "", building: a.building || "", floor: a.floor || "", room: a.room || "", location: a.location || "", buy_date: a.buy_date || "", note: a.note || "", bookable: !!a.bookable }));
  }
  function closeForm() { setAdding(false); setEditId(""); setForm({ ...EMPTY }); setSnap(""); }
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    if (!form.name.trim()) { setErr("자산명을 입력하세요"); return; }
    const payload = { ...form, buy_date: form.buy_date || null };
    try {
      if (editId) await api.patch(`/resource/assets/${editId}`, payload);
      else await api.post("/resource/assets", payload);
      closeForm(); load();
    } catch (e) { setErr(apiError(e)); }
  }
  async function del(a: Asset): Promise<boolean> {
    if (!await confirmDialog(`자산 "${a.name}"을(를) 삭제할까요?`, { danger: true })) return false;
    try { await api.delete(`/resource/assets/${a.id}`); load(); return true; } catch (e) { setErr(apiError(e)); return false; }
  }

  // 책임자는 구성원 계정이 아니라 자산대장에 적힌 이름 그대로다(외부 인원·퇴직자도 그대로 남는다).
  // 명부에서 찾아 바꾸려 들면 계정이 없는 사람이 모두 "(삭제된 구성원)"으로 보인다.
  const ownerName = (a: Asset) => a.owner_id.trim();
  const projCode = (a: Asset) => (a.project_id ? pcode(a.project_id) : "");
  const cols: Col<Asset>[] = [
    { key: "asset_class", label: "분류", value: (a) => a.asset_class, render: (a) => <span className="badge s-info">{a.asset_class}</span> },
    { key: "asset_no", label: "자산번호", value: (a) => a.asset_no, render: (a) => <span className="small">{a.asset_no || "—"}</span> },
    { key: "name", label: "자산명", value: (a) => a.name, render: (a) => <><b>{a.name}</b>{a.bookable && <span className="badge s-info" style={{ marginLeft: 6 }} title="자원예약에서 선택할 수 있습니다">예약</span>}</> },
    { key: "spec", label: "규격", render: (a) => <span className="small muted">{a.spec || "—"}</span> },
    { key: "model", label: "모델", render: (a) => <span className="small muted">{a.model || "—"}</span> },
    { key: "building", label: "건물", render: (a) => <span className="small">{a.building || "—"}</span> },
    { key: "floor", label: "층", render: (a) => <span className="small">{a.floor || "—"}</span> },
    { key: "room", label: "호실", render: (a) => <span className="small">{a.room || "—"}</span> },
    { key: "owner", label: "책임자", value: (a) => ownerName(a), render: (a) => <span className="small">{ownerName(a) || "—"}</span> },
    { key: "location", label: "위치", render: (a) => <span className="small">{a.location || "—"}</span> },
    { key: "project", label: "과제", render: (a) => <span className="small muted">{projCode(a) || "—"}</span> },
    { key: "buy_date", label: "구매일자", value: (a) => a.buy_date || "", render: (a) => <span className="small muted">{a.buy_date || "—"}</span> },
    { key: "note", label: "비고", render: (a) => <span className="small muted">{a.note || "—"}</span> },
    ...(canManage ? [{ key: "act", label: "작업", nowrap: true, render: (a: Asset) => (
      <span style={{ whiteSpace: "nowrap" }}>
        <button className="btn ghost sm" data-testid={`as-edit-${a.id}`} onClick={() => editAsset(a)}>수정</button>
      </span>
    ) } as Col<Asset>] : []),
  ];

  return (
    <div data-testid="page-assets">
      <div className="page-head">
        <div><div className="crumb">연구실 › 자산</div><h1>연구실 자산</h1></div>
        {canManage && <button className={"btn " + (adding ? "ghost" : "primary")} data-testid="asset-add-open" onClick={toggleForm}>{adding ? "닫기" : "+ 자산 등록"}</button>}
      </div>
      {err && <div className="form-err" data-testid="asset-error">{err}</div>}

      {adding && (
        <form className="card" onSubmit={save} data-testid="asset-form" style={{ marginBottom: 12 }}>
          <div className="card-h"><b>{editId ? "자산 수정" : "자산 등록"}</b></div>
          <div className="bd grid2">
            <div><label htmlFor={`${uid}-1`}>자산분류</label><select id={`${uid}-1`} data-testid="as-asset_class" value={form.asset_class} onChange={(e) => up("asset_class", e.target.value)}>{CLS.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label htmlFor={`${uid}-2`}>자산번호</label><input id={`${uid}-2`} data-testid="as-asset_no" value={form.asset_no} onChange={(e) => up("asset_no", e.target.value)} placeholder="예: 2023-0002" /></div>
            <div><label htmlFor={`${uid}-3`}>자산명 *</label><input id={`${uid}-3`} data-testid="as-name" value={form.name} onChange={(e) => up("name", e.target.value)} /></div>
            <div><label htmlFor={`${uid}-4`}>구매일자</label><input id={`${uid}-4`} data-testid="as-buy" type="date" value={form.buy_date} onChange={(e) => up("buy_date", e.target.value)} /></div>
            <div><label htmlFor={`${uid}-5`}>규격</label><input id={`${uid}-5`} data-testid="as-spec" value={form.spec} onChange={(e) => up("spec", e.target.value)} placeholder="예: 1400*700*700" /></div>
            <div><label htmlFor={`${uid}-6`}>모델</label><input id={`${uid}-6`} data-testid="as-model" value={form.model} onChange={(e) => up("model", e.target.value)} /></div>
            <div><label htmlFor={`${uid}-7`}>건물</label><input id={`${uid}-7`} data-testid="as-building" value={form.building} onChange={(e) => up("building", e.target.value)} placeholder="예: 소프트웨어 ICT관" /></div>
            <div><label htmlFor={`${uid}-8`}>층</label><input id={`${uid}-8`} data-testid="as-floor" value={form.floor} onChange={(e) => up("floor", e.target.value)} placeholder="예: B1" /></div>
            <div><label htmlFor={`${uid}-9`}>호실</label><input id={`${uid}-9`} data-testid="as-room" value={form.room} onChange={(e) => up("room", e.target.value)} placeholder="예: B104" /></div>
            <div><label htmlFor={`${uid}-10`}>위치</label><input id={`${uid}-10`} data-testid="as-loc" value={form.location} onChange={(e) => up("location", e.target.value)} placeholder="예: 학생연구실 / R2-VPN" /></div>
            <div><label htmlFor={`${uid}-11`}>책임자</label><input id={`${uid}-11`} data-testid="as-owner" value={form.owner_id} onChange={(e) => up("owner_id", e.target.value)} placeholder="책임자 이름" /></div>
            <div><label htmlFor={`${uid}-12`}>과제</label><select id={`${uid}-12`} data-testid="as-proj" value={form.project_id} onChange={(e) => up("project_id", e.target.value)}><option value="">(없음)</option>{grants.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></div>
            <div style={{ gridColumn: "1 / -1" }}><label htmlFor={`${uid}-13`}>비고</label><input id={`${uid}-13`} data-testid="as-note" value={form.note} onChange={(e) => up("note", e.target.value)} /></div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, width: "fit-content", cursor: "pointer" }}>
                <input type="checkbox" data-testid="as-bookable" checked={!!form.bookable} onChange={(e) => up("bookable", e.target.checked)} style={{ width: "auto", margin: 0, flexShrink: 0 }} />
                자원예약 대상
              </label>
              <div className="muted small">체크하면 [자원예약]의 자원 목록에 이 자산이 나타납니다 — 따로 등록할 필요가 없습니다.</div>
            </div>
          </div>
          <div className="bd" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn primary" data-testid="asset-add-submit">{editId ? "저장" : "등록"}</button>
            <button type="button" className="btn ghost" onClick={toggleForm}>취소</button>
            {editId && <button type="button" data-testid="asset-del" onClick={async () => { const a = items.find((x) => x.id === editId); if (a && await del(a)) closeForm(); }} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--bad-text)", fontSize: 11.5, textDecoration: "underline", cursor: "pointer", opacity: 0.85 }}>삭제</button>}
          </div>
        </form>
      )}

      <DataTable<Asset> rows={items} cols={cols} testid="asset-table" pageSize={12} autoHeight defaultSort="name"
        searchPlaceholder="자산명·번호·규격·모델·위치·책임자 검색…"
        searchKeys={(a) => [a.name, a.asset_no, a.spec, a.model, a.building, a.floor, a.room, a.location, a.note, ownerName(a), projCode(a)].join(" ")}
        chips={{ get: (a) => a.asset_class, values: CLS }}
        empty={loaded ? "자산 없음" : "불러오는 중…"} />
    </div>
  );
}
