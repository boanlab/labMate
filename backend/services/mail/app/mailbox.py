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
def imap(acc, cfg: dict, password: str, folder: str = "", timeout: int = TIMEOUT):
    host, port, ssl = imap_conf(acc, cfg)
    if not host:
        raise RuntimeError("메일 서버(IMAP)가 설정되지 않았습니다 — 관리자 › 환경설정 › 메일서버")
    m = imaplib.IMAP4_SSL(host, port, timeout=timeout) if ssl else imaplib.IMAP4(host, port, timeout=timeout)
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


_UNSEEN_RE = re.compile(rb"UNSEEN (\d+)")


def _unseen(m, path: str) -> int:
    """그 메일함의 안 읽은 통수. STATUS 는 메일함을 열지 않아 가볍다."""
    try:
        typ, data = m.status(f'"{path}"', "(UNSEEN)")
        if typ != "OK" or not data:
            return 0
        hit = _UNSEEN_RE.search(data[0] if isinstance(data[0], bytes) else bytes(data[0]))
        return int(hit.group(1)) if hit else 0
    except Exception:                                        # noqa: BLE001 — 한 메일함이 막혀도 목록은 나와야 한다
        return 0


def folders(acc, cfg: dict, password: str) -> list[dict]:
    with imap(acc, cfg, password) as m:
        typ, rows = m.list()
        if typ != "OK":
            return [{"path": "INBOX", "label": "받은편지함", "kind": "inbox", "unread": 0}]
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
            out.append({"path": path, "label": _KIND_LABEL.get(kind) or path.split("/")[-1],
                        "kind": kind, "unread": 0})
        # 안 읽은 통수는 접속 하나로 몰아서 묻는다 — 메일함마다 새로 접속하면 화면이 느려진다.
        # 보낸편지함·휴지통의 '안 읽음'은 뜻이 없어 세지 않는다.
        for f in out:
            if f["kind"] not in ("sent", "trash", "drafts"):
                f["unread"] = _unseen(m, f["path"])
        # 아는 메일함을 앞에, 나머지는 이름순 — 화면 왼쪽 목록 순서가 그대로 된다
        out.sort(key=lambda f: (_ORDER.index(f["kind"]) if f["kind"] in _ORDER else 99, f["label"]))
        return out or [{"path": "INBOX", "label": "받은편지함", "kind": "inbox", "unread": 0}]


# 목록 한 줄에 필요한 것만 — 헤더, 크기, 플래그, 구조(첨부 유무).
# 본문 앞머리도 받아 봤지만 서버마다 돌려주는 조각이 달라(전송 헤더가 섞여 오기도 한다)
# 쓸 만한 미리보기가 되지 못했다. 목록에는 누가·언제·제목만 둔다.
_HEAD = "(UID FLAGS RFC822.SIZE BODYSTRUCTURE BODY.PEEK[HEADER.FIELDS (SUBJECT FROM TO DATE)])"
_UID_RE = re.compile(rb"UID (\d+)")
_SIZE_RE = re.compile(rb"RFC822\.SIZE (\d+)")
_FLAG_RE = re.compile(rb"FLAGS \(([^)]*)\)")


def _attach_count(bodystructure: bytes) -> int:
    """첨부 개수 — BODYSTRUCTURE 를 파싱하지 않고 disposition 만 센다.

    목록에 클립 표시를 붙이는 용도라 정확한 파싱까지는 필요 없다. 실제 첨부 목록은
    메일을 열 때 본문을 받아 제대로 훑는다.
    """
    return bodystructure.lower().count(b'"attachment"')


def _iso(raw: str | None) -> str:
    try:
        d = parsedate_to_datetime(raw or "")
        return (d.astimezone(KST) if d.tzinfo else d.replace(tzinfo=KST)).isoformat(timespec="minutes")
    except Exception:                                        # noqa: BLE001
        return ""


def list_messages(acc, cfg: dict, password: str, folder: str, limit: int, offset: int, query: str) -> list[dict]:
    with imap(acc, cfg, password, folder) as m:
        # 지운 표시가 붙은 메일은 빼고 센다. 서버가 아직 비우지 않았을 뿐 이미 치운 메일이라,
        # 목록에 남겨 두면 눌렀을 때 "메일을 찾지 못했습니다"가 된다.
        if query.strip():
            try:
                typ, data = m.uid("SEARCH", "CHARSET", "UTF-8", "NOT", "DELETED", "TEXT", f'"{query.strip()}"'.encode())
            except Exception:                                # noqa: BLE001 — 검색을 못 하는 서버는 전체로
                typ, data = m.uid("SEARCH", None, "NOT", "DELETED")
        else:
            typ, data = m.uid("SEARCH", None, "NOT", "DELETED")
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
        # 서버는 한 메일의 여러 조각(헤더·본문 앞머리)을 따로 보내므로 UID 로 다시 모은다.
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
                "attachments": _attach_count(meta), "preview": "",
            }
        return [out[u.decode()] for u in page if u.decode() in out]


# 잘못 읽었을 때 쏟아지는 글자들(UTF-8 을 라틴으로 읽으면 이 대역이 가득 찬다).
# 한국어·영어 메일에 라틴 보조 문자가 이렇게 많을 일은 없다.
_LATIN1 = re.compile(r"[\u0080-\u00ff]")
# 메일에서 실제로 만나는 순서대로. 선언된 charset 을 먼저 믿되, 결과가 이상하면 다음을 본다.
_CHARSETS = ("utf-8", "cp949", "euc-kr", "iso-8859-1")


def _garble(text: str) -> float:
    """0 에 가까울수록 제대로 읽힌 글. 깨진 글은 라틴 보조 문자로 뒤덮인다."""
    return len(_LATIN1.findall(text)) / max(len(text), 1)


def _decode(payload: bytes, charset: str | None) -> str:
    """본문 글자 풀기.

    메일 헤더가 적어 둔 charset 이 틀리는 일이 흔하다(보내는 쪽이 기본값을 그대로 두거나,
    중계 서버가 바꿔 적는다). 선언을 먼저 믿되, 읽어 놓고 보니 깨졌으면 다른 것으로 읽는다.
    """
    if not payload:
        return ""
    tried: list[tuple[float, str]] = []
    for cs in ([charset] if charset else []) + list(_CHARSETS):
        if not cs:
            continue
        try:
            text = payload.decode(cs)
        except (LookupError, UnicodeDecodeError, ValueError):
            continue
        score = _garble(text)
        if score < 0.02:                                     # 충분히 깨끗하면 더 볼 것 없다
            return text
        tried.append((score, text))
    if tried:
        return min(tried, key=lambda x: x[0])[1]
    return payload.decode("utf-8", errors="replace")


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
        body = _decode(payload, part.get_content_charset())
        if part.get_content_type() == "text/html" and not html:
            html = body
        elif part.get_content_type() == "text/plain" and not text:
            text = body
    return html, text, files


def get_message(acc, cfg: dict, password: str, folder: str, uid: str) -> dict:
    with imap(acc, cfg, password, folder) as m:
        typ, rows = m.uid("FETCH", uid.encode(), "(UID FLAGS RFC822.SIZE BODY.PEEK[])")
        if typ != "OK" or not rows or not isinstance(rows[0], tuple):
            raise RuntimeError("이 메일은 더 이상 여기에 없습니다 — 옮겨졌거나 지워졌습니다")
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


def move(acc, cfg: dict, password: str, folder: str, uid: str, dest: str) -> None:
    """메일을 다른 메일함으로 옮긴다(보관·삭제·스팸 신고).

    MOVE 를 아는 서버면 한 번에, 모르는 서버면 복사 뒤 원본에 삭제 표시를 하고 비운다.
    """
    with imap(acc, cfg, password, folder) as m:
        if "MOVE" in (m.capabilities or ()):
            typ, _ = m.uid("MOVE", uid.encode(), f'"{dest}"')
            if typ == "OK":
                return
        typ, _ = m.uid("COPY", uid.encode(), f'"{dest}"')
        if typ != "OK":
            raise RuntimeError(f"옮기지 못했습니다: {dest}")
        m.uid("STORE", uid.encode(), "+FLAGS", "(\\Deleted)")
        try:
            # UID EXPUNGE 가 있으면 그 메일만 비운다(남의 삭제 표시까지 건드리지 않도록).
            if "UIDPLUS" in (m.capabilities or ()):
                m.uid("EXPUNGE", uid.encode())
            else:
                m.expunge()
        except Exception:                                    # noqa: BLE001 — 비우기를 막는 서버도 있다
            pass


def purge(acc, cfg: dict, password: str, folder: str, uid: str) -> None:
    """완전 삭제 — 휴지통에서 한 번 더 지우는 자리. 되돌릴 수 없다."""
    with imap(acc, cfg, password, folder) as m:
        m.uid("STORE", uid.encode(), "+FLAGS", "(\\Deleted)")
        if "UIDPLUS" in (m.capabilities or ()):
            m.uid("EXPUNGE", uid.encode())
        else:
            m.expunge()


def set_flags(acc, cfg: dict, password: str, folder: str, uid: str, seen: bool | None, flagged: bool | None) -> None:
    with imap(acc, cfg, password, folder) as m:
        for flag, want in (("\\Seen", seen), ("\\Flagged", flagged)):
            if want is None:
                continue
            m.uid("STORE", uid.encode(), "+FLAGS" if want else "-FLAGS", f"({flag})")


def contacts(acc, cfg: dict, password: str, scan: int = 200) -> list[dict]:
    """최근 주고받은 주소록 — 받은편지함의 보낸 사람, 보낸편지함의 받는 사람.

    주소록을 따로 관리하게 하면 아무도 채워 넣지 않는다. 이미 주고받은 메일이 곧 주소록이다.
    """
    seen: dict[str, dict] = {}
    with imap(acc, cfg, password) as m:
        for folder, fields in (("INBOX", "FROM"), (_sent_path(m), "TO CC")):
            if not folder:
                continue
            typ, _ = m.select(f'"{folder}"', readonly=True)
            if typ != "OK":
                continue
            typ, data = m.uid("SEARCH", None, "ALL")
            if typ != "OK":
                continue
            uids = (data[0] or b"").split()[-scan:]
            if not uids:
                continue
            typ, rows = m.uid("FETCH", b",".join(uids), f"(BODY.PEEK[HEADER.FIELDS ({fields})])")
            if typ != "OK":
                continue
            for row in rows or []:
                if not isinstance(row, tuple) or len(row) < 2:
                    continue
                msg = message_from_bytes(row[1])
                raw = ", ".join(v for v in (msg.get("From"), msg.get("To"), msg.get("Cc")) if v)
                for name, addr in getaddresses([raw]):
                    addr = (addr or "").strip().lower()
                    if not addr or "@" not in addr or addr == acc.address.lower():
                        continue
                    got = seen.get(addr)
                    nice = _hdr(name).strip()
                    if not got:
                        seen[addr] = {"name": nice, "address": addr, "n": 1}
                    else:
                        got["n"] += 1
                        if nice and not got["name"]:
                            got["name"] = nice
    # 자주 주고받은 사람이 위로 — 목록에서 먼저 눈에 띄어야 고르기 쉽다
    return sorted(seen.values(), key=lambda c: (-c["n"], c["address"]))


def _sent_path(m) -> str:
    """보낸편지함 경로 찾기 — 서버마다 이름이 다르다(Sent·보낸편지함·Sent Messages)."""
    try:
        typ, rows = m.list()
        if typ != "OK":
            return ""
        for row in rows or []:
            mt = _LIST_RE.match(row if isinstance(row, bytes) else bytes(row))
            if not mt:
                continue
            flags = mt.group("flags").decode(errors="ignore")
            name = _mutf7(mt.group("name").decode(errors="ignore").strip().strip('"'))
            if "\\Sent" in flags or _NAME_KIND.get(name.split("/")[-1].lower()) == "sent":
                return name
    except Exception:                                        # noqa: BLE001
        pass
    return ""


def unseen_briefs(acc, cfg: dict, password: str, limit: int = 5, timeout: int = 8) -> list[dict]:
    """안 읽은 메일 몇 통(알림용). 종이 45초마다 묻는 자리라 짧은 제한시간을 쓴다."""
    with imap(acc, cfg, password, "INBOX", timeout=timeout) as m:
        typ, data = m.uid("SEARCH", None, "UNSEEN", "NOT", "DELETED")
        if typ != "OK":
            return []
        uids = (data[0] or b"").split()
        uids.reverse()
        page = uids[:limit]
        if not page:
            return []
        typ, rows = m.uid("FETCH", b",".join(page),
                          "(UID BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)])")
        if typ != "OK":
            return []
        out = []
        for row in rows or []:
            if not isinstance(row, tuple) or len(row) < 2:
                continue
            uid_m = _UID_RE.search(row[0])
            if not uid_m:
                continue
            msg = message_from_bytes(row[1])
            name, addr = _first_addr(msg.get("From"))
            out.append({"uid": uid_m.group(1).decode(), "from_name": name or addr,
                        "subject": _hdr(msg.get("Subject")) or "(제목 없음)", "date": _iso(msg.get("Date"))})
        return out


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
