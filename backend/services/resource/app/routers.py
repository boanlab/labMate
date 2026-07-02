"""연구실 자원 라우터 — 자산·인프라·예약·자료실·LMS."""
from __future__ import annotations

from datetime import datetime, timezone

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from labmate_common.configstore import get_setting
from labmate_common.db import get_db
from labmate_common.deps import CurrentUser, get_current_user

from . import schemas
from .masters import DEFAULTS
from .models import Asset, Booking, Course, CourseProgress, Device, LibFile, Rack, Video

router = APIRouter()
ASSET_ADMIN = ("prof", "staff", "admin")     # 자산·인프라 등록
LIB_MNG = ("prof", "phd", "staff", "admin")  # 파일·영상·강좌 관리


def _has(u: CurrentUser, roles) -> bool:
    # 인프라담당은 자산·인프라(ASSET_ADMIN) 관리 허용
    return u.role in roles or (u.delegated_admin and roles in (ASSET_ADMIN, LIB_MNG)) or (u.infra_manager and roles == ASSET_ADMIN)


def _ensure_lesson_ids(lessons: list[dict]) -> list[dict]:
    for ls in lessons:
        ls["id"] = ls.get("id") or uuid.uuid4().hex[:12]
    return lessons


# ── 자산 ──
@router.get("/assets", response_model=list[schemas.AssetOut])
def list_assets(_: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return list(db.scalars(select(Asset)))


@router.post("/assets", response_model=schemas.AssetOut, status_code=201)
def create_asset(body: schemas.AssetIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _has(user, ASSET_ADMIN):
        raise HTTPException(403, "자산 등록 권한이 없습니다")
    a = Asset(**body.model_dump())
    db.add(a); db.commit(); db.refresh(a)
    return a


@router.patch("/assets/{aid}", response_model=schemas.AssetOut)
def update_asset(aid: str, body: schemas.AssetIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _has(user, ASSET_ADMIN):
        raise HTTPException(403, "자산 수정 권한이 없습니다")
    a = db.get(Asset, aid)
    if not a:
        raise HTTPException(404, "자산 없음")
    for k, v in body.model_dump().items():
        setattr(a, k, v)
    db.commit(); db.refresh(a)
    return a


@router.delete("/assets/{aid}", status_code=204)
def delete_asset(aid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _has(user, ASSET_ADMIN):
        raise HTTPException(403, "자산 삭제 권한이 없습니다")
    a = db.get(Asset, aid)
    if a:
        a.deleted_at = datetime.now(timezone.utc); db.commit()


# ── 인프라(랙 장비) ──
@router.get("/devices", response_model=list[schemas.DeviceOut])
def list_devices(_: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return list(db.scalars(select(Device)))


@router.post("/devices", response_model=schemas.DeviceOut, status_code=201)
def create_device(body: schemas.DeviceIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _has(user, ASSET_ADMIN):
        raise HTTPException(403, "장비 등록 권한이 없습니다")
    max_u = int(get_setting(db, "rack_max_u", DEFAULTS["rack_max_u"]))
    top = body.pos + body.size - 1
    if body.pos < 1 or top > max_u:
        raise HTTPException(400, f"위치+크기가 랙 범위(1~{max_u}U)를 벗어납니다")
    for d in db.scalars(select(Device).where(Device.rack == body.rack)):
        if not (d.pos + d.size - 1 < body.pos or d.pos > top):
            raise HTTPException(400, f"{d.name}와 위치가 겹칩니다")
    dev = Device(**body.model_dump())
    db.add(dev); db.commit(); db.refresh(dev)
    return dev


@router.delete("/devices/{did}", status_code=204)
def delete_device(did: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _has(user, ASSET_ADMIN):
        raise HTTPException(403, "장비 삭제 권한이 없습니다")
    d = db.get(Device, did)
    if d:
        d.deleted_at = datetime.now(timezone.utc); db.commit()


def _rack_u(db: Session, name: str) -> int:
    r = db.scalar(select(Rack).where(Rack.name == name, Rack.deleted_at.is_(None)))
    if r:
        return r.u_height
    return int(get_setting(db, "rack_max_u", DEFAULTS["rack_max_u"]))


@router.patch("/devices/{did}", response_model=schemas.DeviceOut)
def update_device(did: str, body: schemas.DevicePatch, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """장비 이동/수정 — 드래그앤드롭으로 랙·위치 변경 시 사용."""
    if not _has(user, ASSET_ADMIN):
        raise HTTPException(403, "장비 수정 권한이 없습니다")
    d = db.get(Device, did)
    if not d or d.deleted_at:
        raise HTTPException(404, "장비 없음")
    data = body.model_dump(exclude_none=True)
    rack = data.get("rack", d.rack); pos = data.get("pos", d.pos); size = data.get("size", d.size)
    max_u = _rack_u(db, rack)
    top = pos + size - 1
    if pos < 1 or top > max_u:
        raise HTTPException(400, f"위치+크기가 랙 범위(1~{max_u}U)를 벗어납니다")
    for o in db.scalars(select(Device).where(Device.rack == rack, Device.deleted_at.is_(None))):
        if o.id == did:
            continue
        if not (o.pos + o.size - 1 < pos or o.pos > top):
            raise HTTPException(400, f"{o.name}와 위치가 겹칩니다")
    for k, v in data.items():
        setattr(d, k, v)
    db.commit(); db.refresh(d)
    return d


# ── 랙(Rack) ──
_DEFAULT_RACKS = ["R1", "R2", "R3", "R4"]


@router.get("/racks", response_model=list[schemas.RackOut])
def list_racks(_: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = list(db.scalars(select(Rack).where(Rack.deleted_at.is_(None)).order_by(Rack.order)))
    if not rows:   # 최초 진입 시 기본 랙 4개 시드
        du = int(get_setting(db, "rack_max_u", DEFAULTS["rack_max_u"]))
        for i, nm in enumerate(_DEFAULT_RACKS):
            db.add(Rack(name=nm, u_height=du, order=i))
        db.commit()
        rows = list(db.scalars(select(Rack).where(Rack.deleted_at.is_(None)).order_by(Rack.order)))
    return rows


@router.post("/racks", response_model=schemas.RackOut, status_code=201)
def create_rack(body: schemas.RackIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _has(user, ASSET_ADMIN):
        raise HTTPException(403, "랙 추가 권한이 없습니다")
    if not body.name.strip():
        raise HTTPException(400, "랙 이름을 입력하세요")
    if db.scalar(select(Rack).where(Rack.name == body.name, Rack.deleted_at.is_(None))):
        raise HTTPException(409, "같은 이름의 랙이 있습니다")
    mx = max([r.order for r in db.scalars(select(Rack).where(Rack.deleted_at.is_(None)))] or [-1])
    r = Rack(name=body.name.strip(), u_height=max(1, body.u_height), order=mx + 1)
    db.add(r); db.commit(); db.refresh(r)
    return r


@router.patch("/racks/{rid}", response_model=schemas.RackOut)
def update_rack(rid: str, body: schemas.RackPatch, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _has(user, ASSET_ADMIN):
        raise HTTPException(403, "랙 수정 권한이 없습니다")
    r = db.get(Rack, rid)
    if not r or r.deleted_at:
        raise HTTPException(404, "랙 없음")
    data = body.model_dump(exclude_none=True)
    if "u_height" in data:
        nu = max(1, data["u_height"])
        over = [d.name for d in db.scalars(select(Device).where(Device.rack == r.name, Device.deleted_at.is_(None))) if d.pos + d.size - 1 > nu]
        if over:
            raise HTTPException(400, f"해당 크기를 벗어나는 장비가 있습니다: {', '.join(over)}")
        r.u_height = nu
    if data.get("name"):
        old = r.name
        if db.scalar(select(Rack).where(Rack.name == data["name"], Rack.id != rid, Rack.deleted_at.is_(None))):
            raise HTTPException(409, "같은 이름의 랙이 있습니다")
        r.name = data["name"].strip()
        for d in db.scalars(select(Device).where(Device.rack == old, Device.deleted_at.is_(None))):
            d.rack = r.name
    db.commit(); db.refresh(r)
    return r


@router.delete("/racks/{rid}", status_code=204)
def delete_rack(rid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _has(user, ASSET_ADMIN):
        raise HTTPException(403, "랙 삭제 권한이 없습니다")
    r = db.get(Rack, rid)
    if not r or r.deleted_at:
        raise HTTPException(404, "랙 없음")
    if db.scalar(select(Device).where(Device.rack == r.name, Device.deleted_at.is_(None))):
        raise HTTPException(409, "장비가 있는 랙은 삭제할 수 없습니다 (장비를 먼저 이동/삭제)")
    r.deleted_at = datetime.now(timezone.utc); db.commit()


# ── 자원 예약 ──
@router.get("/bookings", response_model=list[schemas.BookingOut])
def list_bookings(_: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return list(db.scalars(select(Booking).order_by(Booking.date.desc())))


@router.post("/bookings", response_model=schemas.BookingOut, status_code=201)
def create_booking(body: schemas.BookingIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    # 동일 자원·일자·시간대 충돌 검사
    for b in db.scalars(select(Booking).where(Booking.resource == body.resource, Booking.date == body.date)):
        if body.start and b.start and not (body.end <= b.start or body.start >= b.end):
            raise HTTPException(400, f"예약 충돌: {b.start}~{b.end}")
    bk = Booking(by_id=user.id, **body.model_dump())
    db.add(bk); db.commit(); db.refresh(bk)
    return bk


def _can_edit_booking(user: CurrentUser, bk: Booking) -> bool:
    """예약은 본인 또는 지도교수만 수정·삭제."""
    return bk.by_id == user.id or user.role == "prof"


@router.patch("/bookings/{bid}", response_model=schemas.BookingOut)
def update_booking(bid: str, body: schemas.BookingIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    bk = db.get(Booking, bid)
    if not bk:
        raise HTTPException(404, "예약을 찾을 수 없습니다")
    if not _can_edit_booking(user, bk):
        raise HTTPException(403, "본인 예약 또는 관리자만 수정할 수 있습니다")
    # 동일 자원·일자·시간대 충돌 검사 (자기 자신 제외)
    for b in db.scalars(select(Booking).where(Booking.resource == body.resource, Booking.date == body.date)):
        if b.id != bid and body.start and b.start and not (body.end <= b.start or body.start >= b.end):
            raise HTTPException(400, f"예약 충돌: {b.start}~{b.end}")
    for k, v in body.model_dump().items():
        setattr(bk, k, v)
    db.commit(); db.refresh(bk)
    return bk


@router.delete("/bookings/{bid}", status_code=204)
def delete_booking(bid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    bk = db.get(Booking, bid)
    if not bk:
        return
    if not _can_edit_booking(user, bk):
        raise HTTPException(403, "본인 예약 또는 관리자만 삭제할 수 있습니다")
    db.delete(bk); db.commit()


# ── 자료실: 파일 ──
@router.get("/files", response_model=list[schemas.FileOut])
def list_files(_: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return list(db.scalars(select(LibFile).order_by(LibFile.created_at.desc())))


@router.post("/files", response_model=schemas.FileOut, status_code=201)
def create_file(body: schemas.FileIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _has(user, LIB_MNG):
        raise HTTPException(403, "파일 등록 권한이 없습니다")
    f = LibFile(by_id=user.id, **body.model_dump())
    db.add(f); db.commit(); db.refresh(f)
    return f


@router.delete("/files/{fid}", status_code=204)
def delete_file(fid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    f = db.get(LibFile, fid)
    if f and (f.by_id == user.id or user.role in ("prof", "admin")):
        f.deleted_at = datetime.now(timezone.utc); db.commit()
    elif f:
        raise HTTPException(403, "삭제 권한이 없습니다")


# ── 자료실: 영상 ──
@router.get("/videos", response_model=list[schemas.VideoOut])
def list_videos(_: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return list(db.scalars(select(Video)))


@router.post("/videos", response_model=schemas.VideoOut, status_code=201)
def create_video(body: schemas.VideoIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _has(user, LIB_MNG):
        raise HTTPException(403, "영상 등록 권한이 없습니다")
    v = Video(by_id=user.id, **body.model_dump())
    db.add(v); db.commit(); db.refresh(v)
    return v


@router.delete("/videos/{vid}", status_code=204)
def delete_video(vid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    v = db.get(Video, vid)
    if v and (v.by_id == user.id or user.role in ("prof", "admin")):
        v.deleted_at = datetime.now(timezone.utc); db.commit()
    elif v:
        raise HTTPException(403, "삭제 권한이 없습니다")


# ── LMS: 강좌 + 개인 수강 진도 ──
@router.get("/courses", response_model=list[schemas.CourseOut])
def list_courses(_: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return list(db.scalars(select(Course)))


@router.post("/courses", response_model=schemas.CourseOut, status_code=201)
def create_course(body: schemas.CourseIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _has(user, LIB_MNG):
        raise HTTPException(403, "강좌 개설 권한이 없습니다")
    data = body.model_dump()
    _ensure_lesson_ids(data["lessons"])
    c = Course(owner_id=body.owner_id or user.id, **{k: v for k, v in data.items() if k != "owner_id"})
    db.add(c); db.commit(); db.refresh(c)
    return c


@router.put("/courses/{cid}", response_model=schemas.CourseOut)
def update_course(cid: str, body: schemas.CourseIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """강좌·강의(lesson) 직접 구성. 소유자 또는 관리자."""
    c = db.get(Course, cid)
    if not c:
        raise HTTPException(404, "강좌 없음")
    if c.owner_id != user.id and user.role not in ("prof", "admin"):
        raise HTTPException(403, "강좌 수정 권한이 없습니다")
    data = body.model_dump()
    c.cat = data["cat"]; c.title = data["title"]; c.desc = data["desc"]
    c.lessons = _ensure_lesson_ids(data["lessons"])
    c.required = data["required"]; c.due = data["due"]; c.target_roles = data["target_roles"]
    db.commit(); db.refresh(c)
    return c


@router.delete("/courses/{cid}", status_code=204)
def delete_course(cid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    c = db.get(Course, cid)
    if c and (c.owner_id == user.id or user.role in ("prof", "admin")):
        c.deleted_at = datetime.now(timezone.utc); db.commit()
    elif c:
        raise HTTPException(403, "삭제 권한이 없습니다")


@router.get("/courses/report")
def course_report(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """필수 강좌 이수 현황(관리자) — 강좌별 완료/미완료 인원 집계용 원자료."""
    if not _has(user, LIB_MNG):
        raise HTTPException(403, "조회 권한이 없습니다")
    progress = list(db.scalars(select(CourseProgress)))
    done_by_lesson: dict[str, list[str]] = {}
    for p in progress:
        done_by_lesson.setdefault(p.lesson_id, []).append(p.uid)
    out = []
    for c in db.scalars(select(Course)):
        lesson_ids = [ls.get("id") for ls in c.lessons]
        # 모든 레슨을 완료한 사용자 = 이수자
        per_user: dict[str, int] = {}
        for lid in lesson_ids:
            for uid in done_by_lesson.get(lid, []):
                per_user[uid] = per_user.get(uid, 0) + 1
        completed = [uid for uid, n in per_user.items() if n >= len(lesson_ids) and lesson_ids]
        out.append({
            "id": c.id, "title": c.title, "required": c.required,
            "due": c.due.isoformat() if c.due else None,
            "target_roles": c.target_roles, "lesson_count": len(lesson_ids),
            "completed_uids": completed,
        })
    return out


@router.get("/courses/progress")
def my_progress(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """내가 완료한 레슨 id 목록."""
    return {"done": [p.lesson_id for p in db.scalars(select(CourseProgress).where(CourseProgress.uid == user.id))]}


@router.post("/courses/lessons/{lesson_id}/toggle")
def toggle_lesson(lesson_id: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    existing = db.scalar(select(CourseProgress).where(CourseProgress.uid == user.id, CourseProgress.lesson_id == lesson_id))
    if existing:
        existing.deleted_at = datetime.now(timezone.utc); done = False
    else:
        db.add(CourseProgress(uid=user.id, lesson_id=lesson_id)); done = True
    db.commit()
    return {"lesson_id": lesson_id, "done": done}
