"""조회 시점에 계산하는 알림 항목(게시판) — 미확인 필독 공지, 회의록 내 할 일.

상태가 바뀌면 사라져야 하므로 저장하지 않고 매번 계산한다.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from labmate_common.deps import CurrentUser
from labmate_common.notifications import Derived

from .models import Meeting, Notice


def derive(user: CurrentUser, db: Session) -> list[Derived]:
    out: list[Derived] = []

    # 필독인데 아직 확인하지 않은 공지
    for n in db.scalars(select(Notice).where(Notice.required.is_(True), Notice.deleted_at.is_(None))):
        targets = n.target_user_ids or []
        if targets and user.id not in targets:
            continue                                   # 대상 지정 공지인데 나는 대상이 아님
        if user.id in (n.acked_user_ids or []):
            continue
        out.append(Derived(id=f"nt-{n.id}", kind="notice", title="필독 공지 미확인",
                           body=n.title, link=f"/notices?open={n.id}", ref_id=n.id))

    # 회의록 액션아이템 중 내가 담당이고 아직 끝내지 않은 것
    for m in db.scalars(select(Meeting).where(Meeting.deleted_at.is_(None))):
        for a in m.actions or []:
            if a.get("assignee_id") != user.id or a.get("done"):
                continue
            out.append(Derived(id=f"act-{a.get('id', '')}", kind="meeting", title="내 할 일",
                               body=a.get("title", ""), link=f"/meetings?open={m.id}", ref_id=m.id))
    return out
