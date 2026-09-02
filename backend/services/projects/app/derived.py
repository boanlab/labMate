"""조회 시점에 계산해 알림에 얹는 항목(과제 도메인).

과제 종료가 다가오면 정산·실적 정리를 시작해야 한다. 종료일은 매일 바뀌는
값이라 이벤트로 남길 수 없으므로, 알림을 열 때 남은 일수를 계산한다.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from labmate_common.deps import CurrentUser
from labmate_common.notifications import Derived

from .models import Project

KST = timezone(timedelta(hours=9))
MANAGER = ("prof", "staff", "admin")
NOTICE_DAYS = 60            # 이 일수 안으로 들어온 과제만 알린다


def _parse(v) -> date | None:
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except (TypeError, ValueError):
        return None


def derive(user: CurrentUser, db: Session) -> list[Derived]:
    if user.role not in MANAGER and not user.delegated_admin:
        return []
    today = datetime.now(KST).date()
    out: list[Derived] = []
    for p in db.scalars(select(Project).where(Project.kind == "grant", Project.deleted_at.is_(None))):
        end = _parse((p.meta or {}).get("year_end")) or p.end
        if not end:
            continue
        left = (end - today).days
        if left < 0 or left > NOTICE_DAYS:
            continue
        out.append(Derived(id=f"gd-{p.id}", kind="project", title=f"연구과제 종료 D-{left}",
                           body=f"{p.code} · {p.name}", link=f"/grants?open={p.id}", ref_id=p.id))
    return out
