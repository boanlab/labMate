"""감사 로그 — 서비스별 audit_logs 기록 + 관리자 화면의 6개 서비스 집계."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import DateTime, Integer, String, Text, func, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from .db import Base, get_db
from .deps import CurrentUser, require_roles


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_id: Mapped[str] = mapped_column(String(32), default="")
    actor_name: Mapped[str] = mapped_column(String(100), default="")
    action: Mapped[str] = mapped_column(String(60))          # 예: 결재 승인, 예산 변경
    entity: Mapped[str] = mapped_column(String(120), default="")
    detail: Mapped[str] = mapped_column(Text, default="")
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


def record(db: Session, user: CurrentUser, action: str, entity: str = "", detail: str = "") -> None:
    """감사 항목 기록(호출부 세션에 추가). 호출부의 commit 에 함께 반영된다."""
    try:
        db.add(AuditLog(actor_id=user.id, actor_name=user.name, action=action, entity=entity, detail=detail))
    except Exception:  # noqa: BLE001 — 감사 기록 실패가 본 동작을 막지 않도록
        pass


def make_audit_router(service_name: str) -> APIRouter:
    r = APIRouter(prefix="/admin/audit", tags=["admin-audit"])

    @r.get("")
    def list_audit(skip: int = 0, limit: int = 100,
                   _: CurrentUser = Depends(require_roles("admin")), db: Session = Depends(get_db)) -> dict:
        limit = max(1, min(limit, 500))
        total = db.scalar(select(func.count(AuditLog.id))) or 0
        rows = db.scalars(select(AuditLog).order_by(AuditLog.at.desc()).offset(skip).limit(limit)).all()
        return {"service": service_name, "total": total, "skip": skip, "limit": limit,
                "items": [{"service": service_name, "actor": a.actor_name or a.actor_id[:6], "action": a.action,
                           "entity": a.entity, "detail": a.detail,
                           "at": a.at.isoformat() if a.at else ""} for a in rows]}

    return r
