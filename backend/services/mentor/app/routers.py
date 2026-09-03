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
from .masters import DEFAULTS, FEATURES
from .models import InterviewTurn, Principle, Secret, Usage
from .openrouter import MentorError, chat, check_key, models
from .prompts import CATEGORIES, SEED_QUESTION, build, extract_messages, interview_messages, nudge_messages

router = APIRouter()
KEY_ID = "openrouter"


def _load_key(db: Session) -> str:
    row = db.get(Secret, KEY_ID)
    return decrypt(row.value_enc) if row and row.value_enc else ""


def cfg(db: Session, key: str):
    """설정 조회 — 미설정 시 DEFAULTS 를 쓴다.

    /config 는 get_all_settings(DEFAULTS) 로 기본값을 채워 내려주므로, 여기서 다른
    기본값을 쓰면 화면에 보이는 설정과 실제 판정이 갈라진다(실제로 ai_roles 가
    빈 배열로 떨어져 아무도 못 쓰는 상태가 됐다).
    """
    return get_setting(db, key, DEFAULTS[key])


def _principles(db: Session) -> list[str]:
    """학생 가이드에 반영할 지침 — 교수가 승인한 것만."""
    rows = db.scalars(select(Principle).where(Principle.approved.is_(True)).order_by(Principle.category, Principle.order))
    return [r.text for r in rows]


# 기능별 출력 예산 하한. 추론형 모델은 답이 짧아도 사고에 토큰을 쓴다.
BUDGET: dict[str, int] = {"nudge": 4000, "philosophy": 3000}


def budget(db: Session, feature: str) -> int:
    return max(BUDGET.get(feature, 0), int(cfg(db, "ai_max_output_tokens") or 2000))


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
    enabled = bool(cfg(db, "ai_enabled")) and bool(_load_key(db))
    feats = cfg(db, "ai_features") or {}
    roles = cfg(db, "ai_roles") or []
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
    if not cfg(db, "ai_enabled"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "AI 멘토가 꺼져 있습니다. 관리자에게 문의하세요.")
    if user.role not in (cfg(db, "ai_roles") or []):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "이 계정은 AI 멘토를 사용할 수 없습니다.")
    if not (cfg(db, "ai_features") or {}).get(body.feature):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "이 기능은 관리자가 꺼 두었습니다.")

    cap = float(cfg(db, "ai_monthly_cost_cap_usd") or 0)
    if cap and _month_cost(db) >= cap:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            f"이번 달 AI 사용 한도(${cap:g})를 다 썼습니다. 다음 달에 다시 쓸 수 있습니다.")
    if not (body.body or body.title).strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "점검할 내용이 비어 있습니다.")

    key = _load_key(db)
    if not key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "OpenRouter 키가 설정되지 않았습니다.")
    model = cfg(db, "ai_model") or DEFAULTS["ai_model"]
    max_tokens = budget(db, body.feature)

    log = Usage(user_id=user.id, user_name=user.name, feature=body.feature, model=model)
    try:
        out = await chat(key, model, build(body.feature, body.title, body.body, body.context, _principles(db)), max_tokens)
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
        cap_usd=float(cfg(db, "ai_monthly_cost_cap_usd") or 0), by_feature=by,
    )


# ── 지도교수 철학 ──
def _parse_principles(raw: str) -> list[dict]:
    """모델 응답에서 지침 목록을 꺼낸다.

    응답이 토큰 상한에 걸려 배열이 닫히지 않은 채 오는 경우가 있어, 통째로 파싱해
    보고 실패하면 완성된 객체만 하나씩 건진다.
    """
    import json
    import re

    start, end = raw.find("["), raw.rfind("]")
    if start >= 0 and end > start:
        try:
            got = json.loads(raw[start:end + 1])
            if isinstance(got, list):
                return [g for g in got if isinstance(g, dict) and str(g.get("text", "")).strip()]
        except (ValueError, json.JSONDecodeError):
            pass
    out = []
    for m in re.finditer(r"\{[^{}]*\}", raw[start if start >= 0 else 0:]):
        try:
            g = json.loads(m.group())
        except (ValueError, json.JSONDecodeError):
            continue
        if isinstance(g, dict) and str(g.get("text", "")).strip():
            out.append(g)
    return out


def _require_prof(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if user.role not in ("prof", "admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "지도교수만 사용할 수 있습니다")
    return user


async def _ask(db: Session, msgs: list[dict], user: CurrentUser, feature: str, max_tokens: int | None = None) -> str:
    """멘토 호출 공통 — 설정·한도 확인 후 호출하고 사용량을 남긴다."""
    if not cfg(db, "ai_enabled"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "AI 멘토가 꺼져 있습니다. 관리자에게 문의하세요.")
    cap = float(cfg(db, "ai_monthly_cost_cap_usd") or 0)
    if cap and _month_cost(db) >= cap:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, f"이번 달 AI 사용 한도(${cap:g})를 다 썼습니다.")
    key = _load_key(db)
    if not key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "OpenRouter 키가 설정되지 않았습니다.")
    model = cfg(db, "ai_model") or DEFAULTS["ai_model"]
    log = Usage(user_id=user.id, user_name=user.name, feature=feature, model=model)
    try:
        out = await chat(key, model, msgs, max_tokens or int(cfg(db, "ai_max_output_tokens") or 1200))
    except MentorError as e:
        log.ok, log.detail = 0, str(e)[:300]
        db.add(log); db.commit()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))
    log.model, log.prompt_tokens = out["model"], out["prompt_tokens"]
    log.completion_tokens, log.cost_usd = out["completion_tokens"], out["cost_usd"]
    db.add(log); db.commit()
    return out["text"]


@router.get("/philosophy/categories")
def philosophy_categories(_: CurrentUser = Depends(_require_prof)):
    return {"categories": CATEGORIES}


@router.get("/philosophy/interview", response_model=schemas.TurnOut)
def interview_history(category: str, user: CurrentUser = Depends(_require_prof), db: Session = Depends(get_db)):
    rows = db.scalars(select(InterviewTurn)
                      .where(InterviewTurn.user_id == user.id, InterviewTurn.category == category)
                      .order_by(InterviewTurn.at)).all()
    return schemas.TurnOut(history=[{"role": r.role, "content": r.text} for r in rows])


@router.post("/philosophy/interview", response_model=schemas.TurnOut)
async def interview_step(body: schemas.TurnIn, user: CurrentUser = Depends(_require_prof), db: Session = Depends(get_db)):
    if body.category not in CATEGORIES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "알 수 없는 주제입니다")
    rows = list(db.scalars(select(InterviewTurn)
                           .where(InterviewTurn.user_id == user.id, InterviewTurn.category == body.category)
                           .order_by(InterviewTurn.at)))
    # 첫 진입 — 모델을 부르지 않고 준비된 질문으로 시작한다(비용·지연 절약).
    if not rows and not body.text.strip():
        q = SEED_QUESTION[body.category]
        db.add(InterviewTurn(user_id=user.id, category=body.category, role="assistant", text=q))
        db.commit()
        return schemas.TurnOut(question=q, history=[{"role": "assistant", "content": q}])

    if body.text.strip():
        db.add(InterviewTurn(user_id=user.id, category=body.category, role="user", text=body.text.strip()))
        db.commit()
        rows = list(db.scalars(select(InterviewTurn)
                               .where(InterviewTurn.user_id == user.id, InterviewTurn.category == body.category)
                               .order_by(InterviewTurn.at)))

    history = [{"role": r.role, "content": r.text} for r in rows]
    q = await _ask(db, interview_messages(body.category, history), user, "philosophy")
    db.add(InterviewTurn(user_id=user.id, category=body.category, role="assistant", text=q))
    db.commit()
    return schemas.TurnOut(question=q, history=history + [{"role": "assistant", "content": q}])


@router.delete("/philosophy/interview", response_model=schemas.MessageOut)
def interview_reset(category: str, user: CurrentUser = Depends(_require_prof), db: Session = Depends(get_db)):
    for r in db.scalars(select(InterviewTurn).where(InterviewTurn.user_id == user.id, InterviewTurn.category == category)):
        db.delete(r)
    db.commit()
    return schemas.MessageOut(detail="대화를 지웠습니다. 처음부터 다시 시작할 수 있습니다.")


@router.post("/philosophy/extract", response_model=schemas.ExtractOut)
async def philosophy_extract(category: str, user: CurrentUser = Depends(_require_prof), db: Session = Depends(get_db)):
    """대화에서 지침 초안을 뽑는다. 저장은 하되 approved=False — 교수가 검토해야 학생에게 반영된다."""
    rows = list(db.scalars(select(InterviewTurn)
                           .where(InterviewTurn.user_id == user.id, InterviewTurn.category == category)
                           .order_by(InterviewTurn.at)))
    if len([r for r in rows if r.role == "user"]) < 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "먼저 몇 가지 질문에 답해 주세요.")
    # 정리는 드물게 부르는 대신 길어질 수 있어 예산을 넉넉히 준다.
    raw = await _ask(db, extract_messages(category, [{"role": r.role, "content": r.text} for r in rows]),
                     user, "philosophy", max_tokens=budget(db, "philosophy"))
    items = _parse_principles(raw)
    if not items:
        return schemas.ExtractOut(detail="지침을 정리하지 못했습니다. 대화를 조금 더 이어간 뒤 다시 시도해 주세요.")
    out = []
    base = db.scalar(select(func.count(Principle.id)).where(Principle.category == category)) or 0
    for i, it in enumerate(items[:6]):
        text = str(it.get("text", "")).strip()
        if not text:
            continue
        p = Principle(category=category, text=text[:500], rationale=str(it.get("rationale", ""))[:2000],
                      approved=False, source="ai", by_id=user.id, order=base + i)
        db.add(p)
        out.append(p)
    db.commit()
    return schemas.ExtractOut(drafts=[schemas.PrincipleOut.model_validate(p) for p in out])


@router.get("/philosophy/principles", response_model=list[schemas.PrincipleOut])
def principles_list(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """교수·관리자는 초안까지, 학생은 승인된 지침만 본다(무엇을 기준으로 지도받는지 알 수 있어야 한다)."""
    stmt = select(Principle).order_by(Principle.category, Principle.order)
    if user.role not in ("prof", "admin"):
        stmt = stmt.where(Principle.approved.is_(True))
    return list(db.scalars(stmt))


@router.post("/philosophy/principles", response_model=schemas.PrincipleOut, status_code=201)
def principle_add(body: schemas.PrincipleIn, user: CurrentUser = Depends(_require_prof), db: Session = Depends(get_db)):
    base = db.scalar(select(func.count(Principle.id)).where(Principle.category == body.category)) or 0
    p = Principle(category=body.category, text=body.text, rationale=body.rationale,
                  approved=body.approved, source="manual", by_id=user.id, order=base)
    db.add(p)
    record(db, user, "지침 추가", body.category, body.text[:160])
    db.commit(); db.refresh(p)
    return p


@router.patch("/philosophy/principles/{pid}", response_model=schemas.PrincipleOut)
def principle_edit(pid: str, body: dict, user: CurrentUser = Depends(_require_prof), db: Session = Depends(get_db)):
    p = db.get(Principle, pid)
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "지침을 찾을 수 없습니다")
    for k in ("text", "rationale", "approved", "order", "category"):
        if k in body:
            setattr(p, k, body[k])
    record(db, user, "지침 수정", p.category, f"{'승인' if p.approved else '보류'} · {p.text[:120]}")
    db.commit(); db.refresh(p)
    return p


@router.delete("/philosophy/principles/{pid}", status_code=204)
def principle_del(pid: str, user: CurrentUser = Depends(_require_prof), db: Session = Depends(get_db)):
    p = db.get(Principle, pid)
    if p:
        record(db, user, "지침 삭제", p.category, p.text[:160])
        db.delete(p); db.commit()


# ── 능동 감독 ──
@router.post("/nudge")
async def nudge(body: dict, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """밀린 항목을 받아 독려 문구를 만든다.

    무엇이 밀렸는지는 데이터를 가진 화면(대시보드)이 판단해 넘긴다 — 서비스 간
    직접 호출을 하지 않는 이 시스템의 구조를 그대로 따른다.
    """
    if not (cfg(db, "ai_features") or {}).get("nudge"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "이 기능은 관리자가 꺼 두었습니다.")
    if user.role not in (cfg(db, "ai_roles") or []):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "이 계정은 AI 멘토를 사용할 수 없습니다.")
    signals = body.get("signals") or []
    if not signals:
        return {"text": ""}
    level = int(body.get("level") or 1)
    text = await _ask(db, nudge_messages(user.name, signals, _principles(db), level), user, "nudge",
                      max_tokens=budget(db, "nudge"))
    return {"text": text}


# ── 모델 비교 ──
# 어떤 모델이 이 연구실 글을 잘 봐 주는지는 돌려 봐야 안다. 같은 글을 여러 모델에
# 보내 결과를 나란히 보여 준다(관리자 전용, 비교 자체도 사용량에 잡힌다).
SAMPLE = (
    "이번 주에 실험을 좀 해봤는데 성능이 많이 좋아진 것 같아요. "
    "데이터 전처리 부분도 개선했고요. 조만간 추가 실험도 진행해서 결과를 공유드리겠습니다. "
    "관련해서 이슈는 딱히 없었습니다. 앞으로도 열심히 하겠습니다."
)


@router.post("/compare")
async def compare(body: dict, user: CurrentUser = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    """모델 2~4개에 같은 글을 보내 응답·비용·소요시간을 비교한다."""
    import asyncio
    import time

    ids = [m for m in (body.get("models") or []) if isinstance(m, str)][:4]
    if not ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "비교할 모델을 1개 이상 골라 주세요.")
    key = _load_key(db)
    if not key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "먼저 OpenRouter 키를 저장하세요.")
    feature = body.get("feature") or "report"
    if feature not in FEATURES:
        feature = "report"
    text = (body.get("text") or SAMPLE).strip()[:4000]
    msgs = build(feature, body.get("title") or "주간 진행 보고", text, {}, _principles(db))
    max_tokens = int(cfg(db, "ai_max_output_tokens") or 1200)

    async def one(mid: str) -> dict:
        t0 = time.monotonic()
        try:
            out = await chat(key, mid, msgs, max_tokens)
        except MentorError as e:
            db.add(Usage(user_id=user.id, user_name=user.name, feature="compare", model=mid, ok=0, detail=str(e)[:300]))
            return {"model": mid, "ok": False, "detail": str(e)}
        db.add(Usage(user_id=user.id, user_name=user.name, feature="compare", model=out["model"],
                     prompt_tokens=out["prompt_tokens"], completion_tokens=out["completion_tokens"], cost_usd=out["cost_usd"]))
        return {"model": mid, "ok": True, "text": out["text"], "cost_usd": out["cost_usd"],
                "tokens": out["prompt_tokens"] + out["completion_tokens"], "seconds": round(time.monotonic() - t0, 1)}

    results = await asyncio.gather(*[one(m) for m in ids])
    db.commit()
    return {"sample": text, "results": list(results)}


@router.get("/compare/sample")
def compare_sample(_: CurrentUser = Depends(require_roles("admin"))):
    return {"text": SAMPLE}
