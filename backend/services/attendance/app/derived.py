"""조회 시점에 계산하는 알림 항목(근태) — 휴가 승인 대기, 근태 정정 요청.

역할로 대상이 정해지고 처리되면 사라져야 하므로 저장하지 않고 매번 계산한다.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from labmate_common.deps import CurrentUser
from labmate_common.notifications import Derived

from .models import CorrectionReq, Leave
from .routers import _hr_admin


def derive(user: CurrentUser, db: Session) -> list[Derived]:
    if not _hr_admin(user):
        return []
    out: list[Derived] = []
    for l in db.scalars(select(Leave).where(Leave.status == "대기", Leave.deleted_at.is_(None))):
        out.append(Derived(id=f"lv-{l.id}", kind="leave", title="휴가 승인 요청",
                           body=f"{l.type} {l.start_date}~{l.end_date}", link="/approvals", ref_id=l.id))
    for r in db.scalars(select(CorrectionReq).where(CorrectionReq.status == "대기", CorrectionReq.deleted_at.is_(None))):
        out.append(Derived(id=f"cr-{r.id}", kind="attendance", title="근태 정정 요청",
                           body=f"{r.date} · {r.reason or ''}", link="/att-admin", ref_id=r.id))
    return out
