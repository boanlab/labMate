"""관리자 데이터 백업/복구 — 각 서비스의 DB(테이블 JSON)와 첨부파일(uploads)을 내보내고 되돌린다.

프론트(관리자 화면)가 6개 서비스의 DB export(data.json)와 첨부파일을 ZIP으로 묶어 저장하고,
복구 시 서비스별로 DB import(전체 대체) + 첨부 복구(저장명 보존)를 호출한다.
"""
from __future__ import annotations

import datetime
import os
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import Date, DateTime, delete, select
from sqlalchemy.orm import Session

from .audit import record
from .config import settings
from .db import Base, get_db
from .deps import CurrentUser, require_roles


def _ser(v: Any) -> Any:
    if isinstance(v, (datetime.date, datetime.datetime)):
        return v.isoformat()
    return v


def _coerce(table, row: dict) -> dict:
    """JSON 문자열 날짜를 컬럼 타입에 맞게 date/datetime 으로 복원."""
    out: dict = {}
    for col in table.columns:
        if col.name not in row:
            continue
        v = row[col.name]
        if isinstance(v, str) and v:
            if isinstance(col.type, DateTime):
                v = datetime.datetime.fromisoformat(v)
            elif isinstance(col.type, Date):
                v = datetime.date.fromisoformat(v)
        out[col.name] = v
    return out


def make_data_admin_router(service_name: str) -> APIRouter:
    r = APIRouter(prefix="/admin/data", tags=["admin-data"])

    @r.get("/export")
    def export_data(_: CurrentUser = Depends(require_roles("admin")), db: Session = Depends(get_db)) -> dict:
        out: dict = {"service": service_name, "tables": {}}
        for t in Base.metadata.sorted_tables:
            rows = [dict(row._mapping) for row in db.execute(select(t))]
            out["tables"][t.name] = [{k: _ser(v) for k, v in row.items()} for row in rows]
        return out

    @r.post("/import")
    def import_data(payload: dict, _: CurrentUser = Depends(require_roles("admin")), db: Session = Depends(get_db)) -> dict:
        tables = payload.get("tables")
        if not isinstance(tables, dict):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "백업 형식이 올바르지 않습니다(tables 누락)")
        known = {t.name: t for t in Base.metadata.sorted_tables}
        unknown = [n for n in tables if n not in known]
        if unknown:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"알 수 없는 테이블: {unknown}")
        try:
            # FK 역순으로 비우고, 정순으로 채운다.
            for t in reversed(Base.metadata.sorted_tables):
                if t.name in tables:
                    db.execute(delete(t))
            for t in Base.metadata.sorted_tables:
                rows = tables.get(t.name)
                if rows:
                    db.execute(t.insert(), [_coerce(t, row) for row in rows])
            record(db, _, "데이터 복구", service_name, f"{sum(len(v) for v in tables.values())}건")
            db.commit()
        except Exception as e:  # noqa: BLE001
            db.rollback()
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"복구 실패: {e}")
        return {"detail": f"{service_name} 복구 완료", "restored": {n: len(v) for n, v in tables.items()}}

    @r.get("/files")
    def list_files(_: CurrentUser = Depends(require_roles("admin"))) -> dict:
        """이 서비스 첨부파일(uploads) 목록 — 완전 백업용."""
        d = settings.upload_dir
        names = [f for f in os.listdir(d) if os.path.isfile(os.path.join(d, f))] if os.path.isdir(d) else []
        return {"service": service_name, "files": names}

    @r.post("/files")
    async def restore_files(files: list[UploadFile] = File(default=[]), _: CurrentUser = Depends(require_roles("admin"))) -> dict:
        """첨부파일 복구 — 저장명 그대로 기록(DB url 참조 보존). 백업에 없는 기존 파일은 격리 폴더로 이동(보존)."""
        d = settings.upload_dir
        os.makedirs(d, exist_ok=True)
        incoming: set[str] = set()
        for f in files:
            name = os.path.basename(f.filename or "")
            if not name:
                continue
            with open(os.path.join(d, name), "wb") as w:
                w.write(await f.read())
            incoming.add(name)
        orphans = [f for f in os.listdir(d) if f not in incoming and os.path.isfile(os.path.join(d, f))]
        if orphans:   # 삭제 대신 _orphan-<시각>/ 로 이동
            qdir = os.path.join(d, "_orphan-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
            os.makedirs(qdir, exist_ok=True)
            for f in orphans:
                os.replace(os.path.join(d, f), os.path.join(qdir, f))
        return {"restored": len(incoming), "quarantined": len(orphans)}

    return r
