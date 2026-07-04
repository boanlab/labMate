"""Web Push(PWA) — 브라우저 푸시 구독 저장 + VAPID 서명 발송.

인앱 알림(notifications.py)과 짝을 이룬다. 서비스마다 DB가 분리돼 있어 구독도
서비스별 `push_subscriptions` 테이블에 저장하고(프론트가 3개 서비스에 모두 등록),
`notify()`가 알림을 만들 때 같은 서비스 DB의 구독으로 푸시를 쏜다.

pywebpush는 발송 함수 안에서 지연 임포트 → 미설치 서비스(members 등)는 영향 없음.
발송은 데몬 스레드에서 비동기 처리(요청 지연·실패 격리). 만료 구독(404/410)은 정리.
"""
from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import DateTime, String, delete, func, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from .config import settings
from .db import Base, SessionLocal, get_db
from .deps import CurrentUser, get_current_user
from .tenancy import OrgScoped


def _uuid() -> str:
    return uuid.uuid4().hex


class PushSubscription(OrgScoped, Base):
    """브라우저 푸시 구독 1건(= 기기/브라우저 1개). endpoint가 사실상 고유키."""
    __tablename__ = "push_subscriptions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(32), index=True)
    endpoint: Mapped[str] = mapped_column(String(500), index=True)
    p256dh: Mapped[str] = mapped_column(String(200), default="")
    auth: Mapped[str] = mapped_column(String(100), default="")
    ua: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ── 발송 ──
def _send_one(sub: dict, payload: str) -> int | None:
    """구독 1건에 푸시. 실패 시 HTTP 상태코드(만료 판단용) 반환, 성공/무시는 None."""
    from pywebpush import WebPushException, webpush
    try:
        webpush(
            subscription_info={"endpoint": sub["endpoint"], "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}},
            data=payload,
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},
            timeout=10,
        )
        return None
    except WebPushException as e:
        return getattr(getattr(e, "response", None), "status_code", None)
    except Exception:  # noqa: BLE001 — 네트워크 등, 이번 발송만 실패
        return None


def _dispatch(subs: list[dict], payload: str) -> None:
    """스레드 본체 — 전 구독 발송 후 만료(404/410) 구독 정리."""
    dead = [s["endpoint"] for s in subs if _send_one(s, payload) in (404, 410)]
    if not dead:
        return
    db = SessionLocal()
    try:
        db.execute(delete(PushSubscription).where(PushSubscription.endpoint.in_(dead)))
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
    finally:
        db.close()


def push_to_users(db: Session, user_ids: list[str], *, title: str, body: str, url: str, tag: str = "labmate") -> None:
    """대상 사용자들의 구독을 조회해 백그라운드로 푸시(요청을 막지 않음)."""
    if not settings.vapid_private_key or not user_ids:
        return
    rows = db.scalars(select(PushSubscription).where(PushSubscription.user_id.in_(list(set(user_ids)))))
    subs = [{"endpoint": r.endpoint, "p256dh": r.p256dh, "auth": r.auth} for r in rows]
    if not subs:
        return
    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag}, ensure_ascii=False)
    threading.Thread(target=_dispatch, args=(subs, payload), daemon=True).start()


# ── 구독 API ──
class SubKeys(BaseModel):
    p256dh: str = ""
    auth: str = ""


class SubIn(BaseModel):
    endpoint: str
    keys: SubKeys = SubKeys()
    ua: str = ""


class UnsubIn(BaseModel):
    endpoint: str


def make_push_router() -> APIRouter:
    router = APIRouter()

    @router.get("/push/public-key")
    def public_key():
        return {"key": settings.vapid_public_key}

    @router.post("/push/subscribe", status_code=204)
    def subscribe(body: SubIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
        row = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint))
        if row:                                   # 같은 endpoint 재등록 → 소유자·키 갱신
            row.user_id, row.p256dh, row.auth, row.ua = user.id, body.keys.p256dh, body.keys.auth, body.ua[:200]
        else:
            db.add(PushSubscription(user_id=user.id, endpoint=body.endpoint, p256dh=body.keys.p256dh, auth=body.keys.auth, ua=body.ua[:200]))
        db.commit()

    @router.post("/push/unsubscribe", status_code=204)
    def unsubscribe(body: UnsubIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
        db.execute(delete(PushSubscription).where(PushSubscription.endpoint == body.endpoint, PushSubscription.user_id == user.id))
        db.commit()

    return router
