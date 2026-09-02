import { useState, useId } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export default function ChangePassword() {
  const uid = useId();   // 라벨-입력 연결용 고유 접두사
  const { me, refreshMe } = useAuth();
  const nav = useNavigate();
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const forced = !!me?.must_change_password;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (pw.length < 8) return setErr("새 비밀번호는 8자 이상이어야 합니다");
    if (pw !== pw2) return setErr("새 비밀번호 확인이 일치하지 않습니다");
    setBusy(true);
    try {
      await api.post("/members/change-password", { current_password: cur, new_password: pw });
      await refreshMe();
      nav("/");
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand"><span className="brand-badge">L</span>비밀번호 변경</div>
        <div className="muted" style={{ marginBottom: 16 }}>
          {forced ? "첫 로그인입니다. 보안을 위해 비밀번호를 변경하세요." : "비밀번호를 변경합니다."}
        </div>
        <label htmlFor={`${uid}-1`}>현재 비밀번호</label>
        <input id={`${uid}-1`} data-testid="cp-current" type="password" value={cur} onChange={(e) => setCur(e.target.value)} />
        <label htmlFor={`${uid}-2`}>새 비밀번호 (8자 이상)</label>
        <input id={`${uid}-2`} data-testid="cp-new" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <label htmlFor={`${uid}-3`}>새 비밀번호 확인</label>
        <input id={`${uid}-3`} data-testid="cp-new2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        {err && <div className="form-err" data-testid="cp-error">{err}</div>}
        <button className="btn primary" data-testid="cp-submit" disabled={busy} style={{ marginTop: 12, width: "100%" }}>
          {busy ? "변경 중…" : "비밀번호 변경"}
        </button>
      </form>
    </div>
  );
}
