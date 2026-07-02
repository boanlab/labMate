"""인증/구성원 모델."""
from __future__ import annotations

import uuid
from datetime import datetime

from datetime import date as date_t

from sqlalchemy import Boolean, Date, DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from labmate_common.db import Base
from labmate_common.tenancy import OrgScoped, SoftDelete

# 역할: prof(지도교수), phd(박사과정), master(석사과정), under(학부연구생),
#       staff(행정 — 보통 위임), admin(시스템 관리자)
ROLES = ("prof", "phd", "master", "under", "staff", "admin")

# 역할 → 직급/인건비등급(연구원은 역할이 곧 직급) — staff/admin 은 인건비 대상 아님
ROLE_POSITION = {"prof": "교수", "phd": "박사과정", "master": "석사과정", "under": "학사과정", "staff": "", "admin": ""}


def _uuid() -> str:
    return uuid.uuid4().hex


class User(OrgScoped, SoftDelete, Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(20))

    # 구성원 프로필
    position: Mapped[str] = mapped_column(String(40), default="")    # 직위: 학부/석사/박사/교수
    grade: Mapped[str] = mapped_column(String(40), default="")       # 인건비 등급
    phone: Mapped[str] = mapped_column(String(40), default="")
    researcher_no: Mapped[str] = mapped_column(String(40), default="")  # 과학기술인번호
    name_en: Mapped[str] = mapped_column(String(100), default="")
    birth: Mapped[date_t | None] = mapped_column(Date, nullable=True)
    gender: Mapped[str] = mapped_column(String(10), default="")
    join_date: Mapped[date_t | None] = mapped_column(Date, nullable=True)   # 입실(입사)일
    master_start: Mapped[date_t | None] = mapped_column(Date, nullable=True)  # 석사과정 입학일
    phd_start: Mapped[date_t | None] = mapped_column(Date, nullable=True)     # 박사과정 입학일
    degree: Mapped[str] = mapped_column(String(40), default="")          # 최종학위
    major: Mapped[str] = mapped_column(String(80), default="")           # 전공
    grad_year: Mapped[str] = mapped_column(String(10), default="")       # 학위취득년도
    bank_account: Mapped[str] = mapped_column(String(60), default="")         # 계좌
    dept: Mapped[str] = mapped_column(String(80), default="")            # 학과
    student_id: Mapped[str] = mapped_column(String(40), default="")      # 학번
    exit_date: Mapped[date_t | None] = mapped_column(Date, nullable=True)  # 퇴실(퇴사)일 — 비활성화 시 자동 기록
    note: Mapped[str] = mapped_column(Text, default="")

    password_hash: Mapped[str] = mapped_column(String(255))
    # 강제 비밀번호 변경 플래그
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)
    # 행정 권한 위임(랩장 등)
    delegated_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    infra_manager: Mapped[bool] = mapped_column(Boolean, default=False)   # 인프라(자산·장비) 관리 위임
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
