"""IMAP·SMTP 말하기 — 메일 원본은 메일 서버에 있고, 여기서는 그때그때 가져다 쓴다.

표준 라이브러리(imaplib·smtplib·email)만 쓴다. 메일 프로토콜은 오래됐지만 바뀌지
않아서, 얇게 감싸 두면 서버가 무엇이든 대체로 통한다.
"""
from __future__ import annotations

import imaplib
import re
import smtplib
from contextlib import contextmanager
from datetime import timedelta, timezone
from email import message_from_bytes
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.utils import formataddr, formatdate, getaddresses, make_msgid, parsedate_to_datetime

KST = timezone(timedelta(hours=9))
TIMEOUT = 20                      # 초 — 메일 서버가 느려도 화면이 통째로 멈추지 않도록

# IMAP 폴더 이름은 수정 UTF-7 로 온다(\\uD55C\\uAE00 폴더). 서버가 UTF-8 을 쓰면 그대로 지나간다.
_B64 = re.compile(r"&([A-Za-z0-9+,]*)-")


def _mutf7(name: str) -> str:
    def sub(m: re.Match) -> str:
        chunk = m.group(1)
        if not chunk:
            return "&"
        pad = "=" * ((4 - len(chunk) % 4) % 4)
        try:
            import base64
            return base64.b64decode(chunk.replace(",", "/") + pad).decode("utf-16-be")
        except Exception:                                    # noqa: BLE001 — 못 읽으면 원문 그대로
            return m.group(0)
    return _B64.sub(sub, name)


def _hdr(raw: str | None) -> str:
    """MIME 인코딩된 헤더를 사람이 읽는 글자로."""
    if not raw:
        return ""
    try:
        return str(make_header(decode_header(raw)))
    except Exception:                                        # noqa: BLE001
        return raw


def _addr_list(raw: str | None) -> str:
    return ", ".join(a for _, a in getaddresses([raw or ""]) if a)


def _first_addr(raw: str | None) -> tuple[str, str]:
    for name, addr in getaddresses([raw or ""]):
        return _hdr(name), addr
    return "", ""


# ── 접속 ──────────────────────────────────────────────────────────────
def imap_conf(acc, cfg: dict) -> tuple[str, int, bool]:
    host = acc.imap_host or cfg.get("mail_imap_host") or ""
    port = acc.imap_port or int(cfg.get("mail_imap_port") or 993)
    ssl = acc.imap_ssl if acc.imap_host else bool(cfg.get("mail_imap_ssl", True))
    return host, port, ssl


def smtp_conf(acc, cfg: dict) -> tuple[str, int, str]:
    host = acc.smtp_host or cfg.get("mail_smtp_host") or ""
    port = acc.smtp_port or int(cfg.get("mail_smtp_port") or 587)
    tls = acc.smtp_tls or cfg.get("mail_smtp_tls") or "starttls"
    return host, port, tls


@contextmanager
def imap(acc, cfg: dict, password: str, folder: str = ""):
    host, port, ssl = imap_conf(acc, cfg)
    if not host:
        raise RuntimeError("메일 서버(IMAP)가 설정되지 않았습니다 — 관리자 › 환경설정 › 메일서버")
    m = imaplib.IMAP4_SSL(host, port, timeout=TIMEOUT) if ssl else imaplib.IMAP4(host, port, timeout=TIMEOUT)
    try:
        if not ssl:
            try:
                m.starttls()
            except Exception:                                # noqa: BLE001 — STARTTLS 없는 서버도 있다
                pass
        m.login(acc.login or acc.address, password)
        if folder:
            typ, _ = m.select(f'"{folder}"', readonly=False)
            if typ != "OK":
                raise RuntimeError(f"메일함을 열지 못했습니다: {folder}")
        yield m
    finally:
        try:
            m.logout()
        except Exception:                                    # noqa: BLE001
            pass


# ── 읽기 ──────────────────────────────────────────────────────────────
_KIND = {"\\Inbox": "inbox", "\\Sent": "sent", "\\Drafts": "drafts",
         "\\Trash": "trash", "\\Junk": "junk", "\\Archive": "archive"}
_NAME_KIND = {"inbox": "inbox", "sent": "sent", "sent items": "sent", "sent messages": "sent",
              "drafts": "drafts", "trash": "trash", "deleted items": "trash",
              "junk": "junk", "spam": "junk", "archive": "archive"}
_KIND_LABEL = {"inbox": "받은편지함", "sent": "보낸편지함", "drafts": "임시보관함",
               "trash": "휴지통", "junk": "스팸함", "archive": "보관함"}
_ORDER = ["inbox", "sent", "drafts", "archive", "junk", "trash"]

_LIST_RE = re.compile(rb'\((?P<flags>[^)]*)\) "(?P<delim>[^"]*)" (?P<name>.+)')


def folders(acc, cfg: dict, password: str) -> list[dict]:
    with imap(acc, cfg, password) as m:
        typ, rows = m.list()
        if typ != "OK":
            return [{"path": "INBOX", "label": "받은편지함", "kind": "inbox"}]
        out: list[dict] = []
        for row in rows or []:
            mt = _LIST_RE.match(row if isinstance(row, bytes) else bytes(row))
            if not mt:
                continue
            flags = mt.group("flags").decode(errors="ignore")
            if "\\Noselect" in flags:
                continue
            name = mt.group("name").decode(errors="ignore").strip().strip('"')
            path = _mutf7(name)
            kind = next((v for k, v in _KIND.items() if k in flags), "")
            kind = kind or _NAME_KIND.get(path.split("/")[-1].lower(), "")
            if path.upper() == "INBOX":
                kind = "inbox"
            out.append({"path": path, "label": _KIND_LABEL.get(kind) or path.split("/")[-1], "kind": kind})
        # 아는 메일함을 앞에, 나머지는 이름순 — 화면 왼쪽 목록 순서가 그대로 된다
        out.sort(key=lambda f: (_ORDER.index(f["kind"]) if f["kind"] in _ORDER else 99, f["label"]))
        return out or [{"path": "INBOX", "label": "받은편지함", "kind": "inbox"}]


_HEAD = "(UID FLAGS RFC822.SIZE BODY.PEEK[HEADER.FIELDS (SUBJECT FROM TO DATE)])"
_UID_RE = re.compile(rb"UID (\d+)")
_SIZE_RE = re.compile(rb"RFC822\.SIZE (\d+)")
_FLAG_RE = re.compile(rb"FLAGS \(([^)]*)\)")


def _iso(raw: str | None) -> str:
    try:
        d = parsedate_to_datetime(raw or "")
        return (d.astimezone(KST) if d.tzinfo else d.replace(tzinfo=KST)).isoformat(timespec="minutes")
    except Exception:                                        # noqa: BLE001
        return ""


def list_messages(acc, cfg: dict, password: str, folder: str, limit: int, offset: int, query: str) -> list[dict]:
    with imap(acc, cfg, password, folder) as m:
        if query.strip():
            try:
                typ, data = m.uid("SEARCH", "CHARSET", "UTF-8", "TEXT", f'"{query.strip()}"'.encode())
            except Exception:                                # noqa: BLE001 — 검색을 못 하는 서버는 전체로
                typ, data = m.uid("SEARCH", None, "ALL")
        else:
            typ, data = m.uid("SEARCH", None, "ALL")
        if typ != "OK":
            return []
        uids = (data[0] or b"").split()
        uids.reverse()                                       # 최신이 위
        page = uids[offset:offset + limit]
        if not page:
            return []
        typ, rows = m.uid("FETCH", b",".join(page), _HEAD)
        if typ != "OK":
            return []
        out: dict[str, dict] = {}
        for row in rows or []:
            if not isinstance(row, tuple) or len(row) < 2:
                continue
            meta, raw = row[0], row[1]
            uid_m, size_m, flag_m = _UID_RE.search(meta), _SIZE_RE.search(meta), _FLAG_RE.search(meta)
            if not uid_m:
                continue
            flags = (flag_m.group(1).decode(errors="ignore") if flag_m else "")
            msg = message_from_bytes(raw)
            name, addr = _first_addr(msg.get("From"))
            out[uid_m.group(1).decode()] = {
                "uid": uid_m.group(1).decode(),
                "subject": _hdr(msg.get("Subject")) or "(제목 없음)",
                "from_name": name or addr, "from_addr": addr,
                "to": _addr_list(msg.get("To")),
                "date": _iso(msg.get("Date")),
                "size": int(size_m.group(1)) if size_m else 0,
                "seen": "\\Seen" in flags, "flagged": "\\Flagged" in flags,
                "answered": "\\Answered" in flags,
                "attachments": 0, "preview": "",
            }
        return [out[u.decode()] for u in page if u.decode() in out]


def _bodies(msg) -> tuple[str, str, list[dict]]:
    """본문(html·text)과 첨부 목록. 첨부는 순서대로 번호를 매겨 내려받을 때 쓴다."""
    html, text, files = "", "", []
    idx = 0
    for part in msg.walk():
        if part.get_content_maintype() == "multipart":
            continue
        name = _hdr(part.get_filename())
        disp = (part.get("Content-Disposition") or "").lower()
        payload = part.get_payload(decode=True) or b""
        if name or "attachment" in disp:
            files.append({"index": idx, "name": name or f"첨부{idx + 1}",
                          "size": len(payload), "mime": part.get_content_type()})
            idx += 1
            continue
        idx += 1
        charset = part.get_content_charset() or "utf-8"
        try:
            body = payload.decode(charset, errors="replace")
        except LookupError:
            body = payload.decode("utf-8", errors="replace")
        if part.get_content_type() == "text/html" and not html:
            html = body
        elif part.get_content_type() == "text/plain" and not text:
            text = body
    return html, text, files


def get_message(acc, cfg: dict, password: str, folder: str, uid: str) -> dict:
    with imap(acc, cfg, password, folder) as m:
        typ, rows = m.uid("FETCH", uid.encode(), "(UID FLAGS RFC822.SIZE BODY.PEEK[])")
        if typ != "OK" or not rows or not isinstance(rows[0], tuple):
            raise RuntimeError("메일을 찾지 못했습니다")
        meta, raw = rows[0][0], rows[0][1]
        flags = (_FLAG_RE.search(meta).group(1).decode(errors="ignore") if _FLAG_RE.search(meta) else "")
        size_m = _SIZE_RE.search(meta)
        msg = message_from_bytes(raw)
        html, text, files = _bodies(msg)
        name, addr = _first_addr(msg.get("From"))
        return {
            "uid": uid,
            "subject": _hdr(msg.get("Subject")) or "(제목 없음)",
            "from_name": name or addr, "from_addr": addr,
            "to": _addr_list(msg.get("To")), "cc": _addr_list(msg.get("Cc")),
            "date": _iso(msg.get("Date")),
            "size": int(size_m.group(1)) if size_m else len(raw),
            "seen": "\\Seen" in flags, "flagged": "\\Flagged" in flags,
            "answered": "\\Answered" in flags,
            "attachments": len(files), "preview": "",
            "html": html, "text": text, "files": files,
            "message_id": msg.get("Message-ID") or "",
        }


def attachment(acc, cfg: dict, password: str, folder: str, uid: str, index: int) -> tuple[str, str, bytes]:
    with imap(acc, cfg, password, folder) as m:
        typ, rows = m.uid("FETCH", uid.encode(), "(BODY.PEEK[])")
        if typ != "OK" or not rows or not isinstance(rows[0], tuple):
            raise RuntimeError("메일을 찾지 못했습니다")
        msg = message_from_bytes(rows[0][1])
        i = 0
        for part in msg.walk():
            if part.get_content_maintype() == "multipart":
                continue
            name = _hdr(part.get_filename())
            disp = (part.get("Content-Disposition") or "").lower()
            if name or "attachment" in disp:
                if i == index:
                    return (name or f"첨부{index + 1}", part.get_content_type(), part.get_payload(decode=True) or b"")
                i += 1
            else:
                i += 1
        raise RuntimeError("첨부를 찾지 못했습니다")


def set_flags(acc, cfg: dict, password: str, folder: str, uid: str, seen: bool | None, flagged: bool | None) -> None:
    with imap(acc, cfg, password, folder) as m:
        for flag, want in (("\\Seen", seen), ("\\Flagged", flagged)):
            if want is None:
                continue
            m.uid("STORE", uid.encode(), "+FLAGS" if want else "-FLAGS", f"({flag})")


# ── 보내기 ────────────────────────────────────────────────────────────
def send(acc, cfg: dict, password: str, *, to: str, cc: str, subject: str,
         html: str, text: str, in_reply_to: str, sender_name: str) -> str:
    host, port, tls = smtp_conf(acc, cfg)
    if not host:
        raise RuntimeError("메일 서버(SMTP)가 설정되지 않았습니다 — 관리자 › 환경설정 › 메일서버")
    msg = EmailMessage()
    msg["From"] = formataddr((sender_name or acc.label or "", acc.address))
    msg["To"] = to
    if cc:
        msg["Cc"] = cc
    msg["Subject"] = subject or "(제목 없음)"
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid()
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = in_reply_to
    msg.set_content(text or "")
    if html:
        msg.add_alternative(html, subtype="html")
    rcpt = [a for _, a in getaddresses([to, cc]) if a]
    if not rcpt:
        raise RuntimeError("받는 사람이 없습니다")
    if tls == "ssl":
        s = smtplib.SMTP_SSL(host, port, timeout=TIMEOUT)
    else:
        s = smtplib.SMTP(host, port, timeout=TIMEOUT)
    try:
        if tls == "starttls":
            s.starttls()
        s.login(acc.login or acc.address, password)
        s.send_message(msg, from_addr=acc.address, to_addrs=rcpt)
    finally:
        try:
            s.quit()
        except Exception:                                    # noqa: BLE001
            pass
    return msg["Message-ID"]


def check(acc, cfg: dict, password: str) -> tuple[str, str]:
    """계정 추가 화면의 '연결 확인' — 어디가 막혔는지 한 줄씩 돌려준다."""
    imap_msg, smtp_msg = "", ""
    try:
        with imap(acc, cfg, password) as m:
            m.select("INBOX", readonly=True)
        imap_msg = "정상"
    except Exception as e:                                   # noqa: BLE001
        imap_msg = str(e) or e.__class__.__name__
    host, port, tls = smtp_conf(acc, cfg)
    try:
        if not host:
            raise RuntimeError("SMTP 호스트가 설정되지 않았습니다")
        s = smtplib.SMTP_SSL(host, port, timeout=TIMEOUT) if tls == "ssl" else smtplib.SMTP(host, port, timeout=TIMEOUT)
        try:
            if tls == "starttls":
                s.starttls()
            s.login(acc.login or acc.address, password)
        finally:
            try:
                s.quit()
            except Exception:                                # noqa: BLE001
                pass
        smtp_msg = "정상"
    except Exception as e:                                   # noqa: BLE001
        smtp_msg = str(e) or e.__class__.__name__
    return imap_msg, smtp_msg
