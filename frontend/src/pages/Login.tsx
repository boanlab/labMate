import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { api, apiError } from "../api/client";
import { fileUrl } from "../api/config";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [brand, setBrand] = useState<{ login_logo?: string; login_subtitle?: string }>({});
  useEffect(() => { api.get("/boards/branding").then((r) => setBrand(r.data)).catch(() => {}); }, []);
  const [busy, setBusy] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const { mustChange } = await login(email, password);
      nav(mustChange ? "/change-password" : "/");
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand">
          {brand.login_logo && !logoFailed
            // 첨부는 로그인해야 열리므로, 공개 경로가 아닌 예전 로고는 안 보일 수 있다 → 글자 브랜드로 되돌린다
            ? <img className="brand-logo" src={fileUrl(brand.login_logo)} alt="로고" onError={() => setLogoFailed(true)} style={{ width: "100%", maxWidth: 200, height: "auto", display: "block", margin: 0 }} />
            : <><span className="brand-badge">L</span>LabMate</>}
        </div>
        <div className="muted" style={{ marginTop: 2, marginBottom: 20 }}>
          {brand.login_subtitle || "연구실 그룹웨어"}
        </div>
        <label htmlFor="login-email">이메일</label>
        <input
          id="login-email"
          data-testid="login-email"
          type="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
        />
        <label htmlFor="login-password">비밀번호</label>
        <input
          id="login-password"
          data-testid="login-password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {err && <div className="form-err" data-testid="login-error">{err}</div>}
        <button className="btn primary" data-testid="login-submit" disabled={busy} style={{ marginTop: 12, width: "100%" }}>
          {busy ? "로그인 중…" : "로그인"}
        </button>
      </form>
    </div>
  );
}
