"""AI 멘토 요청·응답 스키마."""
from __future__ import annotations

from pydantic import BaseModel, Field


class KeyIn(BaseModel):
    key: str = Field(min_length=20, max_length=400, description="OpenRouter API 키")


class KeyStatusOut(BaseModel):
    """키 자체는 절대 내보내지 않는다 — 설정 여부와 마스킹만."""
    configured: bool = False
    hint: str = ""
    updated_at: str = ""
    updated_by: str = ""


class MessageOut(BaseModel):
    detail: str


class KeyTestOut(BaseModel):
    ok: bool
    label: str = ""
    usage_usd: float | None = None
    limit_usd: float | None = None
    detail: str = ""


class ModelOut(BaseModel):
    id: str
    name: str


class ReviewIn(BaseModel):
    """작성 중인 내용을 점검받는다."""
    feature: str = Field(description="meeting/note/task/report/schedule")
    title: str = Field(default="", max_length=300)
    body: str = Field(default="", max_length=20000)
    context: dict = Field(default_factory=dict, description="마감일·담당자 등 화면이 아는 부가 정보")


class ReviewOut(BaseModel):
    text: str
    model: str = ""


class UsageOut(BaseModel):
    month: str
    calls: int
    cost_usd: float
    cap_usd: float
    by_feature: dict[str, int] = {}


# ── 지도교수 철학 ──
class PrincipleIn(BaseModel):
    category: str
    text: str = Field(min_length=2, max_length=500)
    rationale: str = Field(default="", max_length=2000)
    approved: bool = False


class PrincipleOut(BaseModel):
    id: str
    category: str
    text: str
    rationale: str = ""
    approved: bool = False
    source: str = "ai"
    order: int = 0

    model_config = {"from_attributes": True}


class TurnIn(BaseModel):
    category: str
    text: str = Field(default="", max_length=4000, description="비우면 첫 질문을 받는다")


class TurnOut(BaseModel):
    question: str = ""
    history: list[dict] = []


class ExtractOut(BaseModel):
    drafts: list[PrincipleOut] = []
    detail: str = ""
