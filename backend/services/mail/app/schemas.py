"""요청·응답 모양. 비밀번호는 들어가기만 하고 나오지 않는다."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class AccountIn(BaseModel):
    label: str = Field(default="", max_length=60)
    address: str = Field(min_length=3, max_length=200)
    login: str = Field(default="", max_length=200)
    password: str = Field(default="", max_length=400)     # 빈 값이면 기존 비밀번호 유지
    imap_host: str = Field(default="", max_length=200)
    imap_port: int = 0
    imap_ssl: bool = True
    smtp_host: str = Field(default="", max_length=200)
    smtp_port: int = 0
    smtp_tls: str = Field(default="", max_length=10)
    is_default: bool = False


class AccountOut(BaseModel):
    id: str
    label: str
    address: str
    login: str
    hint: str                     # 비밀번호는 마스킹만
    imap_host: str
    imap_port: int
    imap_ssl: bool
    smtp_host: str
    smtp_port: int
    smtp_tls: str
    is_default: bool
    updated_at: datetime | None = None
    model_config = {"from_attributes": True}


class FolderOut(BaseModel):
    path: str                     # IMAP 경로(그대로 다시 넘긴다)
    label: str                    # 화면에 보일 이름
    kind: str = ""                # inbox·sent·drafts·trash·junk·archive(아는 것만)
    unread: int = 0


class MessageBrief(BaseModel):
    uid: str
    subject: str
    from_name: str
    from_addr: str
    to: str
    date: str                     # ISO(KST)
    size: int
    seen: bool
    flagged: bool
    answered: bool
    attachments: int
    preview: str = ""


class AttachmentOut(BaseModel):
    index: int
    name: str
    size: int
    mime: str


class MessageFull(MessageBrief):
    html: str = ""
    text: str = ""
    cc: str = ""
    files: list[AttachmentOut] = []


class SendIn(BaseModel):
    account_id: str
    to: str = Field(min_length=3)         # 쉼표로 여럿
    cc: str = ""
    subject: str = Field(default="", max_length=300)
    html: str = ""
    text: str = ""
    in_reply_to: str = ""                 # 답장일 때 원본 Message-ID


class FlagIn(BaseModel):
    seen: bool | None = None
    flagged: bool | None = None


class TestOut(BaseModel):
    ok: bool
    imap: str
    smtp: str


class MessageOut(BaseModel):
    detail: str
