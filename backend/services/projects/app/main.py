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
from .routers import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    # 멱등 컬럼 보강
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS by_id VARCHAR(32) DEFAULT ''"))
        conn.execute(text("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS done_date DATE"))
        conn.execute(text("ALTER TABLE note_pages ADD COLUMN IF NOT EXISTS share_uids JSON DEFAULT '[]'::json"))
    rename_columns(engine, [
        ("publications", "sub", "index_type"),
    ])
    yield


app = FastAPI(title="LabMate Projects Service", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.add_middleware(OrgMiddleware)


@app.get("/health")
def health():
    return {"status": "ok", "service": "projects"}


app.include_router(router)
app.include_router(make_data_admin_router("projects"))
app.include_router(make_audit_router("projects"))
app.include_router(make_config_router(DEFAULTS))
