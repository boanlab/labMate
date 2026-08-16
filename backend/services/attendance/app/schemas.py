from __future__ import annotations

from datetime import date, datetime
from pydantic import BaseModel


class AttendanceOut(BaseModel):
    id: str
    uid: str
    date: date
    check_in: str
    check_out: str
    status: str
    note: str
    work_min: int = 0            # 실제 근무 분(세션별 누적)
    session_start: str = ""      # 현재 근무 세션 시작 HH:MM(근무 중이면 라이브 계산용)
    corrected: bool
    model_config = {"from_attributes": True}


class CheckIn(BaseModel):
    status: str = "업무 중"
    note: str = ""


class CorrectionIn(BaseModel):
    uid: str                      # 대상 구성원
    date: date
    check_in: str = ""
    check_out: str = ""
    status: str = "업무 중"
    note: str = ""
    reason: str                   # 보정 사유(필수)


class CorrectionReqIn(BaseModel):
    date: date
    check_in: str = ""
    check_out: str = ""
    requested_status: str = "업무 중"
    reason: str                   # 정정 사유(필수)


class CorrectionReqOut(BaseModel):
    id: str
    uid: str
    date: date
    check_in: str
    check_out: str
    requested_status: str
    reason: str
    status: str
    decided_by: str
    decided_at: str
    decide_note: str
    model_config = {"from_attributes": True}


class AttLogOut(BaseModel):
    id: str
    att_id: str
    target_uid: str
    by_id: str
    before: dict
    after: dict
    reason: str
    at: datetime | None = None
    model_config = {"from_attributes": True}


class LeaveIn(BaseModel):
    type: str = "연차"
    start_date: date
    end_date: date
    days: float = 1
    reason: str = ""


class LeaveOut(LeaveIn):
    id: str
    uid: str
    status: str
    approver_id: str
    created_at: datetime | None = None
    model_config = {"from_attributes": True}


class LeaveBalanceOut(BaseModel):
    uid: str
    granted: int
    used: float
    model_config = {"from_attributes": True}


class DecideIn(BaseModel):
    decision: str  # 승인/반려
