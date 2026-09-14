// 브라우저 confirm/alert/prompt 대체용 자체 디자인 팝업
import { useEffect, useState } from "react";

type Kind = "confirm" | "alert" | "prompt";
interface Req { kind: Kind; message: string; title?: string; def?: string; danger?: boolean; wide?: boolean; resolve: (v: any) => void; }
let _push: ((r: Req) => void) | null = null;

/** wide: 목록처럼 한 줄이 긴 내용을 접지 않고 보여 줄 때 */
export function confirmDialog(message: string, opts?: { title?: string; danger?: boolean; wide?: boolean }): Promise<boolean> {
  return new Promise((resolve) => _push ? _push({ kind: "confirm", message, ...opts, resolve }) : resolve(window.confirm(message)));
}
export function alertDialog(message: string, opts?: { title?: string }): Promise<void> {
  return new Promise((resolve) => _push ? _push({ kind: "alert", message, ...opts, resolve }) : (window.alert(message), resolve()));
}
export function promptDialog(message: string, def = "", opts?: { title?: string }): Promise<string | null> {
  return new Promise((resolve) => _push ? _push({ kind: "prompt", message, def, ...opts, resolve }) : resolve(window.prompt(message, def)));
}

export function DialogHost() {
  const [q, setQ] = useState<Req[]>([]);
  const [val, setVal] = useState("");
  useEffect(() => { _push = (r) => setQ((cur) => [...cur, r]); return () => { _push = null; }; }, []);
  const cur = q[0];
  useEffect(() => { if (cur?.kind === "prompt") setVal(cur.def || ""); }, [cur]);
  if (!cur) return null;
  const finish = (result: any) => { cur.resolve(result); setQ((c) => c.slice(1)); };
  const cancel = () => finish(cur.kind === "confirm" ? false : cur.kind === "prompt" ? null : undefined);
  const ok = () => finish(cur.kind === "confirm" ? true : cur.kind === "prompt" ? val : undefined);
  return (
    <div className="modal-ovl" onClick={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div className="modal" style={{ width: cur.wide ? 860 : 420, maxWidth: "92%" }} data-testid="app-dialog">
        <div className="modal-h"><b>{cur.title || (cur.kind === "alert" ? "알림" : cur.kind === "prompt" ? "입력" : "확인")}</b></div>
        <div className="modal-b">
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{cur.message}</div>
          {cur.kind === "prompt" && <input autoFocus data-testid="dialog-input" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") ok(); if (e.key === "Escape") cancel(); }} style={{ marginTop: 10 }} />}
        </div>
        <div className="modal-f">
          {cur.kind !== "alert" && <button className="btn ghost" data-testid="dialog-cancel" onClick={cancel}>취소</button>}
          <button className="btn primary" data-testid="dialog-ok" style={cur.danger ? { background: "var(--bad)", borderColor: "var(--bad)" } : undefined} onClick={ok} autoFocus={cur.kind !== "prompt"}>확인</button>
        </div>
      </div>
    </div>
  );
}
