"""조회 시점에 계산하는 알림 항목(과제) — 과제 종료 D-N, 업무 마감 임박·초과.

남은 일수는 매일 바뀌므로 저장하지 않고 매번 계산한다.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from labmate_common.deps import CurrentUser
from labmate_common.notifications import Derived

from .models import Project, Task

KST = timezone(timedelta(hours=9))
# 과제 종료 알림을 받을 사람. 관리자는 /grants 화면에 들어갈 수 없어(App.tsx 의 라우트 권한)
# 알림을 줘도 열지 못하고 지우지도 못한다. 근태 서비스의 HR_ADMIN 과 같은 기준으로 뺀다.
MANAGER = ("prof", "staff")
NOTICE_DAYS = 60            # 이 일수 안으로 들어온 과제만 알린다
TASK_DUE_DAYS = 7           # 마감이 이 일수 안으로 들어온 내 업무를 알린다


def _parse(v) -> date | None:
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except (TypeError, ValueError):
        return None


def derive(user: CurrentUser, db: Session) -> list[Derived]:
    today = datetime.now(KST).date()
    out: list[Derived] = []

    # 내가 맡은 세부업무의 마감. 회의록 액션아이템은 알려주는데 정작 업무는 조용해서
    # 마감을 지나고서야 알게 되는 일이 있었다.
    for t in db.scalars(select(Task).where(
        Task.assignee_id == user.id, Task.status != "완료", Task.deleted_at.is_(None), Task.due.isnot(None)
    )):
        left = (t.due - today).days
        if left > TASK_DUE_DAYS:
            continue
        title = f"업무 마감 D-{left}" if left >= 0 else f"업무 마감 {-left}일 지남"
        out.append(Derived(id=f"td-{t.id}", kind="task", title=title,
                           body=t.title, link=f"/projects?open={t.project_id}", ref_id=t.id))

    if user.role not in MANAGER and not user.delegated_admin:
        return out
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
