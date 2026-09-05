import { useEffect, useState, useId } from "react";
import { api, apiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PageHeader, Card } from "../ui/kit";
import { usePref } from "../api/prefs";

const ROLE_KO: Record<string, string> = { prof: "지도교수", phd: "박사과정", master: "석사과정", under: "학사과정", staff: "행정", admin: "관리자" };

export default function MyPage() {
  const uid = useId();   // 라벨-입력 연결용 고유 접두사
  const { refreshMe } = useAuth();
  const [p, setP] = useState<any>(null);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<any>({});
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [pw, setPw] = useState({ current_password: "", new_password: "", confirm: "" });
  const [pwMsg, setPwMsg] = useState("");
  const up = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  // 딥워크 — 매일 같은 시각에 방해받지 않는 시간을 확보하는 방식이 대학원생에게 가장
  // 현실적이라 알려져 있다. 그 시간대에는 알림을 띄우지 않는다.
  const [deep, setDeep] = usePref<{ on: boolean; from: string; to: string }>("deep_work", { on: false, from: "09:00", to: "11:00" });

  async function load() { try { setP((await api.get("/members/me")).data); } catch (e) { setErr(apiError(e)); } }
  useEffect(() => { load(); }, []);

  function startEdit() {
    setForm({
      name: p.name || "", name_en: p.name_en || "", gender: p.gender || "", birth: p.birth || "", phone: p.phone || "",
      dept: p.dept || "", student_id: p.student_id || "", researcher_no: p.researcher_no || "", degree: p.degree || "", major: p.major || "", grad_year: p.grad_year || "",
    });
    setEdit(true); setMsg(""); setErr("");
  }
  async function saveProfile() {
    setErr("");
    const payload: any = { ...form }; if (!payload.birth) delete payload.birth;
    try { await api.patch("/members/me", payload); await refreshMe(); await load(); setEdit(false); setMsg("저장되었습니다 ✓"); }
    catch (e) { setErr(apiError(e)); }
  }
  async function changePw(e: React.FormEvent) {
    e.preventDefault(); setPwMsg("");
    if (pw.new_password.length < 8) { setPwMsg("새 비밀번호는 8자 이상이어야 합니다"); return; }
    if (pw.new_password !== pw.confirm) { setPwMsg("새 비밀번호가 일치하지 않습니다"); return; }
    try {
      await api.post("/members/change-password", { current_password: pw.current_password, new_password: pw.new_password });
      setPw({ current_password: "", new_password: "", confirm: "" }); setPwMsg("비밀번호가 변경되었습니다 ✓");
    } catch (e) { setPwMsg(apiError(e)); }
  }

  if (!p) return <div data-testid="page-mypage" className="muted" style={{ padding: 16 }}>불러오는 중…</div>;

  return (
    <div data-testid="page-mypage">
      <PageHeader crumb="마이페이지" title="마이페이지" action={!edit && <button className="btn primary" data-testid="mp-edit" onClick={startEdit}>정보 수정</button>} />
      {err && <div className="form-err">{err}</div>}
      {msg && <div className="io">{msg}</div>}

      <Card title="개인정보" testid="mp-profile">
        {!edit ? (
          <table className="tbl"><tbody>
            <tr><th style={{ width: 130 }}>이름</th><td>{p.name} <span className="muted small">{ROLE_KO[p.role] || p.role}{p.delegated_admin ? " · 행정위임" : ""}</span></td></tr>
            <tr><th>이메일</th><td>{p.email} <span className="muted small">(로그인 ID · 변경 불가)</span></td></tr>
            {[["영문이름", p.name_en], ["성별", p.gender], ["생년월일", p.birth], ["휴대폰", p.phone],
              ["학과", p.dept], ["학번", p.student_id], ["과학기술인번호", p.researcher_no],
              ["최종학위", p.degree], ["전공", p.major], ["학위취득년도", p.grad_year],
              ["입실(입사)일", p.join_date]].map(([k, v]) => <tr key={k as string}><th>{k}</th><td>{v || "—"}</td></tr>)}
          </tbody></table>
        ) : (
          <>
            <div className="bd grid2" style={{ padding: 0 }}>
              <div className="fsec first">신원</div>
              <div><label htmlFor={`${uid}-1`}>이름</label><input id={`${uid}-1`} data-testid="mp-name" value={form.name} onChange={(e) => up("name", e.target.value)} /></div>
              <div><label htmlFor={`${uid}-2`}>영문이름</label><input id={`${uid}-2`} value={form.name_en} onChange={(e) => up("name_en", e.target.value)} /></div>
              <div><label htmlFor={`${uid}-3`}>성별</label><select id={`${uid}-3`} value={form.gender} onChange={(e) => up("gender", e.target.value)}><option value="">(선택)</option><option>남</option><option>여</option></select></div>
              <div><label htmlFor={`${uid}-4`}>생년월일</label><input id={`${uid}-4`} type="date" value={form.birth} onChange={(e) => up("birth", e.target.value)} /></div>
              <div><label htmlFor={`${uid}-5`}>휴대폰</label><input id={`${uid}-5`} data-testid="mp-phone" value={form.phone} onChange={(e) => up("phone", e.target.value)} /></div>
              <div className="fsec">소속</div>
              <div><label htmlFor={`${uid}-6`}>학과</label><input id={`${uid}-6`} value={form.dept} onChange={(e) => up("dept", e.target.value)} /></div>
              <div><label htmlFor={`${uid}-7`}>학번</label><input id={`${uid}-7`} value={form.student_id} onChange={(e) => up("student_id", e.target.value)} /></div>
              <div className="fsec">과제 정보</div>
              <div><label htmlFor={`${uid}-8`}>과학기술인번호</label><input id={`${uid}-8`} value={form.researcher_no} onChange={(e) => up("researcher_no", e.target.value)} /></div>
              <div><label htmlFor={`${uid}-9`}>최종학위</label><input id={`${uid}-9`} value={form.degree} onChange={(e) => up("degree", e.target.value)} placeholder="예: 석사" /></div>
              <div><label htmlFor={`${uid}-10`}>전공</label><input id={`${uid}-10`} value={form.major} onChange={(e) => up("major", e.target.value)} /></div>
              <div><label htmlFor={`${uid}-11`}>학위취득년도</label><input id={`${uid}-11`} value={form.grad_year} onChange={(e) => up("grad_year", e.target.value)} placeholder="예: 2024" /></div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn primary" data-testid="mp-save" onClick={saveProfile}>저장</button>
              <button className="btn ghost" onClick={() => setEdit(false)}>취소</button>
            </div>
          </>
        )}
      </Card>

      <Card title="비밀번호 변경" testid="mp-pw">
        <form onSubmit={changePw}>
          <div className="bd grid2" style={{ padding: 0 }}>
            <div><label htmlFor={`${uid}-12`}>현재 비밀번호</label><input id={`${uid}-12`} type="password" data-testid="mp-pw-cur" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></div>
            <div />
            <div><label htmlFor={`${uid}-13`}>새 비밀번호</label><input id={`${uid}-13`} type="password" data-testid="mp-pw-new" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /></div>
            <div><label htmlFor={`${uid}-14`}>새 비밀번호 확인</label><input id={`${uid}-14`} type="password" data-testid="mp-pw-confirm" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></div>
          </div>
          {pwMsg && <div className={pwMsg.includes("✓") ? "io" : "form-err"} style={{ marginTop: 8 }}>{pwMsg}</div>}
          <div style={{ marginTop: 12 }}><button className="btn primary" data-testid="mp-pw-submit">비밀번호 변경</button></div>
        </form>
      </Card>

      <Card title="딥워크 시간" testid="mp-deep">
        <p className="muted small" style={{ marginTop: 0 }}>
          매일 같은 시각에 방해받지 않는 시간을 정해 두면 연구가 밀리지 않습니다.
          이 시간에는 <b>알림을 띄우지 않고</b> 캘린더에 블록으로 표시합니다.
        </p>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
          <input type="checkbox" data-testid="mp-deep-on" checked={deep.on} onChange={(e) => setDeep({ ...deep, on: e.target.checked })} />
          사용
        </label>
        {/* 제목 줄과 입력 줄을 나란히 맞춘다. 한국어 시간 표기("오전 09:00" + 시계 아이콘)가
            잘리지 않도록 칸을 넉넉히 준다. */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px", maxWidth: 360 }}>
          <label htmlFor={`${uid}-df`} className="muted small">시작</label>
          <label htmlFor={`${uid}-dt`} className="muted small">종료</label>
          <input id={`${uid}-df`} type="time" data-testid="mp-deep-from" value={deep.from} disabled={!deep.on}
            onChange={(e) => setDeep({ ...deep, from: e.target.value })} style={{ margin: 0 }} />
          <input id={`${uid}-dt`} type="time" data-testid="mp-deep-to" value={deep.to} disabled={!deep.on}
            onChange={(e) => setDeep({ ...deep, to: e.target.value })} style={{ margin: 0 }} />
        </div>
      </Card>
    </div>
  );
}
