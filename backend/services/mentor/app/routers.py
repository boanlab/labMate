"""AI 멘토 라우터 — 키 관리(관리자)와 점검 요청(구성원)."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from labmate_common.audit import record
from labmate_common.configstore import get_setting
from labmate_common.db import get_db
from labmate_common.deps import CurrentUser, get_current_user, require_roles

from . import schemas
from .crypto import decrypt, encrypt, mask
from .masters import FEATURES
from .models import Secret, Usage
from .openrouter import MentorError, chat, check_key, models
from .prompts import build

router = APIRouter()
KEY_ID = "openrouter"


def _load_key(db: Session) -> str:
    row = db.get(Secret, KEY_ID)
    return decrypt(row.value_enc) if row and row.value_enc else ""


def _month() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _month_cost(db: Session) -> float:
    first = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    total = db.scalar(select(func.coalesce(func.sum(Usage.cost_usd), 0)).where(Usage.at >= first))
    return float(total or 0)


# ── 관리자: 키 ──
@router.get("/key", response_model=schemas.KeyStatusOut)
def key_status(_: CurrentUser = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    row = db.get(Secret, KEY_ID)
    if not row or not row.value_enc:
        return schemas.KeyStatusOut()
    return schemas.KeyStatusOut(
        configured=True, hint=row.hint,
        updated_at=row.updated_at.isoformat() if row.updated_at else "",
        updated_by=row.updated_by,
    )


@router.put("/key", response_model=schemas.MessageOut)
def key_set(body: schemas.KeyIn, user: CurrentUser = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    raw = body.key.strip()
    if not raw.startswith("sk-or-"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "OpenRouter 키는 sk-or- 로 시작합니다. 값을 다시 확인하세요.")
    row = db.get(Secret, KEY_ID)
    if row is None:
        row = Secret(id=KEY_ID)
        db.add(row)
    row.value_enc, row.hint, row.updated_by = encrypt(raw), mask(raw), user.id
    record(db, user, "AI 키 설정", "openrouter", mask(raw))
    db.commit()
    return schemas.MessageOut(detail="키가 저장되었습니다. 연결 테스트로 확인해 보세요.")


@router.delete("/key", response_model=schemas.MessageOut)
def key_clear(user: CurrentUser = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    row = db.get(Secret, KEY_ID)
    if row:
        db.delete(row)
        record(db, user, "AI 키 삭제", "openrouter", "")
        db.commit()
    return schemas.MessageOut(detail="키가 삭제되었습니다. AI 기능이 중단됩니다.")


@router.post("/key/test", response_model=schemas.KeyTestOut)
async def key_test(_: CurrentUser = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    key = _load_key(db)
    if not key:
        return schemas.KeyTestOut(ok=False, detail="저장된 키가 없습니다.")
    try:
        info = await check_key(key)
    except MentorError as e:
        return schemas.KeyTestOut(ok=False, detail=str(e))
    return schemas.KeyTestOut(ok=True, label=info["label"], usage_usd=info["usage_usd"], limit_usd=info["limit_usd"])


@router.get("/models", response_model=list[schemas.ModelOut])
async def model_list(_: CurrentUser = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    key = _load_key(db)
    if not key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "먼저 OpenRouter 키를 저장하세요.")
    try:
        return await models(key)
    except MentorError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))


# ── 구성원: 점검 ──
@router.get("/status")
def status_for_user(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """화면이 멘토 버튼을 보여줄지 판단하는 데 쓴다(키 값은 나가지 않는다)."""
    enabled = bool(get_setting(db, "ai_enabled", False)) and bool(_load_key(db))
    feats = get_setting(db, "ai_features", {}) or {}
    roles = get_setting(db, "ai_roles", []) or []
    allowed = user.role in roles
    return {
        "enabled": enabled and allowed,
        "features": {k: bool(enabled and allowed and feats.get(k)) for k in FEATURES},
        "labels": FEATURES,
    }


@router.post("/review", response_model=schemas.ReviewOut)
async def review(body: schemas.ReviewIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.feature not in FEATURES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "알 수 없는 점검 유형입니다")
    if not get_setting(db, "ai_enabled", False):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "AI 멘토가 꺼져 있습니다. 관리자에게 문의하세요.")
    if user.role not in (get_setting(db, "ai_roles", []) or []):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "이 계정은 AI 멘토를 사용할 수 없습니다.")
    if not (get_setting(db, "ai_features", {}) or {}).get(body.feature):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "이 기능은 관리자가 꺼 두었습니다.")

    cap = float(get_setting(db, "ai_monthly_cost_cap_usd", 0) or 0)
    if cap and _month_cost(db) >= cap:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            f"이번 달 AI 사용 한도(${cap:g})를 다 썼습니다. 다음 달에 다시 쓸 수 있습니다.")
    if not (body.body or body.title).strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "점검할 내용이 비어 있습니다.")

    key = _load_key(db)
    if not key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "OpenRouter 키가 설정되지 않았습니다.")
    model = get_setting(db, "ai_model", "") or "anthropic/claude-sonnet-4.6"
    max_tokens = int(get_setting(db, "ai_max_output_tokens", 1200) or 1200)

    log = Usage(user_id=user.id, user_name=user.name, feature=body.feature, model=model)
    try:
        out = await chat(key, model, build(body.feature, body.title, body.body, body.context), max_tokens)
    except MentorError as e:
        log.ok, log.detail = 0, str(e)[:300]
        db.add(log)
        db.commit()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))
    log.model = out["model"]
    log.prompt_tokens, log.completion_tokens = out["prompt_tokens"], out["completion_tokens"]
    log.cost_usd = out["cost_usd"]
    db.add(log)
    db.commit()
    return schemas.ReviewOut(text=out["text"], model=out["model"])


@router.get("/usage", response_model=schemas.UsageOut)
def usage(_: CurrentUser = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    first = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    rows = list(db.scalars(select(Usage).where(Usage.at >= first)))
    by: dict[str, int] = {}
    for r in rows:
        by[r.feature] = by.get(r.feature, 0) + 1
    return schemas.UsageOut(
        month=_month(), calls=len(rows), cost_usd=round(sum(float(r.cost_usd) for r in rows), 4),
        cap_usd=float(get_setting(db, "ai_monthly_cost_cap_usd", 0) or 0), by_feature=by,
    )
