"""메일 계정 — 사람마다 여러 개(업무·연구실). 메일 본문은 저장하지 않는다.

메일은 IMAP 서버가 원본을 갖고 있다. 여기에 또 쌓으면 용량과 유출 위험만 늘고
원본과 어긋나므로, 볼 때마다 서버에서 가져온다.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from labmate_common.db import Base
from labmate_common.tenancy import OrgScoped


def _uuid() -> str:
    return uuid.uuid4().hex


class MailAccount(OrgScoped, Base):
    """한 사람의 메일 계정 하나. 서버 항목이 비어 있으면 관리자 공통 설정을 쓴다."""

    __tablename__ = "mail_accounts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    uid: Mapped[str] = mapped_column(String(32), index=True)          # 주인
    label: Mapped[str] = mapped_column(String(60), default="")        # 화면에 보일 이름(업무·연구실)
    address: Mapped[str] = mapped_column(String(200))                 # 메일 주소
    login: Mapped[str] = mapped_column(String(200), default="")       # 로그인 아이디(비면 주소)
    password_enc: Mapped[str] = mapped_column(String(500), default="")
    hint: Mapped[str] = mapped_column(String(40), default="")         # 화면 표시용 마스킹

    # 계정별 서버(비면 공통 설정) — 학교 메일과 연구실 메일은 서버가 다르다
    imap_host: Mapped[str] = mapped_column(String(200), default="")
    imap_port: Mapped[int] = mapped_column(Integer, default=0)
    imap_ssl: Mapped[bool] = mapped_column(Boolean, default=True)
    smtp_host: Mapped[str] = mapped_column(String(200), default="")
    smtp_port: Mapped[int] = mapped_column(Integer, default=0)
    smtp_tls: Mapped[str] = mapped_column(String(10), default="")     # starttls | ssl | none

    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    sort: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
