from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from labmate_common.db import Base, engine
from labmate_common.migrate import add_columns, rename_columns

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
    rename_columns(engine, [
        ("att_correction_reqs", "status_req", "requested_status"),
        ("att_correction_reqs", "state", "status"),
        ("leaves", "start", "start_date"),
        ("leaves", "end", "end_date"),
    ])
    add_columns(engine, [
        ("attendance", "work_min", "INTEGER DEFAULT 0"),
        ("attendance", "session_start", "VARCHAR(5) DEFAULT ''"),
    ])
    yield


app = FastAPI(title="LabMate Attendance Service", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.add_middleware(OrgMiddleware)


@app.get("/health")
def health():
    return {"status": "ok", "service": "attendance"}


app.include_router(router)
app.include_router(make_notifications_router())
app.include_router(make_push_router())
app.include_router(make_data_admin_router("attendance"))
app.include_router(make_audit_router("attendance"))
app.include_router(make_config_router(DEFAULTS))
