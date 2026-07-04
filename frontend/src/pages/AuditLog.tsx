import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../ui/kit";
import { dateKST, dtKST } from "../lib/date";

const SERVICES = ["members", "projects", "funds", "attendance", "boards", "resource"];
const SERVICE_KO: Record<string, string> = {
  members: "인증·구성원", projects: "연구과제·실적", funds: "예산·연구비·인건비",
  attendance: "근태·휴가", boards: "공지·게시판·회의·결재", resource: "자산·인프라·예약·교육",
};
const PAGE = 30;

export default function AuditLog() {
  const { me } = useAuth();
  const isAdmin = me?.role === "admin";
  const [audit, setAudit] = useState<any[]>([]);
  const [auditPage, setAuditPage] = useState(0);
  const [auditQ, setAuditQ] = useState("");
  const [auditSvc, setAuditSvc] = useState("");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadAudit(page: number) {
    setBusy(true);
    try {
      const all: any[] = [];
      for (const s of SERVICES) {
        try { const r = await api.get(`/${s}/admin/audit?skip=0&limit=200`); all.push(...(r.data.items || [])); } catch { /* */ }
      }
      all.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
      setAudit(all); setAuditPage(page);
    } finally { setBusy(false); }
  }
  useEffect(() => { if (isAdmin) loadAudit(0); /* eslint-disable-next-line */ }, []);

  const fAudit = audit.filter((a) =>
    (!auditSvc || a.service === auditSvc) &&
    (!auditFrom || dateKST(a.at) >= auditFrom) &&
    (!auditTo || dateKST(a.at) <= auditTo) &&
    (!auditQ || [a.actor, a.action, a.entity, a.detail].join(" ").toLowerCase().includes(auditQ.toLowerCase()))
  );
  const auditMax = Math.max(0, Math.ceil(fAudit.length / PAGE) - 1);
  const apg = Math.min(auditPage, auditMax);

  return (
    <div data-testid="page-audit">
      <PageHeader crumb="관리 › 감사로그" title="감사로그" />
      {!isAdmin && <div className="form-err">관리자만 감사로그를 볼 수 있습니다.</div>}
      {isAdmin && (
        <div className="card">
          <div className="card-h" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
            <b>감사로그</b>
            <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input data-testid="audit-search" placeholder="행위자·행위·대상 검색" value={auditQ} onChange={(e) => { setAuditQ(e.target.value); setAuditPage(0); }} style={{ width: 200, margin: 0 }} />
              <input data-testid="audit-from" type="date" value={auditFrom} max={auditTo || undefined} onChange={(e) => { setAuditFrom(e.target.value); setAuditPage(0); }} style={{ width: "auto", margin: 0 }} />
              <span className="muted small">~</span>
              <input data-testid="audit-to" type="date" value={auditTo} min={auditFrom || undefined} onChange={(e) => { setAuditTo(e.target.value); setAuditPage(0); }} style={{ width: "auto", margin: 0 }} />
              {(auditFrom || auditTo) && <button className="btn ghost sm" data-testid="audit-date-clear" onClick={() => { setAuditFrom(""); setAuditTo(""); setAuditPage(0); }}>기간 해제</button>}
              <select data-testid="audit-svc" value={auditSvc} onChange={(e) => { setAuditSvc(e.target.value); setAuditPage(0); }} style={{ width: "auto", margin: 0 }}>
                <option value="">전체 서비스</option>
                {SERVICES.map((s) => <option key={s} value={s}>{s} · {SERVICE_KO[s]}</option>)}
              </select>
              <span className="muted small">{fAudit.length}건{busy ? " · 불러오는 중…" : ""}</span>
            </span>
          </div>
          <table className="tbl" data-testid="audit-table">
            <thead><tr><th>시각</th><th>행위자</th><th>행위</th><th>대상</th><th>상세</th><th>서비스</th></tr></thead>
            <tbody>
              {fAudit.slice(apg * PAGE, apg * PAGE + PAGE).map((a, i) => (
                <tr key={i}>
                  <td className="muted small" style={{ whiteSpace: "nowrap" }}>{dtKST(a.at)}</td>
                  <td><b>{a.actor}</b></td>
                  <td><span className="badge s-info">{a.action}</span></td>
                  <td>{a.entity || "—"}</td>
                  <td className="muted small">{a.detail}</td>
                  <td className="muted small">{a.service}</td>
                </tr>
              ))}
              {!fAudit.length && <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 16 }}>{audit.length ? "검색 결과 없음" : "기록 없음"}</td></tr>}
            </tbody>
          </table>
          {fAudit.length > PAGE && (
            <div className="pager" style={{ padding: 10 }}>
              <button className="btn ghost sm" disabled={apg === 0} onClick={() => setAuditPage(apg - 1)}>◀</button>
              <span>{apg + 1} / {auditMax + 1}</span>
              <button className="btn ghost sm" disabled={apg >= auditMax} onClick={() => setAuditPage(apg + 1)}>▶</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
