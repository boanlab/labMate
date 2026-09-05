"""연구 도메인 모델 — 프로젝트·세부업무·마일스톤·실적."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from datetime import date as _date          # 컬럼명이 date 인 모델에서 타입을 가리지 않게

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from labmate_common.db import Base
from labmate_common.tenancy import OrgScoped, SoftDelete


def _uuid() -> str:
    return uuid.uuid4().hex


class Project(OrgScoped, SoftDelete, Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    kind: Mapped[str] = mapped_column(String(12), default="grant", index=True)   # grant(연구과제)/activity(프로젝트)
    code: Mapped[str] = mapped_column(String(60), index=True)
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(40), default="과제")   # 과제/연구/세미나/개발/인프라/기타
    status: Mapped[str] = mapped_column(String(20), default="진행 중")
    agency: Mapped[str] = mapped_column(String(60), default="")          # NRF/IITP/KEIT...
    program: Mapped[str] = mapped_column(String(200), default="")
    agreement_no: Mapped[str] = mapped_column(String(80), default="")
    lead_id: Mapped[str] = mapped_column(String(32), default="")         # 책임자(PI) user id
    pm_id: Mapped[str] = mapped_column(String(32), default="")           # 실무 담당자 user id
    members: Mapped[list] = mapped_column(JSON, default=list)            # user id 목록
    goals: Mapped[dict] = mapped_column(JSON, default=dict)              # 성과지표:목표건수
    start: Mapped[date | None] = mapped_column(Date, nullable=True)
    end: Mapped[date | None] = mapped_column(Date, nullable=True)
    desc: Mapped[str] = mapped_column(Text, default="")
    meta: Mapped[dict] = mapped_column(JSON, default=dict)               # 분류별 확장필드(연구비·기관·사사 등)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    tasks: Mapped[list["Task"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    milestones: Mapped[list["Milestone"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class Task(OrgScoped, SoftDelete, Base):
    __tablename__ = "tasks"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    by_id: Mapped[str] = mapped_column(String(32), default="")            # 작성자
    assignee_id: Mapped[str] = mapped_column(String(32), default="")
    status: Mapped[str] = mapped_column(String(20), default="예정")       # 예정/진행/완료
    start: Mapped[date | None] = mapped_column(Date, nullable=True)
    due: Mapped[date | None] = mapped_column(Date, nullable=True)          # 마감일(계획)
    done_date: Mapped[date | None] = mapped_column(Date, nullable=True)    # 실제 마감일(완료 처리일)
    body: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str] = mapped_column(String(400), default="")
    files: Mapped[list] = mapped_column(JSON, default=list)              # 첨부 [{name,url}]
    project: Mapped[Project] = relationship(back_populates="tasks")


class Milestone(OrgScoped, SoftDelete, Base):
    __tablename__ = "milestones"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    due: Mapped[date | None] = mapped_column(Date, nullable=True)
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    project: Mapped[Project] = relationship(back_populates="milestones")


class Publication(OrgScoped, SoftDelete, Base):
    __tablename__ = "publications"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    kind: Mapped[str] = mapped_column(String(20))            # 논문/학술대회/특허/SW등록/기술문서
    title: Mapped[str] = mapped_column(String(300))
    project_id: Mapped[str] = mapped_column(String(32), default="")
    scope: Mapped[str] = mapped_column(String(10), default="국외")   # 국내/국외 (필수)
    index_type: Mapped[str] = mapped_column(String(60), default="")          # SCI/KCI/국제...
    index_grade: Mapped[str] = mapped_column(String(20), default="")  # 등재구분
    authors: Mapped[str] = mapped_column(Text, default="")
    funding: Mapped[str] = mapped_column(String(120), default="")
    status: Mapped[str] = mapped_column(String(20), default="작성중")
    pub_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    abstract: Mapped[str] = mapped_column(Text, default="")
    meta: Mapped[dict] = mapped_column(JSON, default=dict)            # 종류별 상세필드
    files: Mapped[list] = mapped_column(JSON, default=list)           # 첨부파일 [{name,url}]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class NotePage(OrgScoped, SoftDelete, Base):
    """연구노트 페이지 — 자기참조 트리(parent_id+sort). 개인/공유 문서."""
    __tablename__ = "note_pages"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    parent_id: Mapped[str] = mapped_column(String(32), default="", index=True)   # ""=루트
    sort: Mapped[float] = mapped_column(Float, default=0)                        # 형제 정렬
    title: Mapped[str] = mapped_column(String(200), default="제목 없음")
    icon: Mapped[str] = mapped_column(String(8), default="📄")
    content: Mapped[str] = mapped_column(Text, default="")                       # 본문(HTML)
    project_id: Mapped[str] = mapped_column(String(32), default="", index=True)  # 과제 연결(선택)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    owner_id: Mapped[str] = mapped_column(String(32), default="", index=True)    # 작성자
    updated_by: Mapped[str] = mapped_column(String(32), default="")              # 마지막 수정자
    share_uids: Mapped[list] = mapped_column(JSON, default=list)                 # 공유 대상 사용자 id
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ArchivePage(OrgScoped, SoftDelete, Base):
    """자료실 페이지 — 자기참조 트리. 전 구성원 열람·작성·수정, 삭제는 작성자·교수."""
    __tablename__ = "archive_pages"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    parent_id: Mapped[str] = mapped_column(String(32), default="", index=True)   # ""=루트
    sort: Mapped[float] = mapped_column(Float, default=0)                        # 형제 정렬
    title: Mapped[str] = mapped_column(String(200), default="제목 없음")
    icon: Mapped[str] = mapped_column(String(8), default="📄")
    content: Mapped[str] = mapped_column(Text, default="")                       # 본문(HTML)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    files: Mapped[list] = mapped_column(JSON, default=list)                      # 첨부 [{name,url}]
    owner_id: Mapped[str] = mapped_column(String(32), default="", index=True)    # 작성자
    updated_by: Mapped[str] = mapped_column(String(32), default="")              # 마지막 수정자
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Objective(OrgScoped, SoftDelete, Base):
    """분기 단위 목표(OKR).

    큰 목표 하나보다 작게 쪼갠 여러 개가 완료율이 높다는 것이 알려져 있어,
    Objective 아래에 측정 가능한 Key Result 를 두고 세부업무를 KR 에 잇는다.
    """

    __tablename__ = "objectives"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    owner_id: Mapped[str] = mapped_column(String(32), index=True)      # 목표 주인(학생)
    period: Mapped[str] = mapped_column(String(20), index=True)        # 예: 2026-1분기
    title: Mapped[str] = mapped_column(String(200))
    note: Mapped[str] = mapped_column(Text, default="")
    order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class KeyResult(OrgScoped, SoftDelete, Base):
    """측정 가능한 결과. 목표값·현재값으로 달성률을 계산한다."""

    __tablename__ = "key_results"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    objective_id: Mapped[str] = mapped_column(ForeignKey("objectives.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    unit: Mapped[str] = mapped_column(String(20), default="건")        # 건·편·%·회 등
    target: Mapped[float] = mapped_column(Float, default=1)
    current: Mapped[float] = mapped_column(Float, default=0)
    order: Mapped[int] = mapped_column(Integer, default=0)


class DailyLog(OrgScoped, SoftDelete, Base):
    """개인 업무일지 — 하루치 '할 일'과 '한 일'.

    남에게 보이지 않는다. 모든 조회는 uid 로 잠근다(라우터에서 강제).
    세부업무(Task)와 달리 과제에 매이지 않아도 되고, 하루 단위로만 존재한다.
    """
    __tablename__ = "daily_logs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    uid: Mapped[str] = mapped_column(String(32), index=True)              # 쓴 사람 — 본인만 본다
    date: Mapped[_date] = mapped_column(Date, index=True)
    title: Mapped[str] = mapped_column(String(300))
    project_id: Mapped[str] = mapped_column(String(32), default="")       # 선택 — 보고서를 과제별로 묶는 데 쓴다
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str] = mapped_column(Text, default="")                   # 수행 내용·결과
    order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
