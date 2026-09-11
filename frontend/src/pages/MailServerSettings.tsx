// 메일서버 설정(관리자) — 연구실이 공통으로 쓰는 서버 값만 둔다.
//
// 사람마다 다른 주소·비밀번호는 여기 두지 않는다. 각자 전자메일 화면의 '계정 설정'에서
// 넣고, 비밀번호는 서버에서 암호화해 보관한다.
import { useEffect, useState } from "react";

import { api, apiError } from "../api/client";
import { clearConfigCache, saveConfig } from "../api/config";
import { Card } from "../ui/kit";

interface Cfg {
  mail_enabled: boolean;
  mail_imap_host: string; mail_imap_port: number; mail_imap_ssl: boolean;
  mail_smtp_host: string; mail_smtp_port: number; mail_smtp_tls: string;
  mail_domain: string; mail_list_size: number;
}

export function MailServerPanel() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.get<Cfg>("/mail/config").then((r) => setCfg(r.data)).catch((e) => setErr(apiError(e)));
  }, []);

  async function put<K extends keyof Cfg>(k: K, v: Cfg[K]) {
    if (!cfg) return;
    setCfg({ ...cfg, [k]: v });
    try { await saveConfig("mail", k, v); clearConfigCache(); setMsg("저장됨 ✓"); setErr(""); }
    catch (e) { setErr(apiError(e)); }
  }

  if (!cfg) return <div className="muted">불러오는 중…</div>;
  const num = (v: string, def: number) => { const n = Number(v.replace(/[^0-9]/g, "")); return n || def; };

  return (
    <div className="g2">
      <Card title="전자메일 사용" testid="mail-cfg-enable">
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={!!cfg.mail_enabled} data-testid="mail-enabled"
            onChange={(e) => put("mail_enabled", e.target.checked)} />
          <span>전자메일 메뉴를 켠다</span>
        </label>
        <div className="muted small" style={{ marginTop: 6 }}>
          꺼 두면 사이드바에 <b>전자메일</b>이 나타나지 않습니다. 서버 값을 먼저 채운 뒤 켜세요.
        </div>
        <label htmlFor="mail-domain">기본 도메인(선택)</label>
        <input id="mail-domain" value={cfg.mail_domain} placeholder="boanlab.com" data-testid="mail-domain"
          onChange={(e) => setCfg({ ...cfg, mail_domain: e.target.value })} onBlur={(e) => put("mail_domain", e.target.value.trim())} />
        <div className="muted small">계정을 추가할 때 주소 예시로만 씁니다.</div>
        <label htmlFor="mail-size">목록 한 번에 가져올 메일 수</label>
        <input id="mail-size" value={String(cfg.mail_list_size)} data-testid="mail-list-size"
          onChange={(e) => setCfg({ ...cfg, mail_list_size: num(e.target.value, 30) })}
          onBlur={(e) => put("mail_list_size", num(e.target.value, 30))} />
      </Card>

      <Card title="받는 서버 (IMAP)" testid="mail-cfg-imap">
        <label htmlFor="imap-host">호스트</label>
        <input id="imap-host" value={cfg.mail_imap_host} placeholder="imap.boanlab.com" data-testid="mail-imap-host"
          onChange={(e) => setCfg({ ...cfg, mail_imap_host: e.target.value })} onBlur={(e) => put("mail_imap_host", e.target.value.trim())} />
        <label htmlFor="imap-port">포트</label>
        <input id="imap-port" value={String(cfg.mail_imap_port)} data-testid="mail-imap-port"
          onChange={(e) => setCfg({ ...cfg, mail_imap_port: num(e.target.value, 993) })}
          onBlur={(e) => put("mail_imap_port", num(e.target.value, 993))} />
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", marginTop: 8 }}>
          <input type="checkbox" checked={!!cfg.mail_imap_ssl} data-testid="mail-imap-ssl"
            onChange={(e) => put("mail_imap_ssl", e.target.checked)} />
          <span>SSL/TLS (993) — 끄면 143 + STARTTLS</span>
        </label>
      </Card>

      <Card title="보내는 서버 (SMTP)" testid="mail-cfg-smtp">
        <label htmlFor="smtp-host">호스트</label>
        <input id="smtp-host" value={cfg.mail_smtp_host} placeholder="smtp.boanlab.com" data-testid="mail-smtp-host"
          onChange={(e) => setCfg({ ...cfg, mail_smtp_host: e.target.value })} onBlur={(e) => put("mail_smtp_host", e.target.value.trim())} />
        <label htmlFor="smtp-port">포트</label>
        <input id="smtp-port" value={String(cfg.mail_smtp_port)} data-testid="mail-smtp-port"
          onChange={(e) => setCfg({ ...cfg, mail_smtp_port: num(e.target.value, 587) })}
          onBlur={(e) => put("mail_smtp_port", num(e.target.value, 587))} />
        <label htmlFor="smtp-tls">암호화</label>
        <select id="smtp-tls" value={cfg.mail_smtp_tls} data-testid="mail-smtp-tls" onChange={(e) => put("mail_smtp_tls", e.target.value)}>
          <option value="starttls">STARTTLS (587)</option>
          <option value="ssl">SSL/TLS (465)</option>
          <option value="none">없음 (25)</option>
        </select>
      </Card>

      <Card title="알아 두실 점" testid="mail-cfg-note">
        <ul className="muted small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
          <li>메일 본문은 LabMate 에 저장하지 않습니다. 볼 때마다 메일 서버에서 가져옵니다.</li>
          <li>계정 비밀번호는 각자 입력하고 서버에서 암호화해 보관합니다 — 화면에는 다시 나오지 않습니다.</li>
          <li>학교 메일처럼 서버가 다른 계정은 각자 계정 설정에서 서버를 따로 지정할 수 있습니다.</li>
        </ul>
      </Card>

      {(msg || err) && <div className={err ? "form-err" : "io"} style={{ gridColumn: "1 / -1" }}>{err || msg}</div>}
    </div>
  );
}
