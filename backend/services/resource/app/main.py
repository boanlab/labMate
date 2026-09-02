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
from .routers import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    rename_columns(engine, [
        ("devices", "ip1", "ip"),
        ("assets", "cls", "asset_class"),
        ("assets", "no", "asset_no"),
    ])
    add_columns(engine, [
        ("assets", "bookable", "BOOLEAN DEFAULT FALSE NOT NULL"),
    ])
    yield


app = FastAPI(title="LabMate Resource Service", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.add_middleware(OrgMiddleware)


@app.get("/health")
def health():
    return {"status": "ok", "service": "resource"}


app.include_router(router)
app.include_router(make_data_admin_router("resource"))
app.include_router(make_audit_router("resource"))
app.include_router(make_config_router(DEFAULTS))
