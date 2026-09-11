from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from labmate_common.audit import make_audit_router
from labmate_common.configstore import make_config_router
from labmate_common.notifications import Notification, make_notifications_router  # noqa: F401
from labmate_common.db import Base, engine
from labmate_common.tenancy import OrgMiddleware

from . import models  # noqa: F401
from .derived import derive as _derive
from .masters import DEFAULTS
from .routers import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="LabMate Mail Service", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.add_middleware(OrgMiddleware)


@app.get("/health")
def health():
    return {"status": "ok", "service": "mail"}


app.include_router(router)
# 백업/복구(make_data_admin_router)는 붙이지 않는다 — 계정 비밀번호가 백업 파일마다
# 실려 나가기 때문이다(mentor 서비스와 같은 이유).
app.include_router(make_notifications_router(_derive))
app.include_router(make_audit_router("mail"))
app.include_router(make_config_router(DEFAULTS))
