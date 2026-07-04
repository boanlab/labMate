import { useEffect, useState, useRef } from "react";
import { richHtml } from "../ui/richHtml";
import { api, apiError } from "../api/client";
import { confirmDialog } from "../ui/dialog";
import { useAuth } from "../auth/AuthContext";
import { PageHeader, Card } from "../ui/kit";
import { useConfig, names } from "../api/config";
import HtmlEditor from "../ui/HtmlEditorLazy";

interface Lesson { title: string; type: string; dur?: string; ref: string; body?: string; id?: string; _k?: number; }
interface Course { id: string; cat: string; title: string; desc: string; lessons: any[]; required?: boolean; due?: string | null; owner_id?: string; }

export default function Library() {
  const { me } = useAuth();
  const canManage = !!me && ["prof", "phd", "staff", "admin"].includes(me.role);   // 강좌 개설
  const canEditCourse = (c: Course) => !!me && (c.owner_id === me.id || me.role === "prof");   // 수정·삭제: 소유자 또는 교수
  const [courses, setCourses] = useState<Course[]>([]);
  const [done, setDone] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [playing, setPlaying] = useState<any>(null);
  const ytEmbed = (u: string) => { const m = (u || "").match(/(?:youtu\.be\/|[?&]v=|embed\/)([\w-]{11})/); return m ? `https://www.youtube.com/embed/${m[1]}` : ""; };
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const COURSE_CATS = names(useConfig<any[]>("course_types", ["온보딩", "보안·윤리", "연구방법", "장비교육", "기타"]));
  const LESSON_TYPES = useConfig<string[]>("lesson_types", ["영상", "문서", "실습", "퀴즈"]);
  const nextK = useRef(1);
  const [activeLesson, setActiveLesson] = useState<number | null>(null);   // 편집 중인 강의 행만 에디터 마운트(성능)
  const newLesson = (): Lesson => ({ title: "", type: LESSON_TYPES[0] || "영상", ref: "", body: "", _k: nextK.current++ });
  const [cf, setCf] = useState<{ cat: string; title: string; desc: string; required: boolean; lessons: Lesson[] }>({ cat: "온보딩", title: "", desc: "", required: false, lessons: [] });

  async function load() {
    try {
      setCourses((await api.get<Course[]>("/resource/courses")).data);
      setDone((await api.get<{ done: string[] }>("/resource/courses/progress")).data.done);
    } catch (e) { setErr(apiError(e)); }
  }
  useEffect(() => { load(); }, []);

  function setLesson(i: number, patch: Partial<Lesson>) { setCf((c) => ({ ...c, lessons: c.lessons.map((l, j) => j === i ? { ...l, ...patch } : l) })); }
  function addLesson() { setCf((c) => ({ ...c, lessons: [...c.lessons, newLesson()] })); }
  function delLesson(i: number) { setActiveLesson(null); setCf((c) => ({ ...c, lessons: c.lessons.filter((_, j) => j !== i) })); }
  function openNew() { setActiveLesson(null); setEditId(null); setCf({ cat: COURSE_CATS[0] || "온보딩", title: "", desc: "", required: false, lessons: [newLesson()] }); setAdding(true); }
  function closeForm() { setAdding(false); setEditId(null); }
  function startEditCourse(c: Course) {
    setActiveLesson(null);
    const lessons: Lesson[] = (c.lessons || []).map((l: any) => ({ title: l.title, type: l.type, dur: l.dur, ref: l.ref || "", body: l.body || "", id: l.id, _k: nextK.current++ }));
    setEditId(c.id);
    setCf({ cat: c.cat, title: c.title, desc: c.desc, required: !!c.required, lessons });
    setAdding(true);
  }
  async function addCourse(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    const lessons = cf.lessons
      .map((l) => {
        const { _k, ...rest } = l;
        const isVid = l.type === "영상";
        // 영상=링크만(본문 비움) / 그 외=텍스트 에디터 본문만(링크 비움)
        const body = isVid ? "" : (rest.body || "");
        return { ...rest, ref: isVid ? (rest.ref || "") : "", body };
      })
      .filter((l) => l.title.trim());
    if (!lessons.length) { setErr("강의(lesson)를 1개 이상 입력하세요"); return; }
    const payload = { cat: cf.cat, title: cf.title, desc: cf.desc, required: cf.required, due: null, lessons };
    try {
      if (editId) await api.put(`/resource/courses/${editId}`, payload);
      else await api.post("/resource/courses", payload);
      closeForm(); load();
    } catch (e) { setErr(apiError(e)); }
  }
  async function delCourse(c: Course) {
    if (!await confirmDialog("강좌를 삭제할까요?")) return;
    try { await api.delete(`/resource/courses/${c.id}`); load(); } catch (e) { setErr(apiError(e)); }
  }
  async function toggle(lessonId: string) {
    try { await api.post(`/resource/courses/lessons/${lessonId}/toggle`); load(); } catch (e) { setErr(apiError(e)); }
  }
  const pct = (c: Course) => c.lessons.length ? Math.round(c.lessons.filter((l: any) => done.includes(l.id)).length / c.lessons.length * 100) : 0;

  if (playing) {
    const dn = done.includes(playing.id);
    return (
      <div data-testid="page-lesson-view" style={{ height: "calc(100vh - 86px)", display: "flex", flexDirection: "column" }}>
        <PageHeader crumb="연구실 › 교육" title={playing.title} action={<button className="btn ghost" data-testid="lesson-back" onClick={() => setPlaying(null)}>목록</button>} />
        <div className="card" style={{ flex: 1, minHeight: 0, margin: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div className="bd" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            <div className="muted small" style={{ marginBottom: 10 }}>{playing.type}</div>
            {ytEmbed(playing.ref) ? (
              // 영상 16:9 크기 캡, 설명은 아래
              <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", maxHeight: "58vh", margin: "0 auto", borderRadius: 10, overflow: "hidden", background: "#000" }}>
                <iframe title={playing.title} src={ytEmbed(playing.ref)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
              </div>
            ) : playing.ref ? (
              <div className="io">🔗 <a href={playing.ref} target="_blank" rel="noreferrer">{playing.ref}</a></div>
            ) : null}
            {playing.body ? <div style={{ lineHeight: 1.7, marginTop: ytEmbed(playing.ref) ? 14 : 0 }} dangerouslySetInnerHTML={{ __html: richHtml(playing.body) }} /> : (!playing.ref && <div className="muted" style={{ padding: 16, textAlign: "center" }}>등록된 강의 자료가 없습니다.</div>)}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8, flexShrink: 0 }}>
          <button className="btn primary" data-testid="lesson-complete" onClick={() => { toggle(playing.id); setPlaying(null); }}>{dn ? "이수 취소" : "이수 완료"}</button>
          <button className="btn ghost" data-testid="lesson-close" onClick={() => setPlaying(null)}>닫기</button>
        </div>
      </div>
    );
  }

  if (adding) {
    return (
      <div data-testid="page-course-form">
        <PageHeader crumb="연구실 › 교육" title={editId ? "강좌 수정" : "강좌 개설"} action={<button className="btn ghost" data-testid="course-back" onClick={closeForm}>목록</button>} />
        {err && <div className="form-err" data-testid="lib-error">{err}</div>}
        <form className="card" onSubmit={addCourse} data-testid="course-form">
          <div className="bd grid3">
            <div><label>분류</label><select data-testid="c-cat" value={cf.cat} onChange={(e) => setCf({ ...cf, cat: e.target.value })}>{COURSE_CATS.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div style={{ gridColumn: "span 2" }}><label>강좌명</label><input data-testid="c-title" value={cf.title} onChange={(e) => setCf({ ...cf, title: e.target.value })} /></div>
            <div style={{ gridColumn: "1 / -1" }}><label>설명</label><input data-testid="c-desc" value={cf.desc} onChange={(e) => setCf({ ...cf, desc: e.target.value })} /></div>
            <div style={{ gridColumn: "1 / -1" }}><label style={{ display: "flex", alignItems: "center", gap: 6, width: "fit-content", cursor: "pointer" }}><input type="checkbox" data-testid="c-required" checked={cf.required} onChange={(e) => setCf({ ...cf, required: e.target.checked })} style={{ width: "auto", margin: 0, flexShrink: 0 }} /> 필수 이수 강좌</label></div>
          </div>
          <div className="bd">
            <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>강의 구성
              <button type="button" className="btn ghost sm" data-testid="c-lesson-add" onClick={addLesson}>+ 강의 추가</button>
            </label>
            {cf.lessons.map((l, i) => (
              <div key={l._k} data-testid={`c-lesson-${i}`} style={{ border: "1px solid var(--line2)", borderRadius: 8, padding: 8, marginBottom: 8 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <span className="badge s-info" style={{ alignSelf: "center" }}>{i + 1}</span>
                  <input placeholder="강의명" value={l.title} onChange={(e) => setLesson(i, { title: e.target.value })} style={{ flex: 1, margin: 0 }} />
                  <select value={l.type} onChange={(e) => setLesson(i, { type: e.target.value })} style={{ margin: 0, width: 96, flexShrink: 0 }}>{LESSON_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                  <button type="button" className="btn ghost sm" onClick={() => delLesson(i)} disabled={cf.lessons.length === 1}>✕</button>
                </div>
                <input placeholder="영상 링크 (YouTube 주소 등)" value={l.ref} onChange={(e) => setLesson(i, { ref: e.target.value })} style={{ margin: "6px 0 0", display: l.type === "영상" ? "block" : "none" }} />
                <div style={{ marginTop: 6, display: l.type === "영상" ? "none" : "block" }}>
                  {activeLesson === i
                    ? <HtmlEditor value={l.body || ""} onChange={(html) => setLesson(i, { body: html })} testid={`c-body-${i}`} minHeight={90} />
                    : <div className="ck-preview" data-testid={`c-body-${i}`} onClick={() => setActiveLesson(i)} dangerouslySetInnerHTML={{ __html: richHtml(l.body) || "<span class='muted'>클릭해 내용 입력…</span>" }} />}
                </div>
              </div>
            ))}
          </div>
          <div className="bd" style={{ display: "flex", gap: 6 }}>
            <button className="btn primary" data-testid="course-add-submit">{editId ? "저장" : "개설"}</button>
            <button type="button" className="btn ghost" onClick={closeForm}>취소</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div data-testid="page-library">
      <PageHeader crumb="연구실 › 교육" title="교육" action={
        canManage ? <button className="btn primary" data-testid="lib-add-open" onClick={openNew}>+ 강좌 개설</button> : undefined
      } />
      {err && <div className="form-err" data-testid="lib-error">{err}</div>}
      {(
        <div data-testid="course-list">
          {courses.map((c) => (
            <div className="card" key={c.id}>
              <div className="card-h" style={{ cursor: "pointer" }} data-testid={`coursehead-${c.id}`} onClick={() => setOpen(open === c.id ? null : c.id)}>
                <b>[{c.cat}] {c.title} {c.required && <span className="badge s-bad">필수</span>}{c.due && <span className="muted small"> · 이수기한 {c.due}</span>}</b>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="muted">진도 {pct(c)}% {pct(c) >= 100 ? "· 수료 🎉" : ""}</span>
                  {canEditCourse(c) && <button className="btn ghost sm" data-testid={`course-edit-${c.id}`} onClick={(e) => { e.stopPropagation(); startEditCourse(c); }}>수정</button>}
                  {canEditCourse(c) && <button className="btn ghost sm" data-testid={`course-del-${c.id}`} onClick={(e) => { e.stopPropagation(); delCourse(c); }}>삭제</button>}
                </span>
              </div>
              {open === c.id && (
                <div className="bd">
                  {c.desc && <div className="muted" style={{ marginBottom: 8 }}>{c.desc}</div>}
                  {c.lessons.map((l: any) => {
                    const dn = done.includes(l.id);
                    return (
                      <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line2)" }}>
                        <span style={{ width: 22, height: 22, borderRadius: "50%", background: dn ? "var(--ok)" : "var(--soft)", color: dn ? "#fff" : "var(--sub)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{dn ? "✓" : "•"}</span>
                        <span style={{ flex: 1 }}>{l.title} <span className="muted small">{l.type}</span></span>
                        <button className="btn ghost sm" data-testid={`lesson-view-${l.id}`} onClick={() => setPlaying(l)}>▶ 보기</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          {!courses.length && <Card><div className="muted">개설된 강좌 없음</div></Card>}
        </div>
      )}

    </div>
  );
}
