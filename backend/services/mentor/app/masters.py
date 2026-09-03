"""AI 멘토 설정 — 관리자 편집(마스터데이터).

API 키는 여기 두지 않는다. /config 는 로그인한 누구나 읽을 수 있어서
학생이 키를 조회할 수 있게 된다. 키는 mentor_secrets 테이블에 암호화 보관한다.
"""
from __future__ import annotations

from typing import Any

# 기능 키 → 화면 이름. 기본은 전부 꺼짐 — 연구 내용이 외부로 나가므로 관리자가 켠다.
FEATURES: dict[str, str] = {
    "meeting": "회의록 점검",
    "note": "연구노트 점검",
    "task": "세부업무 점검",
    "report": "보고서·제안서 점검",
    "schedule": "일정 마일스톤 제안",
    "review": "주간 회고 초안",
    "chat": "상시 멘토 대화",
}

DEFAULTS: dict[str, Any] = {
    "ai_enabled": False,                       # 전체 스위치
    "ai_model": "anthropic/claude-sonnet-4.6",
    "ai_features": {k: False for k in FEATURES},
    "ai_roles": ["prof", "phd", "master", "under"],   # 사용 허용 역할(staff·admin 제외)
    "ai_monthly_cost_cap_usd": 20,             # 월 상한(0이면 무제한)
    "ai_max_output_tokens": 1200,
}
