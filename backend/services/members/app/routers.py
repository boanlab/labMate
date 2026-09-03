"""인증 + 사용자(구성원) 관리 라우터."""
from __future__ import annotations

import jwt
import redis
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from labmate_common.config import settings
from labmate_common.db import get_db
from labmate_common.audit import record
from labmate_common.deps import CurrentUser, get_current_user
from labmate_common.security import (
    create_access_token,
    create_download_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)

from . import schemas
from .models import ROLE_POSITION, ROLES, User, UserPref

router = APIRouter()
_redis = redis.from_url(settings.redis_url, decode_responses=True)
BLACKLIST_PREFIX = "auth:bl:"


def _blacklisted(jti: str) -> bool:
    try:
        return bool(_redis.exists(BLACKLIST_PREFIX + jti))
    except redis.RedisError:
        return False  # redis 장애 시 통과(가용성 우선)


DL_COOKIE = "lm_dl"

# ── 로그인 시도 제한 ──
# 제한이 없으면 비밀번호를 무제한으로 시도할 수 있다. 계정 기준과 IP 기준을 함께 센다.
#  · 계정 기준 — 특정 사람을 노린 대입
#  · IP 기준  — 여러 계정을 훑는 대입
# 성공하면 그 계정의 카운터는 지운다. 잠금은 자동으로 풀린다(관리자 개입 불필요).
FAIL_PREFIX = "auth:fail:"
MAX_FAILS_ACCOUNT = 5
MAX_FAILS_IP = 20
LOCK_SECONDS = 300


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return (fwd.split(",")[0].strip() if fwd else "") or (request.client.host if request.client else "-")


def _fail_keys(email: str, ip: str) -> tuple[str, str]:
    return FAIL_PREFIX + "id:" + email.lower(), FAIL_PREFIX + "ip:" + ip


def _login_locked(email: str, ip: str) -> int:
    """잠겨 있으면 남은 초, 아니면 0. redis 장애 시에는 막지 않는다(로그인 자체가 불가해지므로)."""
    try:
        ka, ki = _fail_keys(email, ip)
        na, ni = _redis.get(ka), _redis.get(ki)
        if na and int(na) >= MAX_FAILS_ACCOUNT:
            return max(1, _redis.ttl(ka))
        if ni and int(ni) >= MAX_FAILS_IP:
            return max(1, _redis.ttl(ki))
    except (redis.RedisError, ValueError):
        return 0
    return 0


def _note_login_fail(email: str, ip: str) -> None:
    try:
        for k in _fail_keys(email, ip):
            if _redis.incr(k) == 1:
                _redis.expire(k, LOCK_SECONDS)
    except redis.RedisError:
        pass


def _clear_login_fails(email: str, ip: str) -> None:
    try:
        _redis.delete(*_fail_keys(email, ip))
    except redis.RedisError:
        pass


def _issue_dl_cookie(response: Response, user_id: str) -> None:
    """첨부 다운로드용 httpOnly 쿠키 발급 — 스크립트가 읽을 수 없고 API 에도 통하지 않는다."""
    response.set_cookie(
        DL_COOKIE,
        create_download_token(sub=user_id),
        max_age=settings.download_token_hours * 3600,
        httponly=True,
        samesite="lax",
        secure=settings.is_prod,     # 앞단이 https 인 운영에서만 secure
        path="/",                    # 로그아웃(/api/...)에서도 읽고 지워야 한다
    )


def _revoke_dl_cookie(request: Request, response: Response) -> None:
    """쿠키를 지우고, 남아 있는 토큰도 만료까지 블랙리스트에 올린다."""
    raw = request.cookies.get(DL_COOKIE)
    if raw:
        try:
            claims = decode_token(raw)
            jti, exp = claims.get("jti"), claims.get("exp")
            if jti and exp:
                import time
                _redis.setex(BLACKLIST_PREFIX + jti, max(1, int(exp - time.time())), "1")
        except (jwt.PyJWTError, redis.RedisError):
            pass
    response.delete_cookie(DL_COOKIE, path="/")


def _can_manage_users(user: CurrentUser, db: Session) -> bool:
    if user.role in ("admin", "staff", "prof"):
        return True
    row = db.get(User, user.id)
    return bool(row and row.delegated_admin)


def _require_manage(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> CurrentUser:
    if not _can_manage_users(user, db):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "구성원 관리 권한이 없습니다")
    return user


# ───────────────────────── 인증 ─────────────────────────
@router.post("/login", response_model=schemas.TokenOut)
def login(body: schemas.LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = _client_ip(request)
    if (wait := _login_locked(body.email, ip)):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"로그인 시도가 너무 많습니다. {max(1, wait // 60)}분 뒤에 다시 시도하거나 관리자에게 비밀번호 재설정을 요청하세요.",
            headers={"Retry-After": str(wait)},
        )
    user = db.scalar(select(User).where(User.email == body.email))
    if not user or not user.active or not verify_password(body.password, user.password_hash):
        _note_login_fail(body.email, ip)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "이메일 또는 비밀번호가 올바르지 않습니다")
    _clear_login_fails(body.email, ip)
    from datetime import datetime, timezone
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    _issue_dl_cookie(response, user.id)
    return schemas.TokenOut(
        access=create_access_token(sub=user.id, role=user.role, name=user.name, delegated=user.delegated_admin, infra=user.infra_manager, org=user.org_id),
        refresh=create_refresh_token(sub=user.id),
        must_change_password=user.must_change_password,
    )


@router.post("/refresh", response_model=schemas.AccessOut)
def refresh(body: schemas.RefreshIn, response: Response, db: Session = Depends(get_db)):
    try:
        claims = decode_token(body.refresh)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "유효하지 않은 refresh 토큰")
    if claims.get("type") != "refresh" or _blacklisted(claims.get("jti", "")):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "사용할 수 없는 토큰")
    user = db.get(User, claims["sub"])
    if not user or not user.active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "사용자를 찾을 수 없습니다")
    _issue_dl_cookie(response, user.id)
    return schemas.AccessOut(access=create_access_token(sub=user.id, role=user.role, name=user.name, delegated=user.delegated_admin, infra=user.infra_manager, org=user.org_id))


@router.post("/logout", response_model=schemas.MessageOut)
def logout(body: schemas.RefreshIn, request: Request, response: Response):
    try:
        claims = decode_token(body.refresh)
        jti, exp = claims.get("jti"), claims.get("exp")
        if jti and exp:
            import time
            ttl = max(1, int(exp - time.time()))
            _redis.setex(BLACKLIST_PREFIX + jti, ttl, "1")
    except (jwt.PyJWTError, redis.RedisError):
        pass
    _revoke_dl_cookie(request, response)
    return schemas.MessageOut(detail="로그아웃되었습니다")


@router.get("/uploads-auth", include_in_schema=False)
def uploads_auth(request: Request) -> Response:
    """gateway auth_request 전용 — 첨부 열람 가능 여부만 204/401 로 답한다."""
    raw = request.cookies.get(DL_COOKIE)
    if not raw:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "로그인이 필요합니다")
    try:
        claims = decode_token(raw)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "만료되었거나 올바르지 않은 인증입니다")
    if claims.get("type") != "download" or _blacklisted(claims.get("jti", "")):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "사용할 수 없는 인증입니다")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=schemas.UserOut)
def me(response: Response, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(User, user.id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "사용자 없음")
    _issue_dl_cookie(response, user.id)      # 화면을 새로 열 때마다 다운로드 쿠키도 되살린다
    return row


@router.patch("/me", response_model=schemas.UserOut)
def update_me(body: schemas.MeUpdate, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """본인 프로필 수정(이름·연락처·학번). 역할·권한은 변경 불가."""
    row = db.get(User, user.id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "사용자 없음")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return row


@router.post("/change-password", response_model=schemas.MessageOut)
def change_password(
    body: schemas.ChangePasswordIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(User, user.id)
    if not row or not verify_password(body.current_password, row.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "현재 비밀번호가 올바르지 않습니다")
    if body.new_password == body.current_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "새 비밀번호가 기존과 동일합니다")
    row.password_hash = hash_password(body.new_password)
    row.must_change_password = False
    db.commit()
    return schemas.MessageOut(detail="비밀번호가 변경되었습니다")


# ───────────────────────── 구성원 관리 ─────────────────────────
@router.get("/users", response_model=list[schemas.UserOut])
def list_users(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    stmt = select(User).order_by(User.created_at)
    # 비활성(오프보딩) 구성원은 교수·관리자만 조회
    if user.role not in ("prof", "admin"):
        stmt = stmt.where(User.active.is_(True))
    return list(db.scalars(stmt))


@router.get("/directory", response_model=list[schemas.DirectoryOut])
def directory(_: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """이름 표시용 명부 — 비활성(퇴사) 구성원 포함, 연락처 제외.

    구성원 목록(/users)은 학생에게 퇴사자를 감추므로 id→이름 조회는 이쪽을 쓴다.
    """
    return list(db.scalars(select(User).order_by(User.name)))


@router.post("/users", response_model=schemas.UserOut, status_code=201)
def create_user(body: schemas.UserCreate, actor: CurrentUser = Depends(_require_manage), db: Session = Depends(get_db)):
    if body.role not in ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"role 은 {ROLES} 중 하나")
    if db.scalar(select(User).where(User.email == body.email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 존재하는 이메일")
    profile = body.model_dump(exclude={"email", "name", "role", "temp_password"})
    # 직급·인건비등급은 역할에서 자동 파생(역할이 단일 기준)
    profile["position"] = profile["grade"] = ROLE_POSITION.get(body.role, "")
    user = User(
        email=body.email, name=body.name, role=body.role,
        password_hash=hash_password(body.temp_password), must_change_password=True,
        **profile,
    )
    db.add(user)
    record(db, actor, "구성원 추가", body.name, body.email)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/users/{user_id}", response_model=schemas.UserOut)
def update_user(user_id: str, body: schemas.UserUpdate, actor: CurrentUser = Depends(_require_manage), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "사용자 없음")
    data = body.model_dump(exclude_unset=True)
    tmp = data.pop("temp_password", None)
    if "role" in data and data["role"] not in ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "유효하지 않은 role")
    # 권한상승 방지: 위임 학생은 교수·관리자 계정 및 권한·역할 변경 불가
    actor_admin = actor.role in ("prof", "staff", "admin") or bool(actor.delegated_admin)
    if not actor_admin:
        if user.role in ("prof", "staff", "admin"):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "교수·관리자 계정은 수정할 수 없습니다")
        if "delegated_admin" in data or "infra_manager" in data or "role" in data:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "권한·역할 변경은 교수/관리자만 가능합니다")
    for k, v in data.items():
        setattr(user, k, v)
    # 임시 비밀번호 입력 시 비밀번호 초기화 + 첫 로그인 변경 강제
    if tmp:
        user.password_hash = hash_password(tmp)
        user.must_change_password = True
    # 역할 변경 시 직급·인건비등급도 함께 갱신(역할이 단일 기준)
    user.position = user.grade = ROLE_POSITION.get(user.role, "")
    # 비활성화(오프보딩) 시 퇴실일 자동 기록 / 재활성화 시 해제
    if "active" in data:
        from datetime import date as _date
        if data["active"] is False and not user.exit_date:
            user.exit_date = _date.today()
        elif data["active"] is True:
            user.exit_date = None
    record(db, actor, "구성원 수정", user.name, ", ".join(data.keys()))
    db.commit()
    db.refresh(user)
    return user


@router.post("/users/{user_id}/reset-password", response_model=schemas.MessageOut)
def reset_password(user_id: str, body: schemas.ResetPasswordIn, actor: CurrentUser = Depends(_require_manage), db: Session = Depends(get_db)):
    """관리자 비밀번호 초기화 — 임시 비밀번호 발급 + 강제 변경 플래그 ON."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "사용자 없음")
    user.password_hash = hash_password(body.temp_password)
    user.must_change_password = True
    record(db, actor, "비밀번호 초기화", user.name, "")
    db.commit()
    return schemas.MessageOut(detail=f"{user.name} 비밀번호가 초기화되었습니다(첫 로그인 시 변경 필요)")


@router.delete("/users/{user_id}", status_code=204)
def delete_user(user_id: str, actor: CurrentUser = Depends(_require_manage), db: Session = Depends(get_db)):
    """구성원 삭제 — 본인 불가, 위임 학생은 교수·행정·관리자 계정 삭제 불가(권한상승 방지)."""
    user = db.get(User, user_id)
    if not user:
        return
    if user.id == actor.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "본인 계정은 삭제할 수 없습니다")
    actor_admin = actor.role in ("prof", "staff", "admin") or bool(actor.delegated_admin)
    if not actor_admin and user.role in ("prof", "staff", "admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "교수·관리자 계정은 삭제할 수 없습니다")
    record(db, actor, "구성원 삭제", user.name, user.email)
    db.delete(user)
    db.commit()


# ───────────────────────── 화면 설정(사용자별) ─────────────────────────
# 표 컬럼 폭처럼 "이 사람이 이렇게 보고 싶다"는 값. 브라우저가 아니라 계정에 붙여
# 두면 다른 PC 에서 접속해도 같은 화면으로 시작한다.

@router.get("/prefs")
def list_prefs(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    rows = db.scalars(select(UserPref).where(UserPref.user_id == user.id))
    return {r.key: r.value for r in rows}


@router.put("/prefs/{key}")
def set_pref(key: str, body: schemas.PrefIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    if len(key) > 60:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "설정 키가 너무 깁니다")
    row = db.get(UserPref, (user.id, key))
    if body.value is None or (isinstance(body.value, (dict, list)) and not body.value):
        if row:                                   # 빈 값은 저장하지 않고 지운다(기본값으로 되돌리기)
            db.delete(row); db.commit()
        return {"key": key, "value": None}
    if row:
        row.value = body.value
    else:
        db.add(UserPref(user_id=user.id, key=key, value=body.value))
    db.commit()
    return {"key": key, "value": body.value}
