"""근태 라우터 — 근태(출퇴근·현황)·휴가(신청·승인)."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from labmate_common.configstore import get_setting
from labmate_common.db import get_db
from labmate_common.audit import record
from labmate_common.deps import CurrentUser, get_current_user
from labmate_common.notifications import notify

from . import schemas
from .masters import DEFAULTS
from .models import AttLog, Attendance, CorrectionReq, Leave, LeaveBalance

router = APIRouter()
HR_ADMIN = ("prof", "staff")
KST = timezone(timedelta(hours=9))


def _hr_admin(u: CurrentUser) -> bool:
    return u.role in HR_ADMIN or u.delegated_admin


def _kst_now() -> datetime:
    return datetime.now(KST)


def _today() -> date:
    return _kst_now().date()


def _now_hm() -> str:
    return _kst_now().strftime("%H:%M")


def _annual_default(db: Session) -> int:
    return int(get_setting(db, "annual_leave_default", DEFAULTS["annual_leave_default"]))


def _leave_rule(db: Session, type_name: str) -> dict:
    types = get_setting(db, "leave_types", DEFAULTS["leave_types"])
    for t in types:
        if t.get("name") == type_name:
            return t
    return {"name": type_name, "deduct": True, "fraction": 1.0}


def _ensure_balance(db: Session, uid: str) -> LeaveBalance:
    b = db.get(LeaveBalance, uid)
    if not b:
        b = LeaveBalance(uid=uid, granted=_annual_default(db), used=0)
        db.add(b); db.commit(); db.refresh(b)
    return b


# ── 근태 ──
@router.get("/attendance/me", response_model=list[schemas.AttendanceOut])
def my_attendance(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return list(db.scalars(select(Attendance).where(Attendance.uid == user.id).order_by(Attendance.date.desc())))


@router.get("/attendance/today", response_model=list[schemas.AttendanceOut])
def today_all(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """구성원 오늘 근태 현황 — 관리자/위임만 전체, 그 외 본인."""
    rows = list(db.scalars(select(Attendance).where(Attendance.date == _today())))
    if not _hr_admin(user):
        rows = [r for r in rows if r.uid == user.id]
    return rows


@router.get("/attendance/all", response_model=list[schemas.AttendanceOut])
def list_all_attendance(uid: str = "", date_from: str = "", date_to: str = "", user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """구성원 근태 현황·이력 조회(관리자·위임) — 구성원·기간 필터."""
    if not _hr_admin(user):
        raise HTTPException(403, "권한이 없습니다")
    q = select(Attendance)
    if uid:
        q = q.where(Attendance.uid == uid)
    rows = list(db.scalars(q.order_by(Attendance.date.desc())))
    if date_from:
        rows = [a for a in rows if a.date.isoformat() >= date_from]
    if date_to:
        rows = [a for a in rows if a.date.isoformat() <= date_to]
    return rows


@router.post("/attendance/check-in", response_model=schemas.AttendanceOut)
def check_in(body: schemas.CheckIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    today = _today()
    a = db.scalar(select(Attendance).where(Attendance.uid == user.id, Attendance.date == today))
    if not a:
        a = Attendance(uid=user.id, date=today)
        db.add(a)
    a.check_in = a.check_in or _now_hm()   # 최초 출근 시각 유지
    a.session_start = _now_hm()             # 현재 근무 세션 시작
    a.check_out = ""                        # 재출근 시 퇴근 시각 해제(하루 1레코드)
    a.status = body.status
    a.note = body.note
    db.commit(); db.refresh(a)
    return a


def _minutes_between(start: str, end: str) -> int:
    """HH:MM 두 시각의 분 차이(같은 날 기준, 음수는 0)."""
    if not start or not end:
        return 0
    d = (int(end[:2]) * 60 + int(end[3:5])) - (int(start[:2]) * 60 + int(start[3:5]))
    return d if d > 0 else 0


@router.post("/attendance/check-out", response_model=schemas.AttendanceOut)
def check_out(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    a = db.scalar(select(Attendance).where(Attendance.uid == user.id, Attendance.date == _today()))
    if not a:
        raise HTTPException(400, "출근 기록이 없습니다")
    now = _now_hm()
    if a.session_start:                     # 현재 세션 경과분을 실근무에 누적(휴게 제외)
        a.work_min = (a.work_min or 0) + _minutes_between(a.session_start, now)
        a.session_start = ""
    a.check_out = now
    a.status = "퇴근"
    db.commit(); db.refresh(a)
    return a


def _apply_correction(db, by_id, uid, date, check_in, check_out, status, note, reason):
    """출퇴근 보정 적용 및 전/후 이력 기록(직접 보정·정정 승인 공용)."""
    a = db.scalar(select(Attendance).where(Attendance.uid == uid, Attendance.date == date))
    before = ({"check_in": a.check_in, "check_out": a.check_out, "status": a.status, "note": a.note} if a else {})
    if not a:
        a = Attendance(uid=uid, date=date)
        db.add(a)
        db.flush()
    a.check_in = check_in
    a.check_out = check_out
    a.status = status
    a.note = note
    a.work_min = _minutes_between(check_in, check_out)   # 보정 근무분 = 출근~퇴근 구간(단일 세션)
    a.session_start = ""
    a.corrected = True
    a.corrected_by = by_id
    a.corrected_at = _kst_now().strftime("%Y-%m-%d %H:%M")
    a.corrected_reason = reason
    after = {"check_in": a.check_in, "check_out": a.check_out, "status": a.status, "note": a.note}
    db.add(AttLog(att_id=a.id, target_uid=uid, by_id=by_id, before=before, after=after, reason=reason))
    return a


@router.post("/attendance/correct", response_model=schemas.AttendanceOut)
def correct_attendance(body: schemas.CorrectionIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """근태 보정 — 전/후 이력 기록."""
    if not _hr_admin(user):
        raise HTTPException(403, "근태 보정 권한이 없습니다")
    if not body.reason.strip():
        raise HTTPException(400, "보정 사유는 필수입니다")
    a = _apply_correction(db, user.id, body.uid, body.date, body.check_in, body.check_out, body.status, body.note, body.reason)
    record(db, user, "근태 보정", body.date.isoformat(), body.reason)
    db.commit(); db.refresh(a)
    return a


@router.post("/attendance/correct-requests", response_model=schemas.CorrectionReqOut, status_code=201)
def create_correct_request(body: schemas.CorrectionReqIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """본인 출퇴근 시간 정정 요청(누구나, 본인 건만)."""
    if not body.reason.strip():
        raise HTTPException(400, "정정 사유는 필수입니다")
    r = CorrectionReq(uid=user.id, date=body.date, check_in=body.check_in, check_out=body.check_out,
                      requested_status=body.requested_status, reason=body.reason, status="대기")
    db.add(r); db.commit(); db.refresh(r)
    return r


@router.get("/attendance/correct-requests", response_model=list[schemas.CorrectionReqOut])
def list_correct_requests(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """관리자는 전체, 일반 사용자는 본인 요청만 — 최신순."""
    q = select(CorrectionReq).order_by(CorrectionReq.created_at.desc())
    rows = list(db.scalars(q))
    if not _hr_admin(user):
        rows = [r for r in rows if r.uid == user.id]
    return rows


@router.post("/attendance/correct-requests/{rid}/decide", response_model=schemas.CorrectionReqOut)
def decide_correct_request(rid: str, decision: str, note: str = "", user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """정정 요청 승인/반려 — 승인 시 보정 적용."""
    if not _hr_admin(user):
        raise HTTPException(403, "정정 요청 처리 권한이 없습니다")
    r = db.get(CorrectionReq, rid)
    if not r or r.deleted_at:
        raise HTTPException(404, "요청 없음")
    if r.status != "대기":
        raise HTTPException(409, "이미 처리된 요청입니다")
    if decision not in ("승인", "반려"):
        raise HTTPException(400, "decision은 승인/반려")
    r.status = decision
    r.decided_by = user.id
    r.decided_at = _kst_now().strftime("%Y-%m-%d %H:%M")
    r.decide_note = note
    if decision == "승인":
        _apply_correction(db, user.id, r.uid, r.date, r.check_in, r.check_out, r.requested_status, "정정 요청 승인", r.reason)
    record(db, user, f"근태 정정 요청 {decision}", r.date.isoformat(), r.reason)
    notify(db, recipients=[r.uid], kind="attendance", title=f"근태 정정 {decision}",
           body=f"{user.name}님이 {r.date.isoformat()} 근태 정정 요청을 {decision}했습니다", link="/attendance",
           actor=user, ref_id=r.id)
    db.commit(); db.refresh(r)
    return r


@router.get("/attendance/at", response_model=schemas.AttendanceOut | None)
def attendance_at(uid: str, date: date, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """특정 구성원·일자의 근태 레코드 조회(근태 보정 자동 채움용) — 없으면 null."""
    if not _hr_admin(user):
        raise HTTPException(403, "권한이 없습니다")
    return db.scalar(select(Attendance).where(Attendance.uid == uid, Attendance.date == date))


@router.get("/attendance/logs", response_model=list[schemas.AttLogOut])
def attendance_logs(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _hr_admin(user):
        raise HTTPException(403, "조회 권한이 없습니다")
    return list(db.scalars(select(AttLog).order_by(AttLog.at.desc())))


# ── 휴가 ──
@router.get("/leaves/me", response_model=list[schemas.LeaveOut])
def my_leaves(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return list(db.scalars(select(Leave).where(Leave.uid == user.id).order_by(Leave.created_at.desc())))


@router.get("/leaves/inbox", response_model=list[schemas.LeaveOut])
def leave_inbox(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _hr_admin(user):
        return []
    return list(db.scalars(select(Leave).where(Leave.status == "대기")))


@router.get("/leaves/balance", response_model=schemas.LeaveBalanceOut)
def my_balance(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return _ensure_balance(db, user.id)


@router.post("/leaves", response_model=schemas.LeaveOut, status_code=201)
def apply_leave(body: schemas.LeaveIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.end_date < body.start_date:
        raise HTTPException(400, "종료일이 시작일보다 빠릅니다")
    # 기간 중복(대기/승인) 방지
    existing = db.scalars(
        select(Leave).where(Leave.uid == user.id, Leave.status.in_(("대기", "승인")))
    ).all()
    for ex in existing:
        if not (body.end_date < ex.start_date or body.start_date > ex.end_date):
            raise HTTPException(409, f"이미 신청한 휴가와 기간이 겹칩니다({ex.start_date}~{ex.end_date})")
    rule = _leave_rule(db, body.type)
    days = body.days
    if rule.get("fraction", 1.0) in (0.5, 0.25):     # 반차/반반차는 환산값 강제
        days = rule["fraction"]
    # 연차 차감형이면 잔여 확인
    if rule.get("deduct", True):
        bal = _ensure_balance(db, user.id)
        if bal.used + days > bal.granted:
            raise HTTPException(409, f"잔여 연차({bal.granted - bal.used}일)를 초과합니다")
    data = body.model_dump()
    data["days"] = days
    lv = Leave(uid=user.id, status="대기", approver_id="", **data)
    db.add(lv); db.commit(); db.refresh(lv)
    return lv


@router.post("/leaves/{lid}/decide", response_model=schemas.LeaveOut)
def decide_leave(lid: str, body: schemas.DecideIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _hr_admin(user):
        raise HTTPException(403, "승인 권한이 없습니다")
    lv = db.get(Leave, lid)
    if not lv:
        raise HTTPException(404, "휴가 없음")
    if lv.status != "대기":
        raise HTTPException(409, "이미 처리된 휴가입니다")
    lv.status = "승인" if body.decision == "승인" else "반려"
    lv.approver_id = user.id
    if lv.status == "승인" and _leave_rule(db, lv.type).get("deduct", True):
        bal = _ensure_balance(db, lv.uid)
        bal.used += lv.days
    record(db, user, f"휴가 {lv.status}", lv.type, f"{lv.start_date}~{lv.end_date} ({lv.days}일)")
    notify(db, recipients=[lv.uid], kind="leave", title=f"휴가 {lv.status}",
           body=f"{user.name}님이 {lv.type} 신청({lv.start_date}~{lv.end_date})을 {lv.status}했습니다", link="/leave",
           actor=user, ref_id=lv.id)
    db.commit(); db.refresh(lv)
    return lv


@router.post("/leaves/{lid}/cancel", response_model=schemas.LeaveOut)
def cancel_leave(lid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """본인 휴가 취소 — 승인분은 차감 복원."""
    lv = db.get(Leave, lid)
    if not lv:
        raise HTTPException(404, "휴가 없음")
    if lv.uid != user.id and not _hr_admin(user):
        raise HTTPException(403, "취소 권한이 없습니다")
    if lv.status == "승인" and _leave_rule(db, lv.type).get("deduct", True):
        bal = _ensure_balance(db, lv.uid)
        bal.used = max(0, bal.used - lv.days)
    lv.status = "취소"
    db.commit(); db.refresh(lv)
    return lv


@router.get("/leaves/approved", response_model=list[schemas.LeaveOut])
def approved_leaves(_: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """캘린더 통합용 — 승인된 휴가 전체."""
    return list(db.scalars(select(Leave).where(Leave.status == "승인").order_by(Leave.start_date)))
