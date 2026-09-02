from __future__ import annotations

from datetime import date
from pydantic import BaseModel, Field


class AssetIn(BaseModel):
    asset_class: str = "연구실"
    asset_no: str = ""
    name: str
    spec: str = ""
    model: str = ""
    owner_id: str = ""
    project_id: str = ""
    building: str = ""
    floor: str = ""
    room: str = ""
    location: str = ""
    buy_date: date | None = None
    note: str = ""
    bookable: bool = False              # 자원예약 대상으로 노출할지


class AssetOut(AssetIn):
    id: str
    model_config = {"from_attributes": True}


class DeviceIn(BaseModel):
    rack: str
    pos: int = 1
    size: int = 1
    type: str = "서버"
    name: str
    ip: str = ""
    asset_no: str = ""
    spec: dict = Field(default_factory=dict)
    note: str = ""


class DeviceOut(DeviceIn):
    id: str
    model_config = {"from_attributes": True}


class DevicePatch(BaseModel):
    rack: str | None = None
    pos: int | None = None
    size: int | None = None
    type: str | None = None
    name: str | None = None
    ip: str | None = None
    note: str | None = None


class RackIn(BaseModel):
    name: str
    u_height: int = 42


class RackPatch(BaseModel):
    name: str | None = None
    u_height: int | None = None


class RackOut(BaseModel):
    id: str
    name: str
    u_height: int
    order: int
    model_config = {"from_attributes": True}


class BookingIn(BaseModel):
    resource: str
    date: date
    start: str = ""
    end: str = ""
    purpose: str = ""


class BookingOut(BookingIn):
    id: str
    by_id: str
    model_config = {"from_attributes": True}


class FileIn(BaseModel):
    cat: str = "문서"
    name: str
    ver: str = "v1.0"
    size: str = ""
    note: str = ""


class FileOut(FileIn):
    id: str
    by_id: str
    model_config = {"from_attributes": True}


class VideoIn(BaseModel):
    plat: str = "유튜브"
    cat: str = "교육"
    title: str
    link: str = ""
    dur: str = ""
    desc: str = ""


class VideoOut(VideoIn):
    id: str
    by_id: str
    model_config = {"from_attributes": True}


class Lesson(BaseModel):
    id: str = ""
    title: str
    type: str = "영상"
    ref: str = ""
    dur: str = ""
    body: str = ""


class CourseIn(BaseModel):
    cat: str = "온보딩"
    title: str
    desc: str = ""
    owner_id: str = ""
    lessons: list[Lesson] = Field(default_factory=list)
    required: bool = False
    due: date | None = None
    target_roles: list[str] = Field(default_factory=list)


class CourseOut(BaseModel):
    id: str
    cat: str
    title: str
    desc: str
    owner_id: str
    lessons: list[dict]
    required: bool = False
    due: date | None = None
    target_roles: list[str] = Field(default_factory=list)
    model_config = {"from_attributes": True}
