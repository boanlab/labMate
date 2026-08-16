from __future__ import annotations

from datetime import date, datetime
from pydantic import BaseModel, Field


# ── 공지 ──
class NoticeIn(BaseModel):
    title: str
    body: str = ""
    required: bool = False
    due: date | None = None
    link: str = ""
    files: list[dict] = Field(default_factory=list)
    target_user_ids: list[str] = Field(default_factory=list)   # 확인 대상 (비면 전체)
    notify_uids: list[str] = Field(default_factory=list)       # 알림 발송 대상(전체 공지 시 프론트가 전 구성원 id 전달; 저장 안 함)


class NoticeOut(NoticeIn):
    id: str
    by_id: str
    updated_by: str = ""
    acked_user_ids: list[str] = Field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None
    model_config = {"from_attributes": True}


# ── 게시판 ──
class PostIn(BaseModel):
    cat: str = "정보공유"
    title: str
    body: str = ""
    link: str = ""
    files: list[dict] = Field(default_factory=list)
    min_role: str = ""   # 공개 범위(최소 직급): ''=전체 / under·master·phd·prof 이상만 열람


class PostOut(PostIn):
    id: str
    by_id: str
    updated_by: str = ""
    views: int
    comments: list[dict] = Field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None
    model_config = {"from_attributes": True}


class CommentIn(BaseModel):
    text: str
    parent: str = ""    # 대댓글이면 부모 댓글 id


# ── 회의록 ──
class MeetingIn(BaseModel):
    date: date
    title: str
    project_id: str = ""                                  # 관련 연구과제/프로젝트
    attendees: list[str] = Field(default_factory=list)
    decisions: str = ""
    actions: list[dict] = Field(default_factory=list)


class MeetingOut(MeetingIn):
    id: str
    by_id: str
    updated_by: str = ""
    created_at: datetime | None = None
    updated_at: datetime | None = None
    model_config = {"from_attributes": True}


# ── 캘린더 ──
class EventIn(BaseModel):
    title: str
    date: date
    end_date: date | None = None     # 기간 일정 종료일(출장 등)
    time: str = ""
    type: str = "업무"
    scope: str = "개인"
    attendees: list[str] = Field(default_factory=list)
    detail: str = ""
    link: str = ""                  # 관련 링크
    repeat: str = "없음"            # 없음/매주/격주/매월
    until: date | None = None       # 반복 종료일


class EventOut(EventIn):
    id: str
    by_id: str
    model_config = {"from_attributes": True}


# ── 전자결재 ──
class ApprovalIn(BaseModel):
    type: str
    title: str
    project_id: str = ""
    amount: int = 0
    deduct_account: str = ""
    content: str = ""
    source_ref: str = ""                                           # 외부 연결(예: leave:<id>)
    draft: bool = False                                     # 임시저장 여부
    approver_ids: list[str] = Field(default_factory=list)   # 결재선


class ApprovalOut(BaseModel):
    id: str
    doc_no: str
    type: str
    title: str
    by_id: str
    project_id: str
    amount: int
    deduct_account: str
    source_ref: str = ""
    content: str
    steps: list[dict]
    status: str
    created_at: datetime | None = None
    model_config = {"from_attributes": True}


class DecideIn(BaseModel):
    decision: str  # 승인/반려
    comment: str = ""
