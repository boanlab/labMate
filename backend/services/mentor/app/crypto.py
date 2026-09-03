"""API 키 암호화 — JWT_SECRET 에서 파생한 Fernet 키 사용.

관리자 백업(/admin/data/export)은 모든 테이블을 JSON 으로 덤프한다. 키를 평문으로
두면 백업 파일마다 그대로 실려 나가므로 저장 시점에 암호화한다.
"""
from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from labmate_common.config import settings


def _fernet() -> Fernet:
    digest = hashlib.sha256(f"labmate-mentor-secret:{settings.jwt_secret}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(raw: str) -> str:
    return _fernet().encrypt(raw.encode()).decode()


def decrypt(token: str) -> str:
    """복호화 실패(시크릿 교체·손상)는 '키 없음'으로 취급한다."""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except (InvalidToken, ValueError):
        return ""


def mask(raw: str) -> str:
    """화면 표시용 — 앞 8자와 뒤 4자만 남긴다."""
    if not raw:
        return ""
    if len(raw) <= 14:
        return raw[:2] + "•" * 6
    return f"{raw[:8]}{'•' * 6}{raw[-4:]}"
