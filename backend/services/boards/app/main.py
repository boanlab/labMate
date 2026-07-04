from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from labmate_common.db import Base, engine
from labmate_common.migrate import rename_columns, rename_json_list_keys, add_columns

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
    add_columns(engine, [
        ("posts", "min_role", "VARCHAR(20) DEFAULT ''"),   # 게시판 공개 범위(직급 이상 접근 제어)
        # 작성/수정 이력 — 마지막 수정자·수정일(+회의록 작성일)
        ("notices", "updated_by", "VARCHAR(32) DEFAULT ''"), ("notices", "updated_at", "TIMESTAMPTZ DEFAULT now()"),
        ("posts", "updated_by", "VARCHAR(32) DEFAULT ''"), ("posts", "updated_at", "TIMESTAMPTZ DEFAULT now()"),
        ("meetings", "updated_by", "VARCHAR(32) DEFAULT ''"), ("meetings", "created_at", "TIMESTAMPTZ DEFAULT now()"), ("meetings", "updated_at", "TIMESTAMPTZ DEFAULT now()"),
    ])
    rename_columns(engine, [
        ("approvals", "doc", "content"),
        ("approvals", "line", "steps"),
        ("approvals", "ref", "source_ref"),
        ("approvals", "category", "deduct_account"),
        ("notices", "acks", "acked_user_ids"),
        ("notices", "targets", "target_user_ids"),
    ])
    rename_json_list_keys(engine, "meetings", "actions", {"task": "title", "who": "assignee_id"})
    yield


app = FastAPI(title="LabMate Boards Service", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.add_middleware(OrgMiddleware)


@app.get("/health")
def health():
    return {"status": "ok", "service": "boards"}


app.include_router(router)
app.include_router(make_notifications_router())
app.include_router(make_push_router())
app.include_router(make_data_admin_router("boards"))
app.include_router(make_audit_router("boards"))
app.include_router(make_config_router(DEFAULTS))
