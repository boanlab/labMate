"""메일 계정 비밀번호 암호화 — JWT_SECRET 에서 파생한 Fernet 키 사용.

남의 메일함을 통째로 여는 열쇠라 평문으로 둘 수 없다. 저장 시점에 암호화하고,
복호화는 IMAP·SMTP 로 접속하는 순간에만 한다. 어떤 API 로도 평문은 나가지 않는다.
"""
from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from labmate_common.config import settings


def _fernet() -> Fernet:
    digest = hashlib.sha256(f"labmate-mail-secret:{settings.jwt_secret}".encode()).digest()
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
    """비밀번호가 들어 있는지만 알린다 — 앞뒤 몇 글자도 내보내지 않는다.

    (mentor 의 API 키는 어느 키인지 알아보라고 앞 8자를 남기지만, 메일 비밀번호는
     사람이 기억하는 짧은 문자열이라 일부만 보여도 나머지를 좁히는 단서가 된다.)
    """
    return "\u2022" * 8 if raw else ""
