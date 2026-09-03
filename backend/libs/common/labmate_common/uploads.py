"""첨부 저장 — 형식·크기 검사 후 uuid 이름으로 보관.

첨부는 앱과 같은 출처(/uploads/...)에서 서빙되므로 .html·.svg 를 그대로 받으면
저장형 XSS 가 된다. 두 겹으로 막는다.

  1) 여기 — 허용 목록 밖 확장자는 거부
  2) gateway — nosniff·CSP 부착, 이미지·PDF 외에는 Content-Disposition: attachment
"""
from __future__ import annotations

import os
import re
import unicodedata
import uuid

from fastapi import HTTPException, UploadFile, status

from .config import settings

# 연구실에서 실제로 주고받는 형식만 남긴다. 새 형식이 필요하면 여기에 추가한다.
ALLOWED_EXT: frozenset[str] = frozenset({
    # 문서
    ".pdf", ".hwp", ".hwpx", ".doc", ".docx", ".xls", ".xlsx", ".xlsm",
    ".ppt", ".pptx", ".odt", ".ods", ".odp", ".rtf", ".txt", ".md", ".csv", ".tsv",
    # 이미지
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".heic", ".heif", ".tif", ".tiff",
    # 압축 — 코드·데이터 묶음은 압축해서 올린다
    ".zip", ".7z", ".tar", ".gz", ".tgz", ".bz2", ".xz",
    # 기타
    ".json", ".yaml", ".yml", ".bib", ".log",
})

# 브라우저가 열어도 되는(=인라인 표시) 형식. 나머지는 gateway 가 내려받게 한다.
INLINE_EXT: frozenset[str] = frozenset({
    ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
})

# 로고 같은 공개 이미지에만 쓰는 좁은 목록 — svg 는 스크립트를 품을 수 있어 뺀다
IMAGE_EXT: frozenset[str] = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp"})

_CHUNK = 1 << 20  # 1MB


def _ext_of(filename: str) -> str:
    return os.path.splitext(filename or "")[1].lower()


def safe_display_name(filename: str) -> str:
    """목록에 보여 줄 이름 — 경로·제어문자를 걷어내고 길이를 자른다."""
    name = unicodedata.normalize("NFC", filename or "첨부파일")
    name = name.replace("\\", "/").split("/")[-1]            # 경로 조각 제거
    name = re.sub(r"[\x00-\x1f\x7f]", "", name).strip()      # 제어문자 제거
    return (name or "첨부파일")[:160]


def _check(filename: str, allowed: frozenset[str]) -> str:
    ext = _ext_of(filename)
    if not ext:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"확장자가 없는 파일은 올릴 수 없습니다: {safe_display_name(filename)}")
    if ext not in allowed:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"올릴 수 없는 형식입니다({ext}). 문서·이미지·압축 파일만 첨부할 수 있고, "
            f"그 밖의 파일은 압축(zip)해서 올려 주세요.",
        )
    return ext


async def _write_capped(src: UploadFile, path: str, max_bytes: int) -> int:
    """상한을 넘으면 즉시 끊고 쓰다 만 파일을 지운다(메모리에 통째로 올리지 않는다)."""
    written = 0
    try:
        with open(path, "wb") as w:
            while chunk := await src.read(_CHUNK):
                written += len(chunk)
                if written > max_bytes:
                    raise HTTPException(
                        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        f"파일이 너무 큽니다. 한 개당 {max_bytes // (1 << 20)}MB 까지 올릴 수 있습니다.",
                    )
                w.write(chunk)
    except BaseException:
        if os.path.exists(path):
            os.remove(path)
        raise
    return written


async def save_uploads(
    files: list[UploadFile],
    *,
    dest_dir: str,
    url_prefix: str,
    allowed: frozenset[str] = ALLOWED_EXT,
    max_bytes: int | None = None,
) -> list[dict[str, str]]:
    """검사 후 저장 → [{name, url}].

    저장 이름은 uuid + 확장자. 원본 이름은 표시용으로만 쓰고 경로에 넣지 않는다
    (경로 탈출·중복 방지).
    """
    cap = max_bytes if max_bytes is not None else settings.max_upload_mb * (1 << 20)
    if not files:
        return []
    exts = [_check(f.filename or "", allowed) for f in files]      # 하나라도 어긋나면 저장 전에 막는다
    os.makedirs(dest_dir, exist_ok=True)
    out: list[dict[str, str]] = []
    try:
        for f, ext in zip(files, exts):
            stored = f"{uuid.uuid4().hex}{ext}"
            await _write_capped(f, os.path.join(dest_dir, stored), cap)
            out.append({"name": safe_display_name(f.filename or ""), "url": f"{url_prefix.rstrip('/')}/{stored}"})
    except BaseException:
        for done in out:                                            # 일부만 올라간 채로 남기지 않는다
            p = os.path.join(dest_dir, done["url"].rsplit("/", 1)[-1])
            if os.path.exists(p):
                os.remove(p)
        raise
    return out
