"""연구 도메인 라우터 — 프로젝트/세부업무/마일스톤/실적 CRUD."""
from __future__ import annotations

from datetime import datetime, timezone

import io
import os
import re
import uuid as _uuid
import zipfile

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from labmate_common.config import settings
from labmate_common.db import get_db
from labmate_common.deps import CurrentUser, get_current_user

from . import schemas
from .models import ArchivePage, Milestone, NotePage, Project, Publication, Task

router = APIRouter()
MANAGER_ROLES = ("prof", "staff")


def _can_manage(user: CurrentUser) -> bool:
    return user.role in MANAGER_ROLES


def _can_manage_project(user: CurrentUser) -> bool:
    """연구과제 추가/수정/삭제 — 교수·위임 연구원, 또는 시스템관리자(일괄 데이터 관리)."""
    return user.role in ("prof", "admin") or bool(user.delegated_admin)


def _can_edit_pj(user: CurrentUser, p: Project) -> bool:
    """연구과제는 교수·위임만, 프로젝트(activity)는 교수·위임 또는 책임자·담당자."""
    if p.kind == "grant":
        return _can_manage_project(user)
    return _can_manage_project(user) or user.id in (p.lead_id, p.pm_id)


def _can_edit_project(user: CurrentUser, p: Project) -> bool:
    """과제 PI/PM/참여자 또는 관리자만 과제 산출물을 편집."""
    return _can_manage(user) or user.id in (p.lead_id, p.pm_id) or user.id in (p.members or [])


def _is_work_admin(user: CurrentUser) -> bool:
    """세부업무 관리자급 — 교수·행정·위임·시스템관리자(일괄 데이터 관리)."""
    return user.role in ("prof", "staff", "admin") or bool(user.delegated_admin)


def _can_add_task(user: CurrentUser, p: Project) -> bool:
    """세부업무 추가 — 교수·행정·위임 + 책임자·담당자 + 참여 연구원."""
    return _is_work_admin(user) or user.id in (p.lead_id, p.pm_id) or user.id in (p.members or [])


def _can_manage_task(user: CurrentUser, p: Project, t: Task) -> bool:
    """세부업무 수정·삭제 — 교수·행정·위임·책임자·담당자, 참여 연구원은 본인이 추가한 업무만."""
    if _is_work_admin(user) or user.id in (p.lead_id, p.pm_id):
        return True
    return t.by_id == user.id


# ── 프로젝트 ──
@router.get("/projects", response_model=list[schemas.ProjectOut])
def list_projects(kind: str | None = None, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    q = select(Project).order_by(Project.created_at)
    if kind:
        q = q.where(Project.kind == kind)
    rows = list(db.scalars(q))
    if _is_work_admin(user):          # 교수·행정·위임은 연구실 전체
        return rows
    uid = user.id                     # 그 외는 참여(책임자·담당자·참여 연구원) 과제만
    return [p for p in rows if uid in (p.lead_id, p.pm_id) or uid in (p.members or [])]


@router.post("/projects", response_model=schemas.ProjectOut, status_code=201)
def create_project(body: schemas.ProjectIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    # 연구과제(grant)는 교수·위임 연구원만 / 프로젝트(activity)는 구성원 누구나 등록
    if body.kind == "grant" and not _can_manage_project(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "연구과제 생성 권한이 없습니다 (교수·위임 연구원만)")
    p = Project(**body.model_dump())
    # 활동 프로젝트: 생성자를 참여자로 자동 포함(가시성 보장)
    if p.kind == "activity" and user.id not in (p.lead_id, p.pm_id) and user.id not in (p.members or []):
        p.members = list(p.members or []) + [user.id]
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


@router.get("/projects/{pid}", response_model=schemas.ProjectOut)
def get_project(pid: str, _: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(Project, pid)
    if not p:
        raise HTTPException(404, "과제 없음")
    return p


@router.patch("/projects/{pid}", response_model=schemas.ProjectOut)
def update_project(pid: str, body: schemas.ProjectIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(Project, pid)
    if not p:
        raise HTTPException(404, "과제 없음")
    if not _can_edit_pj(user, p):
        raise HTTPException(403, "수정 권한이 없습니다")
    for k, v in body.model_dump(exclude_unset=True).items():       # 보낸 필드만 갱신(미입력 필드 보존)
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return p


@router.delete("/projects/{pid}", status_code=204)
def delete_project(pid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(Project, pid)
    if p and not _can_edit_pj(user, p):
        raise HTTPException(403, "삭제 권한이 없습니다")
    if p:
        p.deleted_at = datetime.now(timezone.utc)
        db.commit()


# ── 세부업무 ──
@router.get("/projects/{pid}/tasks", response_model=list[schemas.TaskOut])
def list_tasks(pid: str, _: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return list(db.scalars(select(Task).where(Task.project_id == pid)))


@router.post("/projects/{pid}/tasks", response_model=schemas.TaskOut, status_code=201)
def create_task(pid: str, body: schemas.TaskIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(Project, pid)
    if not p:
        raise HTTPException(404, "과제 없음")
    if not _can_add_task(user, p):
        raise HTTPException(403, "과제 참여자만 업무를 등록할 수 있습니다")
    t = Task(project_id=pid, by_id=user.id, **body.model_dump())
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


@router.patch("/tasks/{tid}", response_model=schemas.TaskOut)
def update_task(tid: str, body: schemas.TaskIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    t = db.get(Task, tid)
    if not t:
        raise HTTPException(404, "업무 없음")
    p = db.get(Project, t.project_id)
    if not (p and _can_manage_task(user, p, t)):
        raise HTTPException(403, "수정 권한이 없습니다")
    for k, v in body.model_dump().items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return t


@router.delete("/tasks/{tid}", status_code=204)
def delete_task(tid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    t = db.get(Task, tid)
    if not t:
        return
    p = db.get(Project, t.project_id)
    if not (p and _can_manage_task(user, p, t)):
        raise HTTPException(403, "삭제 권한이 없습니다")
    t.deleted_at = datetime.now(timezone.utc)
    db.commit()


@router.get("/tasks", response_model=list[schemas.TaskOut])
def list_all_tasks(_: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """대시보드용 — 연구실 전체 세부 업무(소속 org 범위)."""
    return list(db.scalars(select(Task).order_by(Task.due)))


# ── 마일스톤 ──
@router.get("/projects/{pid}/milestones", response_model=list[schemas.MilestoneOut])
def list_ms(pid: str, _: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return list(db.scalars(select(Milestone).where(Milestone.project_id == pid)))


@router.post("/projects/{pid}/milestones", response_model=schemas.MilestoneOut, status_code=201)
def create_ms(pid: str, body: schemas.MilestoneIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(Project, pid)
    if not p:
        raise HTTPException(404, "과제 없음")
    if not _can_edit_project(user, p):
        raise HTTPException(403, "과제 참여자만 마일스톤을 등록할 수 있습니다")
    m = Milestone(project_id=pid, **body.model_dump())
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


@router.patch("/milestones/{mid}", response_model=schemas.MilestoneOut)
def toggle_ms(mid: str, body: schemas.MilestoneIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    m = db.get(Milestone, mid)
    if not m:
        raise HTTPException(404, "마일스톤 없음")
    p = db.get(Project, m.project_id)
    if not (p and _can_edit_project(user, p)):
        raise HTTPException(403, "수정 권한이 없습니다")
    for k, v in body.model_dump().items():
        setattr(m, k, v)
    db.commit()
    db.refresh(m)
    return m


@router.delete("/milestones/{mid}", status_code=204)
def delete_ms(mid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    m = db.get(Milestone, mid)
    if not m:
        return
    p = db.get(Project, m.project_id)
    if not (p and _can_edit_project(user, p)):
        raise HTTPException(403, "삭제 권한이 없습니다")
    m.deleted_at = datetime.now(timezone.utc)
    db.commit()


# ── 파일 업로드(첨부) ──
@router.post("/uploads")
async def upload_files(files: list[UploadFile] = File(...), _: CurrentUser = Depends(get_current_user)):
    """다중 파일 업로드 → [{name,url}]. 정적 서빙 경로(/uploads/<service>/...)를 반환."""
    os.makedirs(settings.upload_dir, exist_ok=True)
    out = []
    for f in files:
        ext = os.path.splitext(f.filename or "")[1][:12]
        stored = f"{_uuid.uuid4().hex}{ext}"
        with open(os.path.join(settings.upload_dir, stored), "wb") as w:
            w.write(await f.read())
        out.append({"name": f.filename, "url": f"/uploads/{settings.service_name}/{stored}"})
    return out


# ── 실적 ──
@router.get("/publications", response_model=list[schemas.PublicationOut])
def list_pubs(_: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return list(db.scalars(select(Publication).order_by(Publication.created_at.desc())))


@router.post("/publications", response_model=schemas.PublicationOut, status_code=201)
def create_pub(body: schemas.PublicationIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if not (_can_manage(user) or user.delegated_admin or user.role == "admin"):
        raise HTTPException(403, "실적 등록은 교수·행정만 가능합니다")
    if not body.scope:
        raise HTTPException(400, "국내/국외 구분은 필수입니다")
    p = Publication(**body.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


@router.patch("/publications/{uid}", response_model=schemas.PublicationOut)
def update_pub(uid: str, body: schemas.PublicationIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role == "under":
        raise HTTPException(403, "학부연구생은 실적을 수정할 수 없습니다")
    p = db.get(Publication, uid)
    if not p:
        raise HTTPException(404, "실적 없음")
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return p


@router.delete("/publications/{uid}", status_code=204)
def delete_pub(uid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _can_manage(user):
        raise HTTPException(403, "실적 삭제 권한이 없습니다")
    p = db.get(Publication, uid)
    if p:
        p.deleted_at = datetime.now(timezone.utc)
        db.commit()


# ── 연구노트(트리형 문서) ──
def _note_visible(user: CurrentUser, p: NotePage) -> bool:
    """소유자 또는 공유 대상 사용자만 열람."""
    return p.owner_id == user.id or user.id in (p.share_uids or [])


def _note_can_edit(user: CurrentUser, p: NotePage) -> bool:
    return p.owner_id == user.id or user.role in ("prof", "admin") or bool(user.delegated_admin)


@router.get("/notes", response_model=list[schemas.NotePageOut])
def list_notes(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """열람 가능한 전체 노트(트리는 프론트에서 parent_id로 구성)."""
    return [p for p in db.scalars(select(NotePage).order_by(NotePage.sort)) if _note_visible(user, p)]


@router.post("/notes", response_model=schemas.NotePageOut, status_code=201)
def create_note(body: schemas.NotePageIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    data = body.model_dump()
    if data.get("sort") is None:                                   # 형제 마지막에 배치
        sibs = list(db.scalars(select(NotePage).where(NotePage.parent_id == data["parent_id"])))
        data["sort"] = (max((s.sort for s in sibs), default=0) + 1)
    p = NotePage(owner_id=user.id, updated_by=user.id, **data)
    db.add(p); db.commit(); db.refresh(p)
    return p


@router.patch("/notes/{nid}", response_model=schemas.NotePageOut)
def update_note(nid: str, body: schemas.NotePagePatch, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(NotePage, nid)
    if not p:
        raise HTTPException(404, "노트 없음")
    if not _note_can_edit(user, p):
        raise HTTPException(403, "수정 권한이 없습니다")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    p.updated_by = user.id
    db.commit(); db.refresh(p)
    return p


@router.delete("/notes/{nid}", status_code=204)
def delete_note(nid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(NotePage, nid)
    if not p:
        return
    if not _note_can_edit(user, p):
        raise HTTPException(403, "삭제 권한이 없습니다")
    now = datetime.now(timezone.utc)
    ids = {nid}                                                    # 하위 트리 전체 소프트 삭제
    while True:
        children = list(db.scalars(select(NotePage).where(NotePage.parent_id.in_(ids))))
        new = {c.id for c in children} - ids
        if not new:
            break
        ids |= new
    for x in db.scalars(select(NotePage).where(NotePage.id.in_(ids))):
        x.deleted_at = now
    db.commit()


# ── 자료실(트리형 문서) ── 전 구성원 열람·작성·수정, 삭제는 작성자·교수
def _arch_can_delete(user: CurrentUser, p: ArchivePage) -> bool:
    return p.owner_id == user.id or user.role in ("prof", "admin") or bool(user.delegated_admin)


@router.get("/archive", response_model=list[schemas.ArchiveOut])
def list_archive(_: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return list(db.scalars(select(ArchivePage).order_by(ArchivePage.sort)))


@router.post("/archive", response_model=schemas.ArchiveOut, status_code=201)
def create_archive(body: schemas.ArchiveIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    data = body.model_dump()
    if data.get("sort") is None:                                   # 형제 마지막에 배치
        sibs = list(db.scalars(select(ArchivePage).where(ArchivePage.parent_id == data["parent_id"])))
        data["sort"] = (max((s.sort for s in sibs), default=0) + 1)
    p = ArchivePage(owner_id=user.id, updated_by=user.id, **data)
    db.add(p); db.commit(); db.refresh(p)
    return p


@router.patch("/archive/{aid}", response_model=schemas.ArchiveOut)
def update_archive(aid: str, body: schemas.ArchivePatch, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(ArchivePage, aid)
    if not p:
        raise HTTPException(404, "자료 없음")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    p.updated_by = user.id
    db.commit(); db.refresh(p)
    return p


@router.delete("/archive/{aid}", status_code=204)
def delete_archive(aid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(ArchivePage, aid)
    if not p:
        return
    if not _arch_can_delete(user, p):
        raise HTTPException(403, "삭제 권한이 없습니다 (작성자·교수만)")
    now = datetime.now(timezone.utc)
    ids = {aid}                                                    # 하위 트리 전체 소프트 삭제
    while True:
        children = list(db.scalars(select(ArchivePage).where(ArchivePage.parent_id.in_(ids))))
        new = {c.id for c in children} - ids
        if not new:
            break
        ids |= new
    for x in db.scalars(select(ArchivePage).where(ArchivePage.id.in_(ids))):
        x.deleted_at = now
    db.commit()


# ── 문서 ZIP 내보내기 ── 트리=폴더, 페이지=<제목>.html, 자료실은 첨부 포함
def _safe_name(name: str) -> str:
    n = re.sub(r'[\\/:*?"<>|\r\n]+', "_", (name or "").strip())
    return n or "무제"


def _tree_path(page, by_id: dict) -> str:
    parts, c, seen = [], page, set()
    while c and c.parent_id and c.parent_id in by_id and c.id not in seen:
        seen.add(c.id)
        c = by_id[c.parent_id]
        parts.append(_safe_name(c.title))
    return "/".join(reversed(parts))


def _docs_zip(pages, with_files: bool) -> io.BytesIO:
    by_id = {p.id: p for p in pages}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        used: set[str] = set()
        for p in pages:
            folder = _tree_path(p, by_id)
            base = (folder + "/" if folder else "") + _safe_name(p.title)
            name = base + ".html"; i = 2
            while name in used:
                name = f"{base} ({i}).html"; i += 1
            used.add(name)
            z.writestr(name, f"<!doctype html><html><head><meta charset=\"utf-8\"><title>{p.title}</title></head><body>{p.content or ''}</body></html>")
            for f in (getattr(p, "files", None) or []) if with_files else []:
                url, fn = f.get("url", ""), _safe_name(f.get("name", "file"))
                local = os.path.join(settings.upload_dir, os.path.basename(url))
                if url and os.path.isfile(local):
                    z.write(local, base + "_첨부/" + fn)
    buf.seek(0)
    return buf


@router.get("/notes/export")
def export_notes(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """연구실 전체 연구노트 → ZIP. 교수·행정·위임·관리자."""
    if not _is_work_admin(user):
        raise HTTPException(403, "권한이 없습니다")
    buf = _docs_zip(list(db.scalars(select(NotePage).order_by(NotePage.sort))), with_files=False)
    return StreamingResponse(buf, media_type="application/zip", headers={"Content-Disposition": "attachment; filename=labmate-notes.zip"})


@router.get("/archive/export")
def export_archive(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """연구실 전체 자료실 → ZIP(첨부 포함). 교수·행정·위임·관리자."""
    if not _is_work_admin(user):
        raise HTTPException(403, "권한이 없습니다")
    buf = _docs_zip(list(db.scalars(select(ArchivePage).order_by(ArchivePage.sort))), with_files=True)
    return StreamingResponse(buf, media_type="application/zip", headers={"Content-Disposition": "attachment; filename=labmate-archive.zip"})
