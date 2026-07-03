"""소통 라우터 — 공지·게시판·회의록·캘린더·전자결재."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from labmate_common.configstore import get_setting
from labmate_common.db import get_db
from labmate_common.audit import record
from labmate_common.deps import CurrentUser, get_current_user

from . import schemas
from .masters import DEFAULTS
from .models import Approval, Event, Meeting, Notice, Post

router = APIRouter()
MANAGER = ("prof", "staff")

# KST(UTC+9) 기준 날짜
KST = timezone(timedelta(hours=9))


def _is_manager(u: CurrentUser) -> bool:
    return u.role in MANAGER or u.delegated_admin


# 게시판 공개 범위(직급 이상): 학사<석사<박사<교수, 관리자 전체
ROLE_RANK = {"under": 1, "master": 2, "phd": 3, "prof": 4, "staff": 0, "admin": 5}
VALID_MIN_ROLE = ("", "under", "master", "phd", "prof")


def _can_see_post(user: CurrentUser, p: Post) -> bool:
    if not p.min_role or p.by_id == user.id:
        return True
    return ROLE_RANK.get(user.role, 0) >= ROLE_RANK.get(p.min_role, 0)


def _kst_now() -> datetime:
    return datetime.now(KST)


def _today() -> str:
    return _kst_now().strftime("%Y-%m-%d")


# ── 공개 브랜딩 (로그인 화면용 — 인증 불필요) ──
@router.get("/branding")
def public_branding(db: Session = Depends(get_db)):
    return {
        "brand_logo": get_setting(db, "brand_logo", ""),
        "lab_name": get_setting(db, "lab_name", ""),
        "login_logo": get_setting(db, "login_logo", ""),
        "login_subtitle": get_setting(db, "login_subtitle", ""),
    }


# ── 공지 ──
@router.get("/notices", response_model=list[schemas.NoticeOut])
def list_notices(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = list(db.scalars(select(Notice).order_by(Notice.required.desc(), Notice.created_at.desc())))
    if _is_manager(user):             # 교수·행정·위임은 전체
        return rows
    uid = user.id                     # 그 외는 대상 미지정 공지 또는 본인 대상/작성
    return [n for n in rows if not (n.target_user_ids or []) or uid in (n.target_user_ids or []) or n.by_id == uid]


@router.post("/notices", response_model=schemas.NoticeOut, status_code=201)
def create_notice(body: schemas.NoticeIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _is_manager(user):
        raise HTTPException(403, "공지 작성 권한이 없습니다")
    n = Notice(by_id=user.id, acked_user_ids=[user.id], **body.model_dump())
    db.add(n); db.commit(); db.refresh(n)
    return n


@router.patch("/notices/{nid}", response_model=schemas.NoticeOut)
def update_notice(nid: str, body: schemas.NoticeIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    n = db.get(Notice, nid)
    if not n:
        raise HTTPException(404, "공지 없음")
    if not (_is_manager(user) or n.by_id == user.id):
        raise HTTPException(403, "수정 권한이 없습니다")
    for k, v in body.model_dump().items():
        setattr(n, k, v)
    n.updated_by = user.id
    db.commit(); db.refresh(n)
    return n


@router.delete("/notices/{nid}", status_code=204)
def delete_notice(nid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    n = db.get(Notice, nid)
    if n and not (_is_manager(user) or n.by_id == user.id):
        raise HTTPException(403, "삭제 권한이 없습니다")
    if n:
        n.deleted_at = datetime.now(timezone.utc)
        db.commit()


@router.post("/notices/{nid}/ack", response_model=schemas.NoticeOut)
def ack_notice(nid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    n = db.get(Notice, nid)
    if not n:
        raise HTTPException(404, "공지 없음")
    # 확인 토글
    if user.id in n.acked_user_ids:
        n.acked_user_ids = [x for x in n.acked_user_ids if x != user.id]
    else:
        n.acked_user_ids = n.acked_user_ids + [user.id]
    db.commit(); db.refresh(n)
    return n


# ── 게시판 ──
@router.get("/posts", response_model=list[schemas.PostOut])
def list_posts(cat: str | None = None, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    q = select(Post).order_by(Post.created_at.desc())
    if cat:
        q = q.where(Post.cat == cat)
    return [p for p in db.scalars(q) if _can_see_post(user, p)]   # 공개 범위(직급) 필터


@router.post("/posts", response_model=schemas.PostOut, status_code=201)
def create_post(body: schemas.PostIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.min_role not in VALID_MIN_ROLE:
        raise HTTPException(400, "유효하지 않은 공개 범위")
    p = Post(by_id=user.id, **body.model_dump())   # 누구나 작성
    db.add(p); db.commit(); db.refresh(p)
    return p


@router.put("/posts/{pid}", response_model=schemas.PostOut)
def update_post(pid: str, body: schemas.PostIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(Post, pid)
    if not p:
        raise HTTPException(404, "글 없음")
    if p.by_id != user.id and user.role not in ("prof", "admin"):
        raise HTTPException(403, "수정 권한이 없습니다")
    if body.min_role not in VALID_MIN_ROLE:
        raise HTTPException(400, "유효하지 않은 공개 범위")
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    p.updated_by = user.id
    db.commit(); db.refresh(p)
    return p


@router.get("/posts/{pid}", response_model=schemas.PostOut)
def get_post(pid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(Post, pid)
    if not p:
        raise HTTPException(404, "글 없음")
    if not _can_see_post(user, p):
        raise HTTPException(403, "이 글을 볼 권한이 없습니다")
    p.views += 1
    db.commit(); db.refresh(p)
    return p


@router.post("/posts/{pid}/comments", response_model=schemas.PostOut)
def add_comment(pid: str, body: schemas.CommentIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(Post, pid)
    if not p:
        raise HTTPException(404, "글 없음")
    import uuid
    p.comments = p.comments + [{"id": uuid.uuid4().hex[:8], "by": user.id, "name": user.name, "at": _today(), "text": body.text, "parent": body.parent or ""}]
    db.commit(); db.refresh(p)
    return p


@router.patch("/posts/{pid}/comments/{cid}", response_model=schemas.PostOut)
def edit_comment(pid: str, cid: str, body: schemas.CommentIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(Post, pid)
    if not p:
        raise HTTPException(404, "글 없음")
    new, found = [], False
    for c in p.comments:
        if c.get("id") == cid:
            if c.get("by") != user.id:
                raise HTTPException(403, "본인 댓글만 수정할 수 있습니다")
            c = {**c, "text": body.text}
            found = True
        new.append(c)
    if not found:
        raise HTTPException(404, "댓글 없음")
    p.comments = new
    db.commit(); db.refresh(p)
    return p


@router.delete("/posts/{pid}/comments/{cid}", response_model=schemas.PostOut)
def delete_comment(pid: str, cid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(Post, pid)
    if not p:
        raise HTTPException(404, "글 없음")
    target = next((c for c in p.comments if c.get("id") == cid), None)
    if not target:
        raise HTTPException(404, "댓글 없음")
    if target.get("by") != user.id and user.role not in ("prof", "admin"):
        raise HTTPException(403, "삭제 권한이 없습니다")
    # 댓글과 그 대댓글까지 함께 삭제
    p.comments = [c for c in p.comments if c.get("id") != cid and c.get("parent") != cid]
    db.commit(); db.refresh(p)
    return p


@router.delete("/posts/{pid}", status_code=204)
def delete_post(pid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(Post, pid)
    if p and (p.by_id == user.id or user.role in ("prof", "admin")):
        p.deleted_at = datetime.now(timezone.utc); db.commit()
    elif p:
        raise HTTPException(403, "삭제 권한이 없습니다")


# ── 회의록 ──
def _action_id() -> str:
    import uuid
    return uuid.uuid4().hex[:8]


def _normalize_actions(actions: list[dict]) -> list[dict]:
    out = []
    for a in actions or []:
        out.append({
            "id": a.get("id") or _action_id(),
            "title": a.get("title", a.get("task", "")),
            "assignee_id": a.get("assignee_id", a.get("who", "")),
            "due": a.get("due", ""),
            "done": bool(a.get("done", False)),
            "task_id": a.get("task_id", ""),
        })
    return out


@router.get("/meetings", response_model=list[schemas.MeetingOut])
def list_meetings(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = list(db.scalars(select(Meeting).order_by(Meeting.date.desc())))
    if _is_manager(user):             # 교수·행정·위임은 전체
        return rows
    uid = user.id                     # 그 외는 작성자·참석자·액션 담당자인 회의록만
    return [m for m in rows if m.by_id == uid or uid in (m.attendees or []) or any(a.get("assignee_id", a.get("who")) == uid for a in (m.actions or []))]


@router.post("/meetings", response_model=schemas.MeetingOut, status_code=201)
def create_meeting(body: schemas.MeetingIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    # 누구나 작성, 수정·삭제는 작성자·관리자
    data = body.model_dump()
    data["actions"] = _normalize_actions(data.get("actions", []))
    m = Meeting(by_id=user.id, **data)
    db.add(m); db.commit(); db.refresh(m)
    return m


@router.put("/meetings/{mid}", response_model=schemas.MeetingOut)
def update_meeting(mid: str, body: schemas.MeetingIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    m = db.get(Meeting, mid)
    if not m:
        raise HTTPException(404, "회의록 없음")
    if m.by_id != user.id and user.role not in ("prof", "admin"):
        raise HTTPException(403, "수정 권한이 없습니다")
    data = body.model_dump()
    m.date = data["date"]; m.title = data["title"]; m.attendees = data["attendees"]
    m.project_id = data["project_id"]
    m.decisions = data["decisions"]; m.actions = _normalize_actions(data["actions"])
    m.updated_by = user.id
    db.commit(); db.refresh(m)
    return m


@router.delete("/meetings/{mid}", status_code=204)
def delete_meeting(mid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    m = db.get(Meeting, mid)
    if m and (m.by_id == user.id or user.role in ("prof", "admin")):
        m.deleted_at = datetime.now(timezone.utc); db.commit()
    elif m:
        raise HTTPException(403, "삭제 권한이 없습니다")


@router.post("/meetings/{mid}/actions/{action_id}/toggle", response_model=schemas.MeetingOut)
def toggle_action(mid: str, action_id: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """액션아이템 완료 토글 — 담당자 본인 또는 관리자."""
    m = db.get(Meeting, mid)
    if not m:
        raise HTTPException(404, "회의록 없음")
    new = []
    found = False
    for a in m.actions:
        if a.get("id") == action_id:
            found = True
            if a.get("assignee_id", a.get("who")) not in ("", user.id) and not _is_manager(user) and m.by_id != user.id:
                raise HTTPException(403, "담당자 또는 관리자만 처리할 수 있습니다")
            a = {**a, "done": not a.get("done", False)}
        new.append(a)
    if not found:
        raise HTTPException(404, "액션아이템 없음")
    m.actions = new
    db.commit(); db.refresh(m)
    return m


# ── 캘린더 ──
def _expand_recurrence(e: Event, horizon_days: int = 400) -> list[dict]:
    """반복 일정을 기간 내 인스턴스로 전개. 단일 일정은 그대로 1건."""
    base = {
        "id": e.id, "title": e.title, "time": e.time, "type": e.type,
        "scope": e.scope, "attendees": e.attendees, "detail": e.detail, "link": e.link,
        "end_date": e.end_date.isoformat() if e.end_date else None,
        "repeat": e.repeat, "until": e.until.isoformat() if e.until else None,
        "by_id": e.by_id,
    }
    if not e.repeat or e.repeat == "없음":
        return [{**base, "date": e.date.isoformat()}]
    step = {"매주": 7, "격주": 14}.get(e.repeat)
    out, cur = [], e.date
    end = e.until or (e.date + timedelta(days=horizon_days))
    guard = 0
    while cur <= end and guard < 160:
        out.append({**base, "date": cur.isoformat(), "recurring": True})
        if e.repeat == "매월":
            m, y = cur.month, cur.year
            if m == 12:
                y, m = y + 1, 1
            else:
                m += 1
            day = min(cur.day, 28)
            cur = date(y, m, day)
        else:
            cur = cur + timedelta(days=step)
        guard += 1
    return out


@router.get("/events")
def list_events(expand: bool = True, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = list(db.scalars(select(Event).order_by(Event.date)))

    def _visible(e: Event) -> bool:
        # 개인: 작성자 본인만 / 구성원 선택: 작성자 또는 선택된 구성원 / 그 외(전체 구성원): 모두
        if e.scope == "개인":
            return e.by_id == user.id
        if e.scope == "구성원 선택":
            return e.by_id == user.id or user.id in (e.attendees or [])
        return True

    rows = [e for e in rows if _visible(e)]
    if not expand:
        return [schemas.EventOut.model_validate(e).model_dump() for e in rows]
    out: list[dict] = []
    for e in rows:
        out.extend(_expand_recurrence(e))
    return out


@router.post("/events", response_model=schemas.EventOut, status_code=201)
def create_event(body: schemas.EventIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    # 전원 등록 가능
    e = Event(by_id=user.id, **body.model_dump())
    db.add(e); db.commit(); db.refresh(e)
    return e


def _can_edit_event(user: CurrentUser, e: Event) -> bool:
    """개인=작성자 / 구성원 선택=참석(담당)자 / 전체 구성원=관리자만. 교수·행정은 전부 가능."""
    if _is_manager(user):
        return True
    if e.scope == "개인":
        return e.by_id == user.id
    if e.scope == "구성원 선택":
        return user.id in (e.attendees or [])
    return False


@router.put("/events/{eid}", response_model=schemas.EventOut)
def update_event(eid: str, body: schemas.EventIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    e = db.get(Event, eid)
    if not e:
        raise HTTPException(404, "일정 없음")
    if not _can_edit_event(user, e):
        raise HTTPException(403, "수정 권한이 없습니다")
    for k, v in body.model_dump().items():
        setattr(e, k, v)
    db.commit(); db.refresh(e)
    return e


@router.delete("/events/{eid}", status_code=204)
def delete_event(eid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    e = db.get(Event, eid)
    if e and _can_edit_event(user, e):
        e.deleted_at = datetime.now(timezone.utc); db.commit()
    elif e:
        raise HTTPException(403, "삭제 권한이 없습니다")


# ── 전자결재 ──
@router.get("/approvals/inbox", response_model=list[schemas.ApprovalOut])
def approval_inbox(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """내가 결재할 문서. 결재권자만."""
    rows = list(db.scalars(select(Approval).order_by(Approval.created_at.desc())))
    return [a for a in rows if a.status != "임시저장" and any(s.get("uid") == user.id for s in a.steps)]


@router.get("/approvals/mine", response_model=list[schemas.ApprovalOut])
def approval_mine(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return list(db.scalars(select(Approval).where(Approval.by_id == user.id).order_by(Approval.created_at.desc())))


def _doc_prefix(db: Session, doc_type: str) -> str:
    types = get_setting(db, "approval_types", DEFAULTS["approval_types"])
    for t in types:
        if t.get("name") == doc_type:
            return t.get("prefix", "DOC")
    return "DOC"


def _make_doc_no(db: Session, doc_type: str) -> str:
    year = _kst_now().year
    prefix = _doc_prefix(db, doc_type)
    seq = (db.scalar(select(func.count(Approval.id))) or 0) + 1
    return f"{prefix}-{year}-{seq:03d}"


@router.post("/approvals", response_model=schemas.ApprovalOut, status_code=201)
def create_approval(body: schemas.ApprovalIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    ids, seen, steps = [uid for uid in body.approver_ids if uid and uid != user.id], set(), []
    for uid in ids:                       # 중복·기안자 제외, 순서 유지
        if uid in seen:
            continue
        seen.add(uid)
        steps.append({"uid": uid, "decision": None, "at": "", "comment": ""})
    if not body.draft and not steps:       # 상신은 결재선 필수, 임시저장은 생략 가능
        raise HTTPException(400, "결재선에 최소 1명의 결재자를 지정하세요")
    a = Approval(
        by_id=user.id, type=body.type, title=body.title, project_id=body.project_id,
        amount=body.amount, deduct_account=body.deduct_account, content=body.content, source_ref=body.source_ref,
        steps=steps, status="임시저장" if body.draft else "진행", doc_no=_make_doc_no(db, body.type),
    )
    db.add(a); db.commit(); db.refresh(a)
    return a


@router.put("/approvals/{aid}", response_model=schemas.ApprovalOut)
def update_approval(aid: str, body: schemas.ApprovalIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    a = db.get(Approval, aid)
    if not a:
        raise HTTPException(404, "문서 없음")
    if a.by_id != user.id:
        raise HTTPException(403, "본인 기안만 수정할 수 있습니다")
    if a.status == "승인" or any(s.get("decision") for s in a.steps):
        raise HTTPException(409, "이미 결재가 시작되어 수정할 수 없습니다")
    a.type = body.type; a.title = body.title; a.project_id = body.project_id
    a.amount = body.amount; a.deduct_account = body.deduct_account; a.content = body.content
    ids = [uid for uid in body.approver_ids if uid and uid != user.id]
    if body.approver_ids:
        a.steps = [{"uid": uid, "decision": None, "at": "", "comment": ""} for uid in ids]
    if body.draft:
        a.status = "임시저장"
    elif a.status == "임시저장":            # 임시저장 → 상신
        if not a.steps:
            raise HTTPException(400, "결재선에 최소 1명의 결재자를 지정하세요")
        a.status = "진행"
        a.doc_no = a.doc_no or _make_doc_no(db, body.type)
    db.commit(); db.refresh(a)
    return a


def _current_index(steps: list[dict]) -> int | None:
    """순차 결재에서 지금 처리해야 할 단계 인덱스(앞 단계가 모두 승인된 첫 미결재)."""
    for i, s in enumerate(steps):
        if not s.get("decision"):
            return i
        if s.get("decision") == "반려":
            return None
    return None


@router.post("/approvals/{aid}/decide", response_model=schemas.ApprovalOut)
def decide_approval(aid: str, body: schemas.DecideIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    a = db.get(Approval, aid)
    if not a:
        raise HTTPException(404, "문서 없음")
    if a.status != "진행":
        raise HTTPException(409, "이미 종결된 문서입니다")
    if body.decision not in ("승인", "반려"):
        raise HTTPException(400, "결재 결정은 승인/반려만 가능합니다")
    idx = _current_index(a.steps)
    if idx is None or a.steps[idx].get("uid") != user.id:
        raise HTTPException(403, "결재 차례가 아닙니다")
    if body.decision == "반려" and not body.comment.strip():
        raise HTTPException(400, "반려 시 사유를 입력하세요")
    new_line = [dict(s) for s in a.steps]
    new_line[idx] = {**new_line[idx], "decision": body.decision, "at": _today(), "comment": body.comment}
    a.steps = new_line
    if body.decision == "반려":
        a.status = "반려"
    elif all(s.get("decision") == "승인" for s in a.steps):
        a.status = "승인"
    record(db, user, f"결재 {body.decision}", a.doc_no, a.title)
    db.commit(); db.refresh(a)
    return a


@router.post("/approvals/{aid}/recall", response_model=schemas.ApprovalOut)
def recall_approval(aid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """기안자가 상신을 회수 — 아직 아무도 결재하지 않은 경우만."""
    a = db.get(Approval, aid)
    if not a:
        raise HTTPException(404, "문서 없음")
    if a.by_id != user.id:
        raise HTTPException(403, "본인 기안만 회수할 수 있습니다")
    if any(s.get("decision") for s in a.steps):
        raise HTTPException(409, "이미 결재가 시작되어 회수할 수 없습니다")
    a.status = "회수"
    db.commit(); db.refresh(a)
    return a


@router.post("/approvals/{aid}/resubmit", response_model=schemas.ApprovalOut)
def resubmit_approval(aid: str, body: schemas.ApprovalIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """반려·회수된 문서를 보강해 재상신(같은 문서, 결재선 초기화)."""
    a = db.get(Approval, aid)
    if not a:
        raise HTTPException(404, "문서 없음")
    if a.by_id != user.id:
        raise HTTPException(403, "본인 기안만 재상신할 수 있습니다")
    if a.status not in ("반려", "회수"):
        raise HTTPException(409, "반려·회수된 문서만 재상신할 수 있습니다")
    ids = [uid for uid in body.approver_ids if uid and uid != user.id]
    if not ids:
        raise HTTPException(400, "결재선에 최소 1명의 결재자를 지정하세요")
    seen, steps = set(), []
    for uid in ids:
        if uid in seen:
            continue
        seen.add(uid)
        steps.append({"uid": uid, "decision": None, "at": "", "comment": ""})
    a.type = body.type; a.title = body.title; a.project_id = body.project_id
    a.amount = body.amount; a.deduct_account = body.deduct_account; a.content = body.content
    a.steps = steps; a.status = "진행"
    db.commit(); db.refresh(a)
    return a


@router.delete("/approvals/{aid}", status_code=204)
def delete_approval(aid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """기안자가 문서 삭제 — 결재선에 아무도 결재하지 않은 경우만(진행 전·회수)."""
    a = db.get(Approval, aid)
    if not a:
        raise HTTPException(404, "문서 없음")
    if a.by_id != user.id:
        raise HTTPException(403, "본인 기안만 삭제할 수 있습니다")
    if any(s.get("decision") for s in a.steps):
        raise HTTPException(409, "이미 결재가 시작되어 삭제할 수 없습니다")
    a.deleted_at = datetime.now(timezone.utc)
    db.commit()
