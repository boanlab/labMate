"""AI 멘토 도메인 — API 키 보관, 호출 사용량."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, Numeric, String, Text, func
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


class Principle(Base):
    """지도교수의 지침 1개 — 학생 가이드 프롬프트에 주입된다.

    AI 가 교수와의 대화에서 초안을 뽑아도 그대로 쓰지 않는다. 교수가 검토해
    approved 로 바꾼 것만 학생에게 반영한다(잘못 요약된 철학이 그대로 지도로
    나가는 것을 막는다).
    """

    __tablename__ = "mentor_principles"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    category: Mapped[str] = mapped_column(String(20), index=True)     # research/teaching/practice
    text: Mapped[str] = mapped_column(Text)                           # 지침 본문(한 문장)
    rationale: Mapped[str] = mapped_column(Text, default="")          # 교수가 든 이유·사례
    approved: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[str] = mapped_column(String(20), default="ai")     # ai(대화에서 추출) / manual(직접 작성)
    by_id: Mapped[str] = mapped_column(String(32), default="")        # 작성한 교수
    order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class InterviewTurn(Base):
    """철학 인터뷰 대화 기록 — 교수별로 이어서 진행한다."""

    __tablename__ = "mentor_interview"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(32), index=True)
    category: Mapped[str] = mapped_column(String(20), default="")
    role: Mapped[str] = mapped_column(String(12))                     # assistant(질문) / user(답변)
    text: Mapped[str] = mapped_column(Text)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
