// 전자메일 — 연구실·업무 메일을 그룹웨어 안에서 함께 본다.
//
// 메일 본문은 LabMate 에 저장하지 않는다. 목록도 본문도 열 때마다 IMAP 서버에서
// 가져온다(원본이 늘 메일 서버에 있으므로 어긋날 일이 없고, 남의 메일이 우리 DB 에
// 쌓이지도 않는다). 대신 느릴 수 있어 화면은 "불러오는 중"을 분명히 보여 준다.
import { useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { api, apiError } from "../api/client";
import { useConfig } from "../api/config";
import { confirmDialog } from "../ui/dialog";
import HtmlEditor from "../ui/HtmlEditorLazy";
import { htmlToPlain } from "../ui/html";
import { Icon } from "../ui/icons";
import { Card, PageHeader } from "../ui/kit";

interface Account {
  id: string; label: string; address: string; login: string; hint: string;
  imap_host: string; imap_port: number; imap_ssl: boolean;
  smtp_host: string; smtp_port: number; smtp_tls: string; is_default: boolean;
}
interface Folder { path: string; label: string; kind: string; unread: number }
interface Brief {
  uid: string; subject: string; from_name: string; from_addr: string; to: string;
  date: string; size: number; seen: boolean; flagged: boolean; answered: boolean; attachments: number; preview: string;
}
interface Full extends Brief { html: string; text: string; cc: string; files: { index: number; name: string; size: number; mime: string }[] }

const emptyAcc = {
  label: "", address: "", login: "", password: "",
  imap_host: "", imap_port: 0, imap_ssl: true, smtp_host: "", smtp_port: 0, smtp_tls: "", is_default: false,
};
const FOLDER_ICON: Record<string, string> = {
  inbox: "mail", sent: "doc", drafts: "clipboard", trash: "folder", junk: "shield", archive: "folder",
};
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const shiftDay = (day: string, n: number) => { const d = new Date(day + "T00:00:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
/** 목록 오른쪽 시각 — 오늘은 시:분, 그 전은 날짜. 메일 앱의 오랜 관습이다. */
const when = (iso: string) => {
  if (!iso) return "";
  const d = iso.slice(0, 10);
  if (d === todayStr()) return iso.slice(11, 16);
  return `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
};
const WD = ["일", "월", "화", "수", "목", "금", "토"];
/** 목록 사이에 끼우는 날짜 머리 — 오늘·어제는 이름으로 부른다. */
const daySep = (iso: string) => {
  const d = iso.slice(0, 10);
  if (!d) return "날짜 없음";
  const t = todayStr();
  if (d === t) return "오늘";
  if (d === shiftDay(t, -1)) return "어제";
  const wd = WD[new Date(d + "T00:00:00").getDay()];
  return d.slice(0, 4) === t.slice(0, 4)
    ? `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일 (${wd})`
    : `${d.slice(0, 4)}년 ${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
};
// 보낸 사람마다 늘 같은 색 — 목록을 훑을 때 누가 보냈는지 글자보다 먼저 눈에 들어온다.
const HUES = [212, 259, 340, 12, 32, 152, 190, 280];
function avatar(name: string, addr: string) {
  const key = (addr || name || "?").toLowerCase();
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const src = (name || addr || "?").trim();
  const initial = /^[A-Za-z]/.test(src) ? src.slice(0, 1).toUpperCase() : src.slice(0, 1);
  return { bg: `hsl(${HUES[h % HUES.length]} 62% 47%)`, initial };
}
const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

export default function Mail() {
  const uid = useId();
  const domain = useConfig<string>("mail_domain", "");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accId, setAccId] = useState("");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folder, setFolder] = useState("INBOX");
  const [list, setList] = useState<Brief[]>([]);
  const [sel, setSel] = useState<Full | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "unseen" | "flagged">("all");
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [err, setErr] = useState("");
  const [setup, setSetup] = useState(false);          // 계정 설정 모달
  const [compose, setCompose] = useState<null | { to: string; cc: string; subject: string; body: string; reply: string }>(null);
  const [sending, setSending] = useState(false);
  const qRef = useRef("");
  const [params, setParams] = useSearchParams();       // 알림에서 눌러 들어온 메일(account·uid)
  const wanted = useRef({ acc: params.get("account") || "", uid: params.get("uid") || "" });

  const acc = accounts.find((a) => a.id === accId) || null;

  // ── 계정 ──
  async function loadAccounts() {
    try {
      const { data } = await api.get<Account[]>("/mail/accounts");
      setAccounts(data);
      const want = wanted.current.acc && data.some((a) => a.id === wanted.current.acc) ? wanted.current.acc : "";
      setAccId((cur) => want || cur || data.find((a) => a.is_default)?.id || data[0]?.id || "");
    } catch (e) { setErr(apiError(e)); }
  }
  useEffect(() => { loadAccounts(); }, []);

  // ── 메일함 ──
  useEffect(() => {
    if (!accId) return;
    setFolders([]); setFolder("INBOX"); setSel(null);
    api.get<Folder[]>(`/mail/folders?account_id=${accId}`).then((r) => setFolders(r.data)).catch((e) => setErr(apiError(e)));
  }, [accId]);

  async function loadList(query = qRef.current) {
    if (!accId) return;
    setLoading(true); setErr("");
    try {
      const { data } = await api.get<Brief[]>(
        `/mail/messages?account_id=${accId}&folder=${encodeURIComponent(folder)}&q=${encodeURIComponent(query)}`);
      setList(data);
      api.get<Folder[]>(`/mail/folders?account_id=${accId}`).then((r) => setFolders(r.data)).catch(() => { /* 목록이 우선 */ });
    } catch (e) { setErr(apiError(e)); setList([]); } finally { setLoading(false); }
  }
  useEffect(() => { qRef.current = ""; setQ(""); setSel(null); loadList(""); /* eslint-disable-next-line */ }, [accId, folder]);

  // 알림에서 들어왔다면 그 메일을 펼쳐 준다 — 목록만 띄워 놓고 찾게 하지 않는다.
  useEffect(() => {
    const want = wanted.current;
    if (!want.uid || !list.length || accId !== (want.acc || accId)) return;
    const hit = list.find((m) => m.uid === want.uid);
    wanted.current = { acc: "", uid: "" };
    setParams({}, { replace: true });                  // 주소창을 정리해 새로고침 때 다시 열리지 않게
    if (hit) open(hit);
    /* eslint-disable-next-line */
  }, [list, accId]);

  async function open(m: Brief) {
    setOpening(true); setErr("");
    try {
      const { data } = await api.get<Full>(
        `/mail/messages/${m.uid}?account_id=${accId}&folder=${encodeURIComponent(folder)}`);
      setSel(data);
      if (!m.seen) setFolders((fs) => fs.map((f) => (f.path === folder ? { ...f, unread: Math.max(0, f.unread - 1) } : f)));
      setList((ls) => ls.map((x) => (x.uid === m.uid ? { ...x, seen: true } : x)));
    } catch (e) { setErr(apiError(e)); } finally { setOpening(false); }
  }

  async function star(m: Brief) {
    try {
      await api.post(`/mail/messages/${m.uid}/flags?account_id=${accId}&folder=${encodeURIComponent(folder)}`, { flagged: !m.flagged });
      setList((ls) => ls.map((x) => (x.uid === m.uid ? { ...x, flagged: !x.flagged } : x)));
      setSel((s) => (s && s.uid === m.uid ? { ...s, flagged: !s.flagged } : s));
    } catch (e) { setErr(apiError(e)); }
  }

  async function download(f: { index: number; name: string }) {
    if (!sel) return;
    try {
      const r = await api.get(
        `/mail/messages/${sel.uid}/attachments/${f.index}?account_id=${accId}&folder=${encodeURIComponent(folder)}`,
        { responseType: "blob" });
      const url = URL.createObjectURL(r.data as Blob);
      const a = document.createElement("a"); a.href = url; a.download = f.name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setErr(apiError(e)); }
  }

  // ── 보내기 ──
  function newMail() { setCompose({ to: "", cc: "", subject: "", body: "", reply: "" }); }
  function reply() {
    if (!sel) return;
    const quoted = `<br><br><blockquote>${sel.from_name} 님이 ${sel.date} 에 쓴 글:<br>${sel.html || (sel.text || "").replace(/\n/g, "<br>")}</blockquote>`;
    setCompose({
      to: sel.from_addr, cc: "", reply: sel.uid,
      subject: /^re:/i.test(sel.subject) ? sel.subject : `Re: ${sel.subject}`,
      body: quoted,
    });
  }
  async function send() {
    if (!compose || !accId) return;
    if (!compose.to.trim()) { setErr("받는 사람을 적어 주세요"); return; }
    setSending(true); setErr("");
    try {
      await api.post("/mail/send", {
        account_id: accId, to: compose.to, cc: compose.cc, subject: compose.subject,
        html: compose.body, text: htmlToPlain(compose.body),
      });
      setCompose(null);
    } catch (e) { setErr(apiError(e)); } finally { setSending(false); }
  }

  const shown = list.filter((m) => (filter === "unseen" ? !m.seen : filter === "flagged" ? m.flagged : true));

  return (
    <div data-testid="page-mail">
      <PageHeader crumb="소통 › 전자메일" title="전자메일"
        action={
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            {accounts.length > 1 && (
              <select value={accId} onChange={(e) => setAccId(e.target.value)} aria-label="계정" data-testid="mail-account" style={{ margin: 0, maxWidth: 260 }}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.label || a.address}</option>)}
              </select>
            )}
            <button className="btn ghost sm" data-testid="mail-setup" onClick={() => setSetup(true)}>계정 설정</button>
            <button className="btn primary sm" data-testid="mail-new" disabled={!accId} onClick={newMail}>메일 쓰기</button>
          </span>} />

      {err && <div className="form-err" data-testid="mail-error">{err}</div>}

      {!accounts.length ? (
        <Card title="메일 계정이 없습니다">
          <div className="muted" style={{ padding: "8px 0 12px" }}>
            계정을 하나 추가하면 여기에서 메일을 읽고 보낼 수 있습니다. 연구실 메일과 학교 메일처럼
            여러 개를 함께 두어도 됩니다.
          </div>
          <button className="btn primary" onClick={() => setSetup(true)}>계정 추가</button>
        </Card>
      ) : (
        <div className="mail-layout">
          {/* 메일함 */}
          <div className="mail-folders card">
            {folders.map((f) => (
              <button key={f.path} className={"mail-folder" + (f.path === folder ? " on" : "")}
                data-testid={`mail-folder-${f.kind || f.path}`} onClick={() => setFolder(f.path)}>
                <span className="mail-folder-ico"><Icon name={FOLDER_ICON[f.kind] || "folder"} size={16} /></span>
                <span className="mail-folder-name">{f.label}</span>
                {f.unread > 0 && <span className="mail-unread" data-testid={`mail-unread-${f.kind || f.path}`}>{f.unread > 99 ? "99+" : f.unread}</span>}
              </button>
            ))}
            {!folders.length && <div className="muted small" style={{ padding: 10 }}>메일함을 불러오는 중…</div>}
          </div>

          {/* 목록 */}
          <div className="mail-list card">
            <div className="mail-list-head">
              <form onSubmit={(e) => { e.preventDefault(); qRef.current = q; loadList(q); }} style={{ display: "flex", gap: 6 }}>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="메일 검색" aria-label="메일 검색"
                  data-testid="mail-search" style={{ margin: 0 }} />
                <button className="btn ghost sm" type="submit">검색</button>
              </form>
              <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
                {([["all", "전체"], ["unseen", "읽지 않음"], ["flagged", "별표"]] as const).map(([k, l]) => (
                  <button key={k} className={"chip" + (filter === k ? " on" : "")} data-testid={`mail-filter-${k}`} onClick={() => setFilter(k)}>{l}</button>
                ))}
                <button className="btn ghost sm" style={{ marginLeft: "auto" }} data-testid="mail-refresh"
                  disabled={loading} onClick={() => loadList()}>{loading ? "…" : "새로고침"}</button>
              </div>
            </div>
            <div className="mail-rows" data-testid="mail-rows">
              {loading && <div className="muted small" style={{ padding: 14 }}>불러오는 중…</div>}
              {!loading && shown.map((m, i) => {
                const av = avatar(m.from_name, m.from_addr);
                const sep = daySep(m.date);
                const head = i === 0 || daySep(shown[i - 1].date) !== sep;
                return (
                  <div key={m.uid}>
                    {head && <div className="mail-daysep">{sep}</div>}
                    <button className={"mail-row" + (sel?.uid === m.uid ? " on" : "") + (m.seen ? "" : " unseen")}
                      data-testid={`mail-row-${m.uid}`} onClick={() => open(m)}>
                      <span className="mail-av" style={{ background: av.bg }} aria-hidden>{av.initial}</span>
                      <span className="mail-row-main">
                        <span className="mail-line">
                          <span className="mail-from">{m.from_name || m.from_addr}</span>
                          <span className="mail-when">{when(m.date)}</span>
                        </span>
                        <span className="mail-subject">
                          {!m.seen && <span className="mail-dot" aria-label="안 읽음" />}
                          {m.answered && <span className="mail-re" title="답장함">↩ </span>}
                          {m.subject}
                          {m.attachments > 0 && <span className="mail-clip" title="첨부 있음"> 📎</span>}
                        </span>
                      </span>
                      <span className={"mail-star" + (m.flagged ? " on" : "")} role="button" tabIndex={-1}
                        data-testid={`mail-star-${m.uid}`} onClick={(e) => { e.stopPropagation(); star(m); }}>{m.flagged ? "★" : "☆"}</span>
                    </button>
                  </div>
                );
              })}
              {!loading && !shown.length && (
                <div className="mail-empty">
                  <Icon name="mail" size={26} />
                  <div style={{ fontWeight: 600, marginTop: 8 }}>메일이 없습니다</div>
                  <div className="muted small">{q ? "검색 조건에 맞는 메일이 없습니다." : "새 메일이 도착하면 여기 표시됩니다."}</div>
                </div>
              )}
            </div>
          </div>

          {/* 본문 */}
          <div className="mail-view card">
            {opening && <div className="muted small" style={{ padding: 14 }}>여는 중…</div>}
            {!opening && !sel && (
              <div className="mail-empty">
                <Icon name="mail" size={26} />
                <div style={{ fontWeight: 600, marginTop: 8 }}>메일을 선택하세요</div>
                <div className="muted small">왼쪽 목록에서 메일을 고르면 여기에 표시됩니다.</div>
              </div>
            )}
            {!opening && sel && (
              <>
                <div className="mail-view-head">
                  <h2 className="mail-title">{sel.subject}</h2>
                  <div className="mail-sender">
                    <span className="mail-av lg" style={{ background: avatar(sel.from_name, sel.from_addr).bg }} aria-hidden>
                      {avatar(sel.from_name, sel.from_addr).initial}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <div><b>{sel.from_name || sel.from_addr}</b> <span className="muted small">&lt;{sel.from_addr}&gt;</span></div>
                      <div className="muted small">받는 사람 {sel.to}{sel.cc ? ` · 참조 ${sel.cc}` : ""}</div>
                    </span>
                    <span className="muted small" style={{ whiteSpace: "nowrap" }}>{sel.date.replace("T", " ")}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                    <button className="btn ghost sm" data-testid="mail-reply" onClick={reply}>답장</button>
                    <button className="btn ghost sm" onClick={() => star(sel)}>{sel.flagged ? "★ 별표 해제" : "☆ 별표"}</button>
                  </div>
                </div>
                {!!sel.files.length && (
                  <div className="mail-files">
                    {sel.files.map((f) => (
                      <button key={f.index} className="btn ghost sm" data-testid={`mail-file-${f.index}`} onClick={() => download(f)}>
                        📎 {f.name} <span className="muted">({size(f.size)})</span>
                      </button>
                    ))}
                  </div>
                )}
                {/* 남이 보낸 HTML 이라 격리해서 그린다 — sandbox 로 스크립트·폼을 막는다 */}
                {sel.html
                  ? <iframe className="mail-body" title="메일 본문" sandbox="" data-testid="mail-body" srcDoc={sel.html} />
                  : <pre className="mail-body-text" data-testid="mail-body">{sel.text}</pre>}
              </>
            )}
          </div>
        </div>
      )}

      {setup && <AccountSetup accounts={accounts} domain={domain} onClose={() => { setSetup(false); loadAccounts(); }} />}

      {compose && (
        <div className="modal-ovl" onClick={(e) => { if (e.target === e.currentTarget) setCompose(null); }}>
          <div className="modal mail-modal" data-testid="mail-compose">
            <div className="modal-h"><b>메일 쓰기</b><button className="btn ghost sm" onClick={() => setCompose(null)}>✕</button></div>
            <div className="modal-b">
              <label htmlFor={`${uid}-to`}>받는 사람</label>
              <input id={`${uid}-to`} value={compose.to} data-testid="mail-to" placeholder="여럿이면 쉼표로 구분"
                onChange={(e) => setCompose({ ...compose, to: e.target.value })} />
              <label htmlFor={`${uid}-cc`}>참조(선택)</label>
              <input id={`${uid}-cc`} value={compose.cc} data-testid="mail-cc"
                onChange={(e) => setCompose({ ...compose, cc: e.target.value })} />
              <label htmlFor={`${uid}-subj`}>제목</label>
              <input id={`${uid}-subj`} value={compose.subject} data-testid="mail-subject"
                onChange={(e) => setCompose({ ...compose, subject: e.target.value })} />
              <label>본문</label>
              <HtmlEditor value={compose.body} onChange={(v) => setCompose({ ...compose, body: v })} minHeight={220} testid="mail-body-editor" />
              <div className="muted small" style={{ marginTop: 6 }}>보내는 계정: {acc?.address}</div>
            </div>
            <div className="modal-f">
              <button className="btn primary" data-testid="mail-send" disabled={sending} onClick={send}>{sending ? "보내는 중…" : "보내기"}</button>
              <button className="btn ghost" onClick={() => setCompose(null)}>취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 계정 추가·수정·삭제 — 비밀번호는 넣기만 하고 다시 보이지 않는다(마스킹만). */
function AccountSetup({ accounts, domain, onClose }: { accounts: Account[]; domain: string; onClose: () => void }) {
  const uid = useId();
  const [form, setForm] = useState<any | null>(null);        // null 이면 목록
  const [editId, setEditId] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState(accounts);
  const [adv, setAdv] = useState(false);                     // 서버 직접 지정

  async function reload() {
    try { setRows((await api.get<Account[]>("/mail/accounts")).data); } catch (e) { setErr(apiError(e)); }
  }
  async function save() {
    setBusy(true); setErr(""); setMsg("");
    try {
      if (editId) await api.patch(`/mail/accounts/${editId}`, form);
      else await api.post("/mail/accounts", form);
      setForm(null); setEditId(""); setMsg("저장했습니다"); reload();
    } catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  }
  async function del(a: Account) {
    if (!await confirmDialog(`${a.address} 계정을 지울까요? 메일 자체는 메일 서버에 그대로 남습니다.`, { danger: true })) return;
    try { await api.delete(`/mail/accounts/${a.id}`); reload(); } catch (e) { setErr(apiError(e)); }
  }
  async function test(a: Account) {
    setBusy(true); setMsg("연결 확인 중…"); setErr("");
    try {
      const { data } = await api.post<{ ok: boolean; imap: string; smtp: string }>(`/mail/accounts/${a.id}/test`, {});
      setMsg(`받기(IMAP): ${data.imap} · 보내기(SMTP): ${data.smtp}`);
    } catch (e) { setErr(apiError(e)); setMsg(""); } finally { setBusy(false); }
  }

  return (
    <div className="modal-ovl" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal mail-modal" data-testid="mail-setup-modal">
        <div className="modal-h"><b>메일 계정</b><button className="btn ghost sm" onClick={onClose}>✕</button></div>
        <div className="modal-b">
          {err && <div className="form-err">{err}</div>}
          {msg && <div className="io">{msg}</div>}

          {!form && (
            <>
              <table className="tbl" data-testid="mail-acc-table">
                <thead><tr><th>이름</th><th>주소</th><th style={{ width: 90 }}>비밀번호</th><th style={{ width: 210 }}></th></tr></thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id}>
                      <td>{a.label}{a.is_default && <span className="pill">기본</span>}</td>
                      <td>{a.address}</td>
                      <td className="muted small">{a.hint ? "설정됨" : "없음"}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="btn ghost sm" disabled={busy} onClick={() => test(a)}>연결 확인</button>{" "}
                        <button className="btn ghost sm" onClick={() => { setEditId(a.id); setAdv(!!a.imap_host || !!a.smtp_host); setForm({ ...emptyAcc, ...a, password: "" }); }}>수정</button>{" "}
                        <button className="btn ghost sm" style={{ color: "var(--bad-text)" }} onClick={() => del(a)}>삭제</button>
                      </td>
                    </tr>
                  ))}
                  {!rows.length && <tr><td colSpan={4} className="muted">등록된 계정이 없습니다.</td></tr>}
                </tbody>
              </table>
              <button className="btn primary" style={{ marginTop: 10 }} data-testid="mail-acc-add"
                onClick={() => { setEditId(""); setAdv(false); setForm({ ...emptyAcc }); }}>+ 계정 추가</button>
            </>
          )}

          {form && (
            <>
              <label htmlFor={`${uid}-label`}>이름</label>
              <input id={`${uid}-label`} value={form.label} data-testid="mail-acc-label" placeholder="연구실 메일"
                onChange={(e) => setForm({ ...form, label: e.target.value })} />
              <label htmlFor={`${uid}-addr`}>메일 주소</label>
              <input id={`${uid}-addr`} value={form.address} data-testid="mail-acc-address" placeholder={domain ? `name@${domain}` : "name@example.com"}
                onChange={(e) => setForm({ ...form, address: e.target.value })} />
              <label htmlFor={`${uid}-login`}>로그인 아이디(주소와 다를 때만)</label>
              <input id={`${uid}-login`} value={form.login} data-testid="mail-acc-login"
                onChange={(e) => setForm({ ...form, login: e.target.value })} />
              <label htmlFor={`${uid}-pw`}>비밀번호{editId && " (바꿀 때만 입력)"}</label>
              <input id={`${uid}-pw`} type="password" value={form.password} data-testid="mail-acc-password" autoComplete="new-password"
                onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <div className="muted small">서버에서 암호화해 보관하며, 저장 뒤에는 화면에 다시 나오지 않습니다.</div>
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center", marginTop: 8 }}>
                <input type="checkbox" checked={!!form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
                <span>기본 계정으로</span>
              </label>

              <div style={{ marginTop: 10 }}>
                <button className="btn ghost sm" type="button" onClick={() => setAdv(!adv)}>{adv ? "▾" : "▸"} 서버 직접 지정</button>
              </div>
              {adv && (
                <div className="g2" style={{ marginTop: 8 }}>
                  <div>
                    <label>IMAP 호스트</label>
                    <input value={form.imap_host} placeholder="비우면 공통 설정" onChange={(e) => setForm({ ...form, imap_host: e.target.value })} />
                    <label>IMAP 포트</label>
                    <input value={String(form.imap_port || "")} onChange={(e) => setForm({ ...form, imap_port: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })} />
                    <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" checked={!!form.imap_ssl} onChange={(e) => setForm({ ...form, imap_ssl: e.target.checked })} />
                      <span>SSL/TLS</span>
                    </label>
                  </div>
                  <div>
                    <label>SMTP 호스트</label>
                    <input value={form.smtp_host} placeholder="비우면 공통 설정" onChange={(e) => setForm({ ...form, smtp_host: e.target.value })} />
                    <label>SMTP 포트</label>
                    <input value={String(form.smtp_port || "")} onChange={(e) => setForm({ ...form, smtp_port: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })} />
                    <label>암호화</label>
                    <select value={form.smtp_tls} onChange={(e) => setForm({ ...form, smtp_tls: e.target.value })}>
                      <option value="">공통 설정</option>
                      <option value="starttls">STARTTLS</option>
                      <option value="ssl">SSL/TLS</option>
                      <option value="none">없음</option>
                    </select>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-f">
          {form
            ? <>
                <button className="btn primary" disabled={busy} data-testid="mail-acc-save" onClick={save}>저장</button>
                <button className="btn ghost" onClick={() => { setForm(null); setEditId(""); }}>취소</button>
              </>
            : <button className="btn ghost" onClick={onClose}>닫기</button>}
        </div>
      </div>
    </div>
  );
}
