"""인앱 알림 — 서비스별 DB에 이벤트를 영구 저장하고 종(bell)이 병합해 표시.

설계: 마이크로서비스마다 DB가 분리돼 있어 알림 테이블도 서비스별로 둔다.
각 서비스는 자기 도메인 이벤트(참여자 지정·결재 요청·결과 등)를 자기 DB에 기록하고,
동일한 `make_notifications_router()`로 `/notifications` 조회·읽음 API를 노출한다.
프론트 종은 각 서비스의 `/notifications`를 폴링해 하나의 목록으로 합친다.
역할 기반(관리자 전체) 알림은 명부를 모르므로 여기서 다루지 않고, 종의 파생 폴링이 담당한다.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import DateTime, String, and_, delete, func, or_, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from .db import Base, get_db
from .deps import CurrentUser, get_current_user
from .tenancy import OrgScoped


def _uuid() -> str:
    return uuid.uuid4().hex


class Notification(OrgScoped, Base):
    """수신자 1명당 1행. 소프트삭제 없음(읽음 처리 후 보존/자연 소멸)."""
    __tablename__ = "notifications"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(32), index=True)     # 수신자 user id
    kind: Mapped[str] = mapped_column(String(30), default="")        # project/task/note/notice/meeting/comment/event/approval/leave/attendance
    title: Mapped[str] = mapped_column(String(120), default="")
    body: Mapped[str] = mapped_column(String(400), default="")
    link: Mapped[str] = mapped_column(String(200), default="")       # 프론트 라우트
    ref_id: Mapped[str] = mapped_column(String(64), default="")      # 원본 엔티티 id
    actor_id: Mapped[str] = mapped_column(String(32), default="")    # 발생시킨 사람
    actor_name: Mapped[str] = mapped_column(String(60), default="")
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


def notify(
    db: Session,
    *,
    recipients: list[str] | set[str],
    kind: str,
    title: str,
    body: str,
    link: str,
    actor: CurrentUser,
    ref_id: str = "",
) -> None:
    """수신자별 알림 행 추가(커밋은 호출부에서). 본인·중복·빈값은 자동 제외.

    인앱 알림(DB)과 함께, 구독한 기기에는 Web Push도 백그라운드로 발송한다.
    """
    targets = [uid for uid in dict.fromkeys(recipients or []) if uid and uid != actor.id]
    for uid in targets:
        db.add(Notification(
            user_id=uid, kind=kind, title=title, body=body, link=link,
            ref_id=ref_id, actor_id=actor.id, actor_name=actor.name,
        ))
    if targets:
        try:
            from .push import push_to_users
            push_to_users(db, targets, title=title, body=body, url=link, tag=kind)
        except Exception:  # noqa: BLE001 — 푸시 실패가 인앱 알림을 막지 않도록
            pass


# 오래된 알림 정리 기준: 읽은 지 30일 경과 or 생성 후 90일 경과(미읽음 포함)
PRUNE_READ_DAYS = 30
PRUNE_MAX_DAYS = 90


def _prune_stale(db: Session, user_id: str, now: datetime) -> None:
    """해당 사용자의 오래된 알림 삭제(기회적). user_id는 uuid라 org 격리 불필요."""
    db.execute(
        delete(Notification).where(
            Notification.user_id == user_id,
            or_(
                and_(Notification.read_at.isnot(None), Notification.read_at < now - timedelta(days=PRUNE_READ_DAYS)),
                Notification.created_at < now - timedelta(days=PRUNE_MAX_DAYS),
            ),
        )
    )
    db.commit()


class NotificationOut(BaseModel):
    id: str
    kind: str
    title: str
    body: str
    link: str
    ref_id: str
    actor_id: str
    actor_name: str
    read_at: datetime | None
    created_at: datetime | None

    class Config:
        from_attributes = True


class ReadIn(BaseModel):
    ids: list[str] | None = None


def make_notifications_router() -> APIRouter:
    """각 서비스가 mount 하는 알림 조회·읽음 라우터(prefix 없음 → /notifications)."""
    router = APIRouter()

    @router.get("/notifications", response_model=list[NotificationOut])
    def list_notifications(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
        now = datetime.now(timezone.utc)
        _prune_stale(db, user.id, now)                 # 조회 때마다 본인 오래된 알림 정리(스케줄러 불필요)
        cutoff = now - timedelta(days=14)
        rows = db.scalars(
            select(Notification)
            .where(
                Notification.user_id == user.id,
                (Notification.read_at.is_(None)) | (Notification.read_at >= cutoff),
            )
            .order_by(Notification.created_at.desc())
            .limit(100)
        )
        return list(rows)

    @router.post("/notifications/read", status_code=204)
    def mark_read(body: ReadIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
        q = select(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
        if body.ids:
            q = q.where(Notification.id.in_(body.ids))
        now = datetime.now(timezone.utc)
        for n in db.scalars(q):
            n.read_at = now
        db.commit()

    return router
