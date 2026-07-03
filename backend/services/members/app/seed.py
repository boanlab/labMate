"""관리자 계정 시드 — 관리자 계정이 없으면 .env(ADMIN_EMAIL/PASSWORD)로 생성(가입 없음)."""
from __future__ import annotations

from sqlalchemy import select

from labmate_common.config import settings
from labmate_common.db import Base, SessionLocal, engine
from labmate_common.security import hash_password

from .models import User

ADMIN_NAME = "관리자"


def ensure_admin() -> bool:
    """관리자 계정이 하나도 없으면 .env 값으로 생성(멱등). 생성 시 True."""
    db = SessionLocal()
    try:
        if db.scalar(select(User).where(User.role == "admin")):
            return False
        db.add(User(
            email=settings.admin_email, name=ADMIN_NAME, role="admin",
            position="관리자", grade="",
            password_hash=hash_password(settings.admin_password),
            must_change_password=False, delegated_admin=False, org_id="lab1",
        ))
        db.commit()
        print(f"[seed] 관리자 계정 생성: {settings.admin_email}")
        return True
    finally:
        db.close()


def run() -> None:
    Base.metadata.create_all(bind=engine)
    if not ensure_admin():
        print("[seed] 관리자 계정이 이미 있어 건너뜀")


if __name__ == "__main__":
    run()
