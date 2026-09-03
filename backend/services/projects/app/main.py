from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from labmate_common.db import Base, engine
from labmate_common.migrate import rename_columns

from . import models  # noqa: F401
from labmate_common.configstore import make_config_router

from .masters import DEFAULTS
from labmate_common.audit import make_audit_router
from labmate_common.tenancy import OrgMiddleware
from labmate_common.dataadmin import make_data_admin_router
from labmate_common.notifications import Notification, make_notifications_router  # noqa: F401
from labmate_common.push import PushSubscription, make_push_router  # noqa: F401
from .routers import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    # 멱등 컬럼 보강
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS by_id VARCHAR(32) DEFAULT ''"))
        conn.execute(text("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS done_date DATE"))
        conn.execute(text("ALTER TABLE note_pages ADD COLUMN IF NOT EXISTS share_uids JSON DEFAULT '[]'::json"))
        conn.execute(text("ALTER TABLE archive_pages ADD COLUMN IF NOT EXISTS updated_by VARCHAR(32) DEFAULT ''"))
        conn.execute(text("ALTER TABLE note_pages ADD COLUMN IF NOT EXISTS updated_by VARCHAR(32) DEFAULT ''"))
        conn.execute(text("UPDATE tasks SET status='진행 중' WHERE status='진행'"))   # 세부업무 상태를 프로젝트와 통일(진행→진행 중)
    rename_columns(engine, [
        ("publications", "sub", "index_type"),
    ])
    _migrate_goal_keys(engine)
    yield


def _migrate_goal_keys(engine) -> None:
    """과제 목표 지표 키를 실적 분류 어휘로 통일(멱등) — SCI→국제논문지·KCI→국내논문지·국외특허→국제특허."""
    import json
    remap = {"SCI": "국제논문지", "KCI": "국내논문지", "국외특허": "국제특허"}
    with engine.begin() as conn:
        rows = conn.execute(text("SELECT id, goals FROM projects WHERE goals::text ~ 'SCI|KCI|국외특허'")).fetchall()
        for rid, goals in rows:
            if not goals:
                continue
            new: dict = {}
            for k, v in goals.items():
                nk = remap.get(k, k)
                new[nk] = (new.get(nk, 0) or 0) + (v or 0)   # 대상 키 이미 있으면 합산
            conn.execute(text("UPDATE projects SET goals = CAST(:g AS json) WHERE id = :id"),
                         {"g": json.dumps(new, ensure_ascii=False), "id": rid})


app = FastAPI(title="LabMate Projects Service", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.add_middleware(OrgMiddleware)


@app.get("/health")
def health():
    return {"status": "ok", "service": "projects"}


app.include_router(router)
from .derived import derive as _derive   # noqa: E402
app.include_router(make_notifications_router(_derive))
app.include_router(make_push_router())
app.include_router(make_data_admin_router("projects"))
app.include_router(make_audit_router("projects"))
app.include_router(make_config_router(DEFAULTS))
