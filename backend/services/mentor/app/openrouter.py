"""OpenRouter 호출 — 키는 서버에만 두고 프론트로 내보내지 않는다."""
from __future__ import annotations

from typing import Any

import httpx

BASE = "https://openrouter.ai/api/v1"
TIMEOUT = httpx.Timeout(60.0, connect=10.0)


class MentorError(Exception):
    """사용자에게 그대로 보여줄 한국어 사유."""


def _headers(key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "X-Title": "LabMate",
    }


def _explain(status: int, body: str) -> str:
    if status == 401:
        return "OpenRouter 키가 올바르지 않습니다. 관리자에게 키 재설정을 요청하세요."
    if status == 402:
        return "OpenRouter 잔액이 부족합니다."
    if status == 429:
        return "요청이 몰려 잠시 처리할 수 없습니다. 잠시 후 다시 시도해 주세요."
    if status >= 500:
        return "OpenRouter 쪽 오류입니다. 잠시 후 다시 시도해 주세요."
    return f"요청이 거부되었습니다({status}). {body[:200]}"


async def chat(key: str, model: str, messages: list[dict[str, str]], max_tokens: int) -> dict[str, Any]:
    """응답 본문과 사용량을 함께 돌려준다."""
    payload = {"model": model, "messages": messages, "max_tokens": max_tokens}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.post(f"{BASE}/chat/completions", headers=_headers(key), json=payload)
    except httpx.TimeoutException:
        raise MentorError("응답이 너무 오래 걸려 중단했습니다. 잠시 후 다시 시도해 주세요.")
    except httpx.HTTPError:
        raise MentorError("OpenRouter 에 연결하지 못했습니다. 네트워크 설정을 확인하세요.")
    if r.status_code >= 400:
        raise MentorError(_explain(r.status_code, r.text))
    data = r.json()
    usage = data.get("usage") or {}
    choice = (data.get("choices") or [{}])[0]
    return {
        "text": (choice.get("message") or {}).get("content", "").strip(),
        "model": data.get("model", model),
        "prompt_tokens": int(usage.get("prompt_tokens") or 0),
        "completion_tokens": int(usage.get("completion_tokens") or 0),
        "cost_usd": float(usage.get("cost") or 0),
    }


async def check_key(key: str) -> dict[str, Any]:
    """연결 테스트 — 키 유효성과 남은 크레딧을 확인한다."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(f"{BASE}/key", headers=_headers(key))
    except httpx.HTTPError:
        raise MentorError("OpenRouter 에 연결하지 못했습니다. 네트워크 설정을 확인하세요.")
    if r.status_code >= 400:
        raise MentorError(_explain(r.status_code, r.text))
    d = (r.json() or {}).get("data") or {}
    return {"label": d.get("label", ""), "usage_usd": d.get("usage"), "limit_usd": d.get("limit")}


async def models(key: str) -> list[dict[str, str]]:
    """모델 목록 — 관리자 화면 드롭다운용."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(f"{BASE}/models", headers=_headers(key))
    except httpx.HTTPError:
        raise MentorError("OpenRouter 에 연결하지 못했습니다.")
    if r.status_code >= 400:
        raise MentorError(_explain(r.status_code, r.text))
    out = []
    for m in (r.json() or {}).get("data") or []:
        mid = m.get("id")
        if mid:
            out.append({"id": mid, "name": m.get("name") or mid})
    return sorted(out, key=lambda x: x["id"])
