"""전자메일 — 계정 관리(내 것만)와 IMAP·SMTP 중계.

메일 본문은 저장하지 않는다. 화면이 요청할 때 메일 서버에서 가져와 그대로 넘긴다.
비밀번호는 암호화해 두고, 접속하는 순간에만 푼다.
"""
from __future__ import annotations

import io
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from labmate_common.audit import record
from labmate_common.configstore import get_all_settings
from labmate_common.db import get_db
from labmate_common.deps import CurrentUser, get_current_user

from . import mailbox, schemas
from .crypto import decrypt, encrypt, mask
from .masters import DEFAULTS
from .models import MailAccount

router = APIRouter()


def _cfg(db: Session) -> dict:
    cfg = get_all_settings(db, DEFAULTS)
    if not cfg.get("mail_enabled"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "전자메일이 꺼져 있습니다 (관리자 › 환경설정 › 메일서버)")
    return cfg


def _acc(db: Session, user: CurrentUser, aid: str) -> MailAccount:
    """내 계정만 — 남의 계정은 있는지조차 알려 주지 않는다(404)."""
    a = db.get(MailAccount, aid)
    if not a or a.uid != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "계정을 찾을 수 없습니다")
    return a


def _pw(a: MailAccount) -> str:
    pw = decrypt(a.password_enc or "")
    if not pw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "비밀번호가 없습니다 — 계정 설정에서 다시 입력하세요")
    return pw


def _run(fn, *args, **kwargs):
    """메일 서버 쪽 실패는 502 로 — 우리 잘못인지 저쪽 잘못인지 화면에서 구분되도록."""
    try:
        return fn(*args, **kwargs)
    except HTTPException:
        raise
    except Exception as e:                                   # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e) or e.__class__.__name__) from e


# ── 계정 ──────────────────────────────────────────────────────────────
@router.get("/accounts", response_model=list[schemas.AccountOut])
def list_accounts(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return list(db.scalars(select(MailAccount).where(MailAccount.uid == user.id)
                           .order_by(MailAccount.sort, MailAccount.created_at)))


@router.post("/accounts", response_model=schemas.AccountOut, status_code=201)
def add_account(body: schemas.AccountIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    _cfg(db)
    if not body.password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "비밀번호를 입력하세요")
    mine = list(db.scalars(select(MailAccount).where(MailAccount.uid == user.id)))
    a = MailAccount(
        uid=user.id, label=body.label or body.address, address=body.address, login=body.login,
        password_enc=encrypt(body.password), hint=mask(body.password),
        imap_host=body.imap_host, imap_port=body.imap_port, imap_ssl=body.imap_ssl,
        smtp_host=body.smtp_host, smtp_port=body.smtp_port, smtp_tls=body.smtp_tls,
        is_default=body.is_default or not mine, sort=len(mine),
    )
    if a.is_default:
        for x in mine:
            x.is_default = False
    db.add(a)
    record(db, user, "메일 계정 추가", body.address, "")      # 비밀번호는 남기지 않는다
    db.commit(); db.refresh(a)
    return a


@router.patch("/accounts/{aid}", response_model=schemas.AccountOut)
def edit_account(aid: str, body: schemas.AccountIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    a = _acc(db, user, aid)
    for k in ("label", "address", "login", "imap_host", "imap_port", "imap_ssl", "smtp_host", "smtp_port", "smtp_tls"):
        setattr(a, k, getattr(body, k))
    if body.password:                                        # 빈 값이면 쓰던 비밀번호를 그대로 둔다
        a.password_enc, a.hint = encrypt(body.password), mask(body.password)
    if body.is_default:
        for x in db.scalars(select(MailAccount).where(MailAccount.uid == user.id, MailAccount.id != aid)):
            x.is_default = False
    a.is_default = body.is_default
    record(db, user, "메일 계정 수정", a.address, "")
    db.commit(); db.refresh(a)
    return a


@router.delete("/accounts/{aid}", status_code=204)
def del_account(aid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    a = _acc(db, user, aid)
    record(db, user, "메일 계정 삭제", a.address, "")
    db.delete(a); db.commit()


@router.post("/accounts/{aid}/test", response_model=schemas.TestOut)
def test_account(aid: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    cfg, a = _cfg(db), _acc(db, user, aid)
    imap_msg, smtp_msg = mailbox.check(a, cfg, _pw(a))
    return schemas.TestOut(ok=(imap_msg == "정상" and smtp_msg == "정상"), imap=imap_msg, smtp=smtp_msg)


# ── 메일함 ────────────────────────────────────────────────────────────
@router.get("/folders", response_model=list[schemas.FolderOut])
def list_folders(account_id: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    cfg, a = _cfg(db), _acc(db, user, account_id)
    return _run(mailbox.folders, a, cfg, _pw(a))


@router.get("/messages", response_model=list[schemas.MessageBrief])
def list_messages(account_id: str, folder: str = "INBOX", limit: int = 0, offset: int = 0, q: str = "",
                  user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    cfg, a = _cfg(db), _acc(db, user, account_id)
    size = limit or int(cfg.get("mail_list_size") or 30)
    return _run(mailbox.list_messages, a, cfg, _pw(a), folder, min(size, 100), max(offset, 0), q)


@router.get("/messages/{uid}", response_model=schemas.MessageFull)
def read_message(uid: str, account_id: str, folder: str = "INBOX",
                 user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    cfg, a = _cfg(db), _acc(db, user, account_id)
    pw = _pw(a)
    msg = _run(mailbox.get_message, a, cfg, pw, folder, uid)
    if not msg.get("seen"):                                  # 열었으면 읽은 것이다
        try:
            mailbox.set_flags(a, cfg, pw, folder, uid, True, None)
            msg["seen"] = True
        except Exception:                                    # noqa: BLE001 — 표시 실패가 읽기를 막지는 않는다
            pass
    return msg


@router.post("/messages/{uid}/flags", response_model=schemas.MessageOut)
def flag_message(uid: str, body: schemas.FlagIn, account_id: str, folder: str = "INBOX",
                 user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    cfg, a = _cfg(db), _acc(db, user, account_id)
    _run(mailbox.set_flags, a, cfg, _pw(a), folder, uid, body.seen, body.flagged)
    return schemas.MessageOut(detail="표시했습니다")


@router.get("/messages/{uid}/attachments/{index}")
def download_attachment(uid: str, index: int, account_id: str, folder: str = "INBOX",
                        user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    cfg, a = _cfg(db), _acc(db, user, account_id)
    name, mime, data = _run(mailbox.attachment, a, cfg, _pw(a), folder, uid, index)
    return StreamingResponse(io.BytesIO(data), media_type=mime or "application/octet-stream",
                             headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"})


@router.post("/send", response_model=schemas.MessageOut)
def send_message(body: schemas.SendIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    cfg, a = _cfg(db), _acc(db, user, body.account_id)
    _run(mailbox.send, a, cfg, _pw(a), to=body.to, cc=body.cc, subject=body.subject,
         html=body.html, text=body.text, in_reply_to=body.in_reply_to, sender_name=user.name)
    record(db, user, "메일 발송", body.to[:160], body.subject[:160])
    db.commit()
    return schemas.MessageOut(detail="보냈습니다")
