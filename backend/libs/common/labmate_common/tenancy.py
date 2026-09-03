"""멀티테넌시(org 격리) + 소프트삭제 — 전역 쿼리 필터.

OrgScoped/SoftDelete 믹스인 상속 시 모든 ORM SELECT 에 `org_id == 현재org` +
`deleted_at IS NULL` 이 자동으로 붙고(do_orm_execute), INSERT 는 org_id 가 자동 설정된다
(before_flush). 요청별 org 는 미들웨어가 JWT 의 org 클레임에서 읽어 contextvar 에 넣는다.
엔드포인트별 필터 누락으로 인한 데이터 유출을 원천 차단.
"""
from __future__ import annotations

import contextvars
from datetime import datetime

from sqlalchemy import DateTime, String, event
from sqlalchemy.orm import Mapped, Session, mapped_column, with_loader_criteria
from starlette.middleware.base import BaseHTTPMiddleware

from .security import decode_token

current_org: contextvars.ContextVar = contextvars.ContextVar("current_org", default=None)


class OrgScoped:
    """org 격리 대상 믹스인."""
    org_id: Mapped[str] = mapped_column(String(32), default="lab1", index=True)


class SoftDelete:
    """소프트삭제 대상 믹스인."""
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)


@event.listens_for(Session, "do_orm_execute")
def _scoped_filter(state) -> None:
    if not state.is_select or state.is_column_load or state.is_relationship_load:
        return
    opts = state.execution_options
    if not opts.get("include_deleted"):
        state.statement = state.statement.options(
            with_loader_criteria(SoftDelete, lambda cls: cls.deleted_at.is_(None), include_aliases=True)
        )
    if not opts.get("skip_org"):
        org = current_org.get()
        if org:
            state.statement = state.statement.options(
                with_loader_criteria(OrgScoped, lambda cls: cls.org_id == org, include_aliases=True)
            )


@event.listens_for(Session, "before_flush")
def _set_org_on_insert(session, ctx, instances) -> None:
    org = current_org.get()
    if not org:
        return
    for obj in session.new:
        if isinstance(obj, OrgScoped) and not getattr(obj, "org_id", None):
            obj.org_id = org


class OrgMiddleware(BaseHTTPMiddleware):
    """요청의 JWT에서 org 를 읽어 contextvar 에 설정."""
    async def dispatch(self, request, call_next):
        org = None
        auth = request.headers.get("authorization", "")
        if auth.startswith("Bearer "):
            try:
                org = decode_token(auth[7:]).get("org")
            except Exception:  # noqa: BLE001
                org = None
        token = current_org.set(org)
        try:
            return await call_next(request)
        finally:
            current_org.reset(token)
