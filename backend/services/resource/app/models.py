"""연구실 자원 도메인 — 자산·인프라·예약·자료실·LMS."""
from __future__ import annotations

import uuid
from datetime import date as date_t
from datetime import datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from labmate_common.db import Base
from labmate_common.tenancy import OrgScoped, SoftDelete


def _uuid() -> str:
    return uuid.uuid4().hex


class Asset(OrgScoped, SoftDelete, Base):
    __tablename__ = "assets"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    asset_class: Mapped[str] = mapped_column(String(20), default="연구실")
    asset_no: Mapped[str] = mapped_column(String(40), default="")
    name: Mapped[str] = mapped_column(String(200))
    spec: Mapped[str] = mapped_column(String(200), default="")
    model: Mapped[str] = mapped_column(String(120), default="")
    owner_id: Mapped[str] = mapped_column(String(32), default="")
    project_id: Mapped[str] = mapped_column(String(32), default="")
    building: Mapped[str] = mapped_column(String(120), default="")
    floor: Mapped[str] = mapped_column(String(20), default="")
    room: Mapped[str] = mapped_column(String(40), default="")
    location: Mapped[str] = mapped_column(String(200), default="")
    buy_date: Mapped[date_t | None] = mapped_column(Date, nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")
    bookable: Mapped[bool] = mapped_column(Boolean, default=False)   # 자원예약 대상(공용 장비)


class Device(OrgScoped, SoftDelete, Base):
    __tablename__ = "devices"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    rack: Mapped[str] = mapped_column(String(20))
    pos: Mapped[int] = mapped_column(Integer, default=1)     # 시작 U
    size: Mapped[int] = mapped_column(Integer, default=1)    # U 크기
    type: Mapped[str] = mapped_column(String(30), default="서버")
    name: Mapped[str] = mapped_column(String(120))
    ip: Mapped[str] = mapped_column(String(60), default="")
    asset_no: Mapped[str] = mapped_column(String(40), default="")
    spec: Mapped[dict] = mapped_column(JSON, default=dict)   # cpu/mem/ssd/hdd
    note: Mapped[str] = mapped_column(Text, default="")


class Rack(OrgScoped, SoftDelete, Base):
    __tablename__ = "racks"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(20))
    u_height: Mapped[int] = mapped_column(Integer, default=42)   # 랙 크기(U)
    order: Mapped[int] = mapped_column(Integer, default=0)


class Booking(OrgScoped, SoftDelete, Base):
    __tablename__ = "bookings"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    resource: Mapped[str] = mapped_column(String(80))
    date: Mapped[date_t] = mapped_column(Date, index=True)                    # 시작일
    # 여러 날 빌리는 자원(장비 등)을 위한 종료일. 비어 있으면 하루짜리다.
    end_date: Mapped[date_t | None] = mapped_column(Date, nullable=True)
    start: Mapped[str] = mapped_column(String(5), default="")                 # 하루짜리일 때만 의미가 있다
    end: Mapped[str] = mapped_column(String(5), default="")
    by_id: Mapped[str] = mapped_column(String(32))
    purpose: Mapped[str] = mapped_column(String(200), default="")


class LibFile(OrgScoped, SoftDelete, Base):
    __tablename__ = "files"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    cat: Mapped[str] = mapped_column(String(20), default="문서")  # 데이터셋/코드/문서/양식
    name: Mapped[str] = mapped_column(String(200))
    ver: Mapped[str] = mapped_column(String(20), default="v1.0")
    size: Mapped[str] = mapped_column(String(20), default="")
    by_id: Mapped[str] = mapped_column(String(32))
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Video(OrgScoped, SoftDelete, Base):
    __tablename__ = "videos"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    plat: Mapped[str] = mapped_column(String(10), default="유튜브")
    cat: Mapped[str] = mapped_column(String(20), default="교육")
    title: Mapped[str] = mapped_column(String(200))
    link: Mapped[str] = mapped_column(String(400), default="")
    dur: Mapped[str] = mapped_column(String(10), default="")
    desc: Mapped[str] = mapped_column(Text, default="")
    by_id: Mapped[str] = mapped_column(String(32))


