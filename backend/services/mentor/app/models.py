"""AI 멘토 도메인 — API 키 보관, 호출 사용량."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from labmate_common.db import Base


def _uuid() -> str:
    return uuid.uuid4().hex


class Secret(Base):
    """OpenRouter API 키 — 연구실당 1행(id='openrouter').

    값은 암호화해 넣는다(crypto.encrypt). 평문은 어떤 API 로도 나가지 않고,
    화면에는 마스킹만 보여준다. org 격리를 걸지 않는 이유는 키가 연구실 단위
    자원이고 관리자만 읽고 쓰기 때문이다.
    """

    __tablename__ = "mentor_secrets"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    value_enc: Mapped[str] = mapped_column(Text, default="")
    hint: Mapped[str] = mapped_column(String(60), default="")        # 마스킹 표시용
    updated_by: Mapped[str] = mapped_column(String(32), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Usage(Base):
    """호출 1건 = 1행. 월 사용량 상한 판정과 감사에 쓴다."""

    __tablename__ = "mentor_usage"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(32), index=True)
    user_name: Mapped[str] = mapped_column(String(100), default="")
    feature: Mapped[str] = mapped_column(String(40), index=True)      # meeting/note/task/report/schedule/chat
    model: Mapped[str] = mapped_column(String(120), default="")
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Numeric(10, 6), default=0)
    ok: Mapped[int] = mapped_column(Integer, default=1)               # 실패도 남긴다(원인 추적)
    detail: Mapped[str] = mapped_column(String(300), default="")
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
