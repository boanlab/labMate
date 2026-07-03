"""소통 도메인 — 공지·게시판·회의록·캘린더·전자결재."""
from __future__ import annotations

import uuid
from datetime import date as date_t
from datetime import datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from labmate_common.db import Base
from labmate_common.tenancy import OrgScoped, SoftDelete


def _uuid() -> str:
    return uuid.uuid4().hex


class Notice(OrgScoped, SoftDelete, Base):
    __tablename__ = "notices"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    by_id: Mapped[str] = mapped_column(String(32))
    required: Mapped[bool] = mapped_column(Boolean, default=False)   # 필독
    due: Mapped[date_t | None] = mapped_column(Date, nullable=True)
    acked_user_ids: Mapped[list] = mapped_column(JSON, default=list)           # 확인한 user id
    link: Mapped[str] = mapped_column(String(400), default="")
    files: Mapped[list] = mapped_column(JSON, default=list)          # 첨부 [{name,url}]
    target_user_ids: Mapped[list] = mapped_column(JSON, default=list)        # 확인 대상 user id (비면 전체)
    updated_by: Mapped[str] = mapped_column(String(32), default="")           # 마지막 수정자
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Post(OrgScoped, SoftDelete, Base):
    __tablename__ = "posts"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    cat: Mapped[str] = mapped_column(String(20), default="정보공유")  # 정보공유/논문리뷰/자유
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str] = mapped_column(String(400), default="")
    min_role: Mapped[str] = mapped_column(String(20), default="")  # 공개 범위(최소 직급): ''=전체, under/master/phd/prof 이상
    by_id: Mapped[str] = mapped_column(String(32))
    views: Mapped[int] = mapped_column(default=0)
    comments: Mapped[list] = mapped_column(JSON, default=list)        # [{by,at,text}]
    files: Mapped[list] = mapped_column(JSON, default=list)           # 첨부 [{name,url}]
    updated_by: Mapped[str] = mapped_column(String(32), default="")   # 마지막 수정자
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Meeting(OrgScoped, SoftDelete, Base):
    __tablename__ = "meetings"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    date: Mapped[date_t] = mapped_column(Date)
    title: Mapped[str] = mapped_column(String(200))
    by_id: Mapped[str] = mapped_column(String(32))
    attendees: Mapped[list] = mapped_column(JSON, default=list)
    decisions: Mapped[str] = mapped_column(Text, default="")
    actions: Mapped[list] = mapped_column(JSON, default=list)         # [{task,who,due,done,task_id}]
    project_id: Mapped[str] = mapped_column(String(32), default="")   # 관련 연구과제/프로젝트(액션→세부업무 연동)
    updated_by: Mapped[str] = mapped_column(String(32), default="")   # 마지막 수정자
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Event(OrgScoped, SoftDelete, Base):
    __tablename__ = "events"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String(200))
    date: Mapped[date_t] = mapped_column(Date)
    end_date: Mapped[date_t | None] = mapped_column(Date, nullable=True)   # 기간 일정 종료일(출장 등)
    time: Mapped[str] = mapped_column(String(5), default="")
    type: Mapped[str] = mapped_column(String(20), default="업무")     # 업무/회의/마감/출장/개인/기타
    scope: Mapped[str] = mapped_column(String(20), default="개인")    # 개인/전체 구성원/구성원 선택
    attendees: Mapped[list] = mapped_column(JSON, default=list)
    detail: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str] = mapped_column(String(400), default="")         # 관련 링크
    repeat: Mapped[str] = mapped_column(String(10), default="없음")   # 없음/매주/격주/매월
    until: Mapped[date_t | None] = mapped_column(Date, nullable=True)
    by_id: Mapped[str] = mapped_column(String(32))


class Approval(OrgScoped, SoftDelete, Base):
    __tablename__ = "approvals"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    doc_no: Mapped[str] = mapped_column(String(40), default="")
    type: Mapped[str] = mapped_column(String(20))      # 주간보고/월간보고/일반보고/구매/지출결의/출장
    title: Mapped[str] = mapped_column(String(200))
    by_id: Mapped[str] = mapped_column(String(32), index=True)
    project_id: Mapped[str] = mapped_column(String(32), default="")
    amount: Mapped[int] = mapped_column(default=0)            # 금액(품의)
    deduct_account: Mapped[str] = mapped_column(String(40), default="")  # 차감 비목
    source_ref: Mapped[str] = mapped_column(String(60), default="")        # 외부 연결(예: leave:<id>)
    content: Mapped[str] = mapped_column(Text, default="")
    steps: Mapped[list] = mapped_column(JSON, default=list)   # [{uid,decision,at}]
    status: Mapped[str] = mapped_column(String(10), default="진행")  # 진행/승인/반려
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
