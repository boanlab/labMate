"""JWT 발급·검증 및 비밀번호 해시. (HS256 공유 시크릿)"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt

from .config import settings


def _to72(raw: str) -> bytes:
    # bcrypt 는 72바이트까지만 사용한다(초과분 절단).
    return raw.encode("utf-8")[:72]


def hash_password(raw: str) -> str:
    return bcrypt.hashpw(_to72(raw), bcrypt.gensalt()).decode("utf-8")


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_to72(raw), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _encode(claims: dict[str, Any], expires: timedelta, token_type: str) -> str:
    payload = {
        **claims,
        "type": token_type,
        "iat": _now(),
        "exp": _now() + expires,
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_access_token(*, sub: str, role: str, name: str, delegated: bool = False, infra: bool = False, org: str = "lab1") -> str:
    return _encode(
        {"sub": sub, "role": role, "name": name, "delegated_admin": delegated, "infra_manager": infra, "org": org},
        timedelta(minutes=settings.access_token_minutes),
        "access",
    )


def create_download_token(*, sub: str) -> str:
    """첨부 다운로드 전용 토큰.

    <a href>/<img src> 는 Authorization 헤더를 붙일 수 없어 httpOnly 쿠키로 보낸다.
    쿠키가 새더라도 API 는 열리지 않도록 접근 토큰과 분리한다.
    """
    return _encode({"sub": sub}, timedelta(hours=settings.download_token_hours), "download")


def create_refresh_token(*, sub: str) -> str:
    return _encode({"sub": sub}, timedelta(days=settings.refresh_token_days), "refresh")


def decode_token(token: str) -> dict[str, Any]:
    """검증 실패 시 jwt 예외를 던진다(호출부에서 401 처리)."""
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
