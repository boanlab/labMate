from __future__ import annotations

from datetime import date, datetime
from pydantic import BaseModel, Field


class ProjectIn(BaseModel):
    kind: str = "grant"           # grant(연구과제)/activity(프로젝트)
    code: str
    name: str
    category: str = "과제"
    status: str = "진행 중"
    agency: str = ""
    program: str = ""
    agreement_no: str = ""
    lead_id: str = ""
    pm_id: str = ""
    members: list[str] = Field(default_factory=list)
    goals: dict[str, int] = Field(default_factory=dict)
    start: date | None = None
    end: date | None = None
    desc: str = ""
    meta: dict = Field(default_factory=dict)


class ProjectOut(ProjectIn):
    id: str
    model_config = {"from_attributes": True}


class TaskIn(BaseModel):
    title: str
    assignee_id: str = ""
    status: str = "예정"
    start: date | None = None
    due: date | None = None
    done_date: date | None = None   # 실제 마감일(완료 처리일)
    body: str = ""
    link: str = ""
    files: list[dict] = Field(default_factory=list)


class TaskOut(TaskIn):
    id: str
    project_id: str
    by_id: str = ""
    model_config = {"from_attributes": True}


class MilestoneIn(BaseModel):
    name: str
    due: date | None = None
    done: bool = False


class MilestoneOut(MilestoneIn):
    id: str
    project_id: str
    model_config = {"from_attributes": True}


class PublicationIn(BaseModel):
    kind: str
    title: str
    project_id: str = ""
    scope: str = "국외"
    index_type: str = ""
    index_grade: str = ""
    authors: str = ""
    funding: str = ""
    status: str = "작성중"
    pub_date: date | None = None
    abstract: str = ""
    meta: dict = Field(default_factory=dict)
    files: list[dict] = Field(default_factory=list)


class PublicationOut(PublicationIn):
    id: str
    model_config = {"from_attributes": True}


class NotePageIn(BaseModel):
    parent_id: str = ""
    title: str = "제목 없음"
    icon: str = "📄"
    content: str = ""
    project_id: str = ""
    tags: list[str] = Field(default_factory=list)
    share_uids: list[str] = Field(default_factory=list)
    sort: float | None = None


class NotePagePatch(BaseModel):
    parent_id: str | None = None
    title: str | None = None
    icon: str | None = None
    content: str | None = None
    project_id: str | None = None
    tags: list[str] | None = None
    share_uids: list[str] | None = None
    sort: float | None = None


class NotePageOut(BaseModel):
    id: str
    parent_id: str
    sort: float
    title: str
    icon: str
    content: str
    project_id: str
    tags: list[str]
    owner_id: str
    updated_by: str = ""
    share_uids: list[str] = Field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None
    model_config = {"from_attributes": True}


class ArchiveIn(BaseModel):
    parent_id: str = ""
    title: str = "제목 없음"
    icon: str = "📄"
    content: str = ""
    tags: list[str] = Field(default_factory=list)
    files: list[dict] = Field(default_factory=list)
    sort: float | None = None


class ArchivePatch(BaseModel):
    parent_id: str | None = None
    title: str | None = None
    icon: str | None = None
    content: str | None = None
    tags: list[str] | None = None
    files: list[dict] | None = None
    sort: float | None = None


class ArchiveOut(BaseModel):
    id: str
    parent_id: str
    sort: float
    title: str
    icon: str
    content: str
    tags: list[str]
    files: list[dict]
    owner_id: str
    updated_by: str = ""
    created_at: datetime | None = None
    updated_at: datetime | None = None
    model_config = {"from_attributes": True}
