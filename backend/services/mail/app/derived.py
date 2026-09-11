"""조회 시점에 계산하는 알림 항목(전자메일) — 안 읽은 메일.

메일은 우리 DB 에 없으므로 저장해 둘 알림도 없다. 종이 물을 때마다 IMAP 에 물어
안 읽은 메일을 알림으로 만든다. 읽으면 다음 조회에서 저절로 사라진다.

다만 종은 45초마다 묻는다. 그때마다 메일 서버에 붙으면 서버에도, 화면에도 부담이라
계정별로 잠깐 담아 둔다(TTL). 새 메일이 늦어도 2분 안에는 종에 뜬다.
"""
from __future__ import annotations

import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from labmate_common.configstore import get_all_settings
from labmate_common.deps import CurrentUser
from labmate_common.notifications import Derived

from . import mailbox
from .crypto import decrypt
from .masters import DEFAULTS
from .models import MailAccount

TTL = 110                                   # 초 — 종의 폴링 주기(45초)보다 길게
_cache: dict[str, tuple[float, list[Derived]]] = {}


def derive(user: CurrentUser, db: Session) -> list[Derived]:
    cfg = get_all_settings(db, DEFAULTS)
    if not cfg.get("mail_enabled"):
        return []
    out: list[Derived] = []
    for acc in db.scalars(select(MailAccount).where(MailAccount.uid == user.id)):
        hit = _cache.get(acc.id)
        if hit and hit[0] > time.time():
            out.extend(hit[1])
            continue
        rows: list[Derived] = []
        pw = decrypt(acc.password_enc or "")
        if pw:
            try:
                for m in mailbox.unseen_briefs(acc, cfg, pw):
                    rows.append(Derived(
                        id=f"mail-{acc.id}-{m['uid']}", kind="mail",
                        title=f"새 메일 · {m['from_name']}", body=m["subject"],
                        link=f"/mail?account={acc.id}&uid={m['uid']}", ref_id=m["uid"]))
            except Exception:               # noqa: BLE001 — 메일 서버가 굼떠도 다른 알림은 나가야 한다
                rows = []
        _cache[acc.id] = (time.time() + TTL, rows)
        out.extend(rows)
    return out
