"""공통 의존성 — JWT 에서 현재 사용자 추출, 역할 검사.

서비스 간 호출 없이 공유 시크릿으로 서명을 직접 검증.
"""
from __future__ import annotations

from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .security import decode_token

_bearer = HTTPBearer(auto_error=True)


@dataclass
class CurrentUser:
    id: str
    role: str
    name: str
    delegated_admin: bool = False
    infra_manager: bool = False
    org: str = "lab1"


def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> CurrentUser:
    try:
        claims = decode_token(creds.credentials)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "유효하지 않은 토큰입니다")
    if claims.get("type") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "access 토큰이 필요합니다")
    return CurrentUser(id=claims["sub"], role=claims.get("role", ""), name=claims.get("name", ""), delegated_admin=bool(claims.get("delegated_admin", False)), infra_manager=bool(claims.get("infra_manager", False)), org=claims.get("org", "lab1"))


def require_roles(*roles: str):
    """특정 역할만 허용하는 의존성 팩토리. 예: Depends(require_roles('prof','admin'))"""

    def _checker(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if roles and user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "권한이 없습니다")
        return user

    return _checker
