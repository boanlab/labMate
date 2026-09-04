from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from labmate_common.audit import make_audit_router
from labmate_common.configstore import make_config_router
from labmate_common.db import Base, engine
from labmate_common.tenancy import OrgMiddleware

from . import models  # noqa: F401
from .masters import DEFAULTS
from .routers import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="LabMate Mentor Service", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.add_middleware(OrgMiddleware)


@app.get("/health")
def health():
    return {"status": "ok", "service": "mentor"}


app.include_router(router)
# 백업/복구(make_data_admin_router)는 일부러 붙이지 않는다 — export 가 모든 테이블을
# JSON 으로 덤프하므로 붙이는 순간 API 키가 백업 파일마다 실려 나간다.
app.include_router(make_audit_router("mentor"))
app.include_router(make_config_router(DEFAULTS))
