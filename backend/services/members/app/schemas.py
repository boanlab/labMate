"""Pydantic 스키마."""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, EmailStr, Field


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access: str
    refresh: str
    must_change_password: bool = False


class RefreshIn(BaseModel):
    refresh: str


class AccessOut(BaseModel):
    access: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class ProfileFields(BaseModel):
    """구성원 프로필 공통 항목(과제 제안 정산용 포함)."""
    position: str = ""
    grade: str = ""
    phone: str = ""
    researcher_no: str = ""        # 과학기술인번호
    name_en: str = ""
    birth: date | None = None
    gender: str = ""
    join_date: date | None = None  # 입실(입사)일
    master_start: date | None = None   # 석사과정 입학일
    phd_start: date | None = None      # 박사과정 입학일
    degree: str = ""            # 최종학위
    major: str = ""             # 전공
    grad_year: str = ""         # 학위취득년도
    bank_account: str = ""           # 계좌
    dept: str = ""              # 학과
    student_id: str = ""        # 학번
    exit_date: date | None = None  # 퇴실(퇴사)일
    note: str = ""


class MeUpdate(BaseModel):
    """본인이 직접 수정 가능한 프로필 항목(역할·권한·이메일·입퇴실일 제외)."""
    name: str | None = None
    name_en: str | None = None
    gender: str | None = None
    birth: date | None = None
    phone: str | None = None
    dept: str | None = None
    student_id: str | None = None
    researcher_no: str | None = None
    degree: str | None = None
    major: str | None = None
    grad_year: str | None = None
    note: str | None = None


class UserOut(ProfileFields):
    id: str
    email: EmailStr
    name: str
    role: str
    delegated_admin: bool = False
    infra_manager: bool = False
    must_change_password: bool = False
    active: bool = True
    last_login_at: datetime | None = None

    model_config = {"from_attributes": True}


class UserCreate(ProfileFields):
    """관리자가 사용자 추가(가입 없음, 임시 비밀번호 + 강제 변경)."""
    email: EmailStr
    name: str
    role: str
    temp_password: str = Field(default="labmate123", min_length=8, description="초기 임시 비밀번호(미지정 시 기본값, 첫 로그인 시 변경 강제)")


class UserUpdate(BaseModel):
    name: str | None = None
    role: str | None = None
    position: str | None = None
    grade: str | None = None
    phone: str | None = None
    researcher_no: str | None = None
    name_en: str | None = None
    birth: date | None = None
    gender: str | None = None
    join_date: date | None = None
    master_start: date | None = None
    phd_start: date | None = None
    degree: str | None = None
    major: str | None = None
    grad_year: str | None = None
    bank_account: str | None = None
    dept: str | None = None
    student_id: str | None = None
    exit_date: date | None = None
    note: str | None = None
    delegated_admin: bool | None = None
    infra_manager: bool | None = None
    active: bool | None = None
    temp_password: str | None = None   # 입력 시 비밀번호 초기화(must_change 강제)


class ResetPasswordIn(BaseModel):
    """관리자 비밀번호 초기화 — 임시 비밀번호 지정 + 강제 변경."""
    temp_password: str = Field(min_length=8)


class MessageOut(BaseModel):
    detail: str


class PrefIn(BaseModel):
    """화면 설정 저장 — 값은 자유 형태(JSON)."""
    value: dict | list | str | int | float | bool | None = None
