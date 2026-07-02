"""연구비 라우터 — 예산·연구비집행·월별 인건비."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from labmate_common.configstore import get_setting
from labmate_common.db import get_db
from labmate_common.audit import record
from labmate_common.deps import CurrentUser, get_current_user

from . import schemas
from .masters import DEFAULTS
from .models import Budget, BudgetLog, Expense, Participation, Payslip

router = APIRouter()
FINANCE_ADMIN = ("prof", "staff", "admin")   # 예산·인건비 관리·승인 권한
STUDENT_PAYROLL_CAT = "학생인건비"            # 학생 인건비 지급 차감 예산 비목


def _fin_admin(user: CurrentUser) -> bool:
    return user.role in FINANCE_ADMIN or user.delegated_admin


def _grade_rates(db: Session) -> dict[str, int]:
    return get_setting(db, "grade_rates", DEFAULTS["grade_rates"])


def _budget_cat_names(db: Session) -> list[str]:
    """설정 비목(budget_types)의 비목명 목록 — 예산 자동생성 기준."""
    rows = get_setting(db, "budget_types", DEFAULTS["budget_types"]) or []
    return [(c.get("name") if isinstance(c, dict) else c) for c in rows]


# ── 예산 ──
@router.get("/budgets", response_model=list[schemas.BudgetOut])
def list_budgets(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _fin_admin(user):
        raise HTTPException(403, "예산 조회 권한이 없습니다")
    return list(db.scalars(select(Budget)))


@router.post("/budgets", response_model=schemas.BudgetOut, status_code=201)
def create_budget(body: schemas.BudgetIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _fin_admin(user):
        raise HTTPException(403, "예산 편성 권한이 없습니다")
    b = Budget(**body.model_dump(exclude={"reason"}))
    db.add(b); db.commit(); db.refresh(b)
    return b


@router.post("/budgets/set", response_model=schemas.BudgetOut)
def set_budget(body: schemas.BudgetSetIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """과제·비목 편성액 upsert(없으면 생성, 있으면 갱신+이력)."""
    if not _fin_admin(user):
        raise HTTPException(403, "예산 편성 권한이 없습니다")
    b = db.scalar(select(Budget).where(Budget.project_id == body.project_id, Budget.category == body.category))
    if not b:
        b = Budget(project_id=body.project_id, category=body.category, allocated=body.allocated, spent=0)
        db.add(b)
    else:
        if b.allocated != body.allocated:
            db.add(BudgetLog(budget_id=b.id, project_id=b.project_id, category=b.category,
                             before=b.allocated, after=body.allocated, reason=body.reason or "시트 일괄 편성", by_id=user.id))
            b.allocated = body.allocated
    db.commit(); db.refresh(b)
    return b


@router.post("/budgets/ensure/{project_id}", response_model=list[schemas.BudgetOut])
def ensure_budget(project_id: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """과제 표준 예산 비목 중 누락분만 0원으로 생성."""
    if not _fin_admin(user):
        raise HTTPException(403, "예산 편성 권한이 없습니다")
    existing = {b.category for b in db.scalars(select(Budget).where(Budget.project_id == project_id))}
    for c in _budget_cat_names(db):
        if c not in existing:
            db.add(Budget(project_id=project_id, category=c, allocated=0, spent=0))
    db.commit()
    return list(db.scalars(select(Budget).where(Budget.project_id == project_id)))


@router.patch("/budgets/{bid}", response_model=schemas.BudgetOut)
def update_budget(bid: str, body: schemas.BudgetIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _fin_admin(user):
        raise HTTPException(403, "예산 수정 권한이 없습니다")
    b = db.get(Budget, bid)
    if not b:
        raise HTTPException(404, "예산 없음")
    before = b.allocated
    if body.allocated != before:        # 편성액 변경 시 사유 이력 기록
        if not body.reason.strip():
            raise HTTPException(400, "편성액 변경 시 사유를 입력하세요")
        db.add(BudgetLog(budget_id=b.id, project_id=b.project_id, category=b.category,
                         before=before, after=body.allocated, reason=body.reason, by_id=user.id))
        record(db, user, "예산 변경", b.category, f"{before:,}→{body.allocated:,} ({body.reason})")
    b.project_id = body.project_id; b.category = body.category; b.allocated = body.allocated; b.spent = body.spent
    db.commit(); db.refresh(b)
    return b


@router.get("/budgets/logs", response_model=list[schemas.BudgetLogOut])
def budget_logs(_: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return list(db.scalars(select(BudgetLog).order_by(BudgetLog.at.desc())))


# ── 연구비집행(청구): 누구나 본인 청구 가능 ──
@router.get("/expenses", response_model=list[schemas.ExpenseOut])
def list_expenses(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    q = select(Expense).order_by(Expense.created_at.desc())
    rows = list(db.scalars(q))
    if not _fin_admin(user):
        rows = [e for e in rows if e.by_id == user.id]   # 본인 청구만
    return rows


@router.post("/expenses", response_model=schemas.ExpenseOut, status_code=201)
def create_expense(body: schemas.ExpenseIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """집행 내역 등록 — 예산 집행액 즉시 반영."""
    e = Expense(by_id=user.id, status="집행", **body.model_dump())
    db.add(e); db.flush()
    _apply_budget_spend(db, e.project_id, e.category, e.amount)
    db.commit(); db.refresh(e)
    return e


@router.put("/expenses/{eid}", response_model=schemas.ExpenseOut)
def update_expense(eid: str, body: schemas.ExpenseIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    e = db.get(Expense, eid)
    if not e or e.deleted_at:
        raise HTTPException(404, "집행 내역 없음")
    if e.by_id != user.id and not _fin_admin(user):
        raise HTTPException(403, "수정 권한이 없습니다")
    _apply_budget_spend(db, e.project_id, e.category, -e.amount)        # 기존 집행액 차감
    for k, v in body.model_dump(exclude_unset=True).items():       # 보낸 필드만 갱신
        setattr(e, k, v)
    e.status = "집행"
    _apply_budget_spend(db, e.project_id, e.category, e.amount)         # 변경분 반영
    db.commit(); db.refresh(e)
    return e


@router.delete("/expenses/{eid}", status_code=204)
def delete_expense(eid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    e = db.get(Expense, eid)
    if not e:
        raise HTTPException(404, "집행 내역 없음")
    if e.by_id != user.id and not _fin_admin(user):
        raise HTTPException(403, "삭제 권한이 없습니다")
    _apply_budget_spend(db, e.project_id, e.category, -e.amount)        # 예산 집행액 차감
    e.deleted_at = datetime.now(timezone.utc)
    db.commit()


@router.post("/expenses/{eid}/submit", response_model=schemas.ExpenseOut)
def submit_expense(eid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    e = db.get(Expense, eid)
    if not e or e.by_id != user.id:
        raise HTTPException(404, "청구 없음")
    # 증빙 미첨부 시 상신 차단
    if e.amount > 0 and not e.files:
        raise HTTPException(400, "증빙 파일을 첨부해야 상신할 수 있습니다")
    e.status = "상신"
    db.commit(); db.refresh(e)
    return e


def _apply_budget_spend(db: Session, project_id: str, category: str, delta: int) -> None:
    """해당 과제·비목 예산 집행액 가감. 예산 행이 없으면 생성."""
    b = db.scalar(select(Budget).where(Budget.project_id == project_id, Budget.category == category))
    if not b:
        b = Budget(project_id=project_id, category=category, allocated=0, spent=0)
        db.add(b)
    b.spent = max(0, (b.spent or 0) + delta)


@router.post("/expenses/{eid}/decide", response_model=schemas.ExpenseOut)
def decide_expense(eid: str, decision: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _fin_admin(user):
        raise HTTPException(403, "승인 권한이 없습니다")
    e = db.get(Expense, eid)
    if not e:
        raise HTTPException(404, "청구 없음")
    if e.status not in ("상신", "승인"):
        raise HTTPException(409, "상신 상태의 청구만 처리할 수 있습니다")
    was_approved = e.status == "승인"
    if decision == "승인":
        if not was_approved:                        # 승인 시 예산 집행액 증가
            _apply_budget_spend(db, e.project_id, e.category, e.amount)
        e.status = "승인"
    else:
        if was_approved:                            # 승인 취소 시 집행액 복원
            _apply_budget_spend(db, e.project_id, e.category, -e.amount)
        e.status = "반려"
    record(db, user, f"청구 {decision}", e.title, f"{e.amount:,}원")
    db.commit(); db.refresh(e)
    return e


@router.post("/expenses/{eid}/pay", response_model=schemas.ExpenseOut)
def pay_expense(eid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _fin_admin(user):
        raise HTTPException(403, "지급 권한이 없습니다")
    e = db.get(Expense, eid)
    if not e:
        raise HTTPException(404, "청구 없음")
    if e.status != "승인":
        raise HTTPException(409, "승인된 청구만 지급할 수 있습니다")
    e.status = "지급"
    db.commit(); db.refresh(e)
    return e


# ── 인건비(월별) ──
@router.get("/payslips", response_model=list[schemas.PayslipOut])
def list_payslips(month: str | None = None, year: str | None = None, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    q = select(Payslip)
    if month:
        q = q.where(Payslip.month == month)
    elif year:
        q = q.where(Payslip.month.like(f"{year}-%"))
    rows = list(db.scalars(q))
    if not _fin_admin(user):
        rows = [p for p in rows if p.uid == user.id]
    return rows


@router.get("/participations", response_model=list[schemas.ParticipationIn])
def list_parts(month: str, _: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return list(db.scalars(select(Participation).where(Participation.month == month)))


@router.post("/payroll/matrix")
def save_matrix(body: schemas.MatrixSaveIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """월별 참여율 매트릭스 저장 → 인건비 자동 산정. 행 합계 100% 초과 차단."""
    if not _fin_admin(user):
        raise HTTPException(403, "인건비 관리 권한이 없습니다")
    for r in body.rows:
        if sum(r.ratios.values()) > 100:
            raise HTTPException(400, f"참여율 합계 100% 초과: {r.uid}")
    rates = _grade_rates(db)                     # 등급단가 출처: 설정
    rates = {**rates, **(body.grade_rates or {})}  # 호출 측 오버라이드 허용
    db.execute(delete(Participation).where(Participation.month == body.month))
    db.execute(delete(Payslip).where(Payslip.month == body.month, Payslip.status == "예정"))
    for r in body.rows:
        for pid, rate_pct in r.ratios.items():
            if rate_pct <= 0:
                continue
            db.add(Participation(uid=r.uid, project_id=pid, rate_pct=rate_pct, month=body.month))
            amt = round(rates.get(r.grade, 0) * rate_pct / 100)
            db.add(Payslip(uid=r.uid, project_id=pid, month=body.month, amount=amt, status="예정"))
    db.commit()
    return {"detail": f"{body.month} 인건비 저장됨"}


@router.get("/participations/year", response_model=list[schemas.ParticipationIn])
def list_parts_year(year: str, project_id: str = "", _: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    q = select(Participation).where(Participation.month.like(f"{year}-%"))
    if project_id:
        q = q.where(Participation.project_id == project_id)
    return list(db.scalars(q))


@router.get("/participations/all", response_model=list[schemas.ParticipationIn])
def list_parts_all(_: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return list(db.scalars(select(Participation)))


@router.post("/participations/set")
def set_participation(body: schemas.ParticipationSetIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """단건 참여율 upsert — 참여율·예정 인건비 갱신, 지급확정 명세 보호."""
    if not _fin_admin(user):
        raise HTTPException(403, "인건비 관리 권한이 없습니다")
    if body.rate_pct < 0 or body.rate_pct > 100:
        raise HTTPException(400, "참여율은 0~100%")
    p = db.scalar(select(Participation).where(Participation.uid == body.uid, Participation.project_id == body.project_id, Participation.month == body.month))
    if not p:
        db.add(Participation(uid=body.uid, project_id=body.project_id, rate_pct=body.rate_pct, month=body.month))
    else:
        p.rate_pct = body.rate_pct
    ps = db.scalar(select(Payslip).where(Payslip.uid == body.uid, Payslip.project_id == body.project_id, Payslip.month == body.month))
    if ps and ps.status == "지급":
        pass  # 지급확정 명세 보호
    elif ps:
        ps.amount = body.amount; ps.status = "예정"
    else:
        db.add(Payslip(uid=body.uid, project_id=body.project_id, month=body.month, amount=body.amount, status="예정"))
    db.commit()
    return {"detail": "ok"}


@router.post("/payroll/year-matrix")
def save_year_matrix(body: schemas.YearMatrixSaveIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """연 단위 · 학생별 월 단위 참여율 저장(과제별) → 월별 인건비 자동 산정."""
    if not _fin_admin(user):
        raise HTTPException(403, "인건비 관리 권한이 없습니다")
    months = [f"{body.year}-{m:02d}" for m in range(1, 13)]
    for r in body.rows:
        for mm, rate_pct in r.monthly.items():
            if rate_pct < 0 or rate_pct > 100:
                raise HTTPException(400, f"참여율은 0~100% (uid={r.uid}, {mm}월={rate_pct})")
    rates = {**_grade_rates(db), **(body.grade_rates or {})}
    # 해당 과제·연도 12개월 예정분만 교체(확정분 보호)
    db.execute(delete(Participation).where(Participation.project_id == body.project_id, Participation.month.in_(months)))
    db.execute(delete(Payslip).where(Payslip.project_id == body.project_id, Payslip.month.in_(months), Payslip.status == "예정"))
    for r in body.rows:
        for mm, rate_pct in r.monthly.items():
            if rate_pct <= 0:
                continue
            month_str = f"{body.year}-{int(mm):02d}"
            db.add(Participation(uid=r.uid, project_id=body.project_id, rate_pct=rate_pct, month=month_str))
            grade_mm = r.grades.get(mm, r.grade)   # 월별 등급(진급 반영), 없으면 기본 등급
            amt = round(rates.get(grade_mm, 0) * rate_pct / 100)
            db.add(Payslip(uid=r.uid, project_id=body.project_id, month=month_str, amount=amt, status="예정"))
    db.commit()
    return {"detail": f"{body.year}년 {len(body.rows)}명 참여율 저장됨"}


@router.get("/payroll/rates")
def payroll_rates(_: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """학력등급별 기준단가(설정값)."""
    return _grade_rates(db)


@router.post("/payroll/confirm")
def confirm_month(month: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """월 인건비 확정 — 최신 예정 명세 채택, 예산은 과제별 delta 반영."""
    if not _fin_admin(user):
        raise HTTPException(403, "권한 없음")
    slips = list(db.scalars(select(Payslip).where(Payslip.month == month)))
    part_keys = {(p.uid, p.project_id) for p in db.scalars(select(Participation).where(Participation.month == month))}
    # 과제별 기존 확정 합
    prev_by_proj: dict[str, int] = {}
    for s in slips:
        if s.status == "지급":
            prev_by_proj[s.project_id] = prev_by_proj.get(s.project_id, 0) + (s.amount or 0)
    # (구성원, 과제)별 그룹핑
    groups: dict[tuple, list] = {}
    for s in slips:
        groups.setdefault((s.uid, s.project_id), []).append(s)
    new_by_proj: dict[str, int] = {}
    confirmed = 0
    for (uid, pid), arr in groups.items():
        pend = [s for s in arr if s.status == "예정"]
        paid = [s for s in arr if s.status == "지급"]
        if pend:                                  # 최신 예정 → 확정 채택, 나머지 제거
            keep = pend[-1]
            keep.status = "지급"
            for s in arr:
                if s is not keep:
                    db.delete(s)
            new_by_proj[pid] = new_by_proj.get(pid, 0) + (keep.amount or 0)
            confirmed += 1
        elif paid and (uid, pid) in part_keys:    # 예정 없음+참여율 유지 → 기존 확정 1건만 유지
            keep = paid[0]
            for s in paid[1:]:
                db.delete(s)
            new_by_proj[pid] = new_by_proj.get(pid, 0) + (keep.amount or 0)
        else:                                     # 참여율 삭제된 확정 → 제거
            for s in arr:
                db.delete(s)
    # 예산(학생인건비) 과제별 delta 반영
    for pid in set(list(prev_by_proj.keys()) + list(new_by_proj.keys())):
        delta = new_by_proj.get(pid, 0) - prev_by_proj.get(pid, 0)
        if delta:
            _apply_budget_spend(db, pid, STUDENT_PAYROLL_CAT, delta)
    db.commit()
    return {"detail": f"{month} {confirmed}건 지급확정(재계산)"}
