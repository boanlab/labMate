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
    "nudge": "밀린 일 독려",
    "philosophy": "지도교수 철학 인터뷰",
    "chat": "상시 멘토 대화",
}

DEFAULTS: dict[str, Any] = {
    "ai_enabled": False,                       # 전체 스위치
    # 기본 모델 — 같은 예시 글을 여러 모델에 돌려 본 결과로 고른다(관리자 화면의 '모델 비교').
    #   glm-5.3-flash  $0.0006/건 · 32~55초 · 지침 위반을 먼저 짚고 빈칸(___)을 정확히 씀
    #   gpt-oss-120b   $0.0004/건 ·  5~23초 · 빠르지만 예시 수치를 지어내고 이모지를 씀 → 제외
    #   sonnet-5       $0.0099/건 ·     9초 · 품질 최상, 대신 16배 비쌈
    # 월 $5 한도면 glm 으로 약 7,000건(학생 10명 기준 1인당 월 700건).
    # 응답이 빨라야 하면 관리자 화면에서 sonnet-5 로 바꾼다(한도 내 약 500건).
    "ai_model": "z-ai/glm-5.3-flash",
    "ai_features": {k: False for k in FEATURES},
    "ai_roles": ["prof", "phd", "master", "under"],   # 사용 허용 역할(staff·admin 제외)
    "ai_monthly_cost_cap_usd": 5,             # 월 상한(0이면 무제한)
    # 출력 상한 — 1200 에서는 지적 3가지 + 고쳐 쓴 예시를 담다가 끊긴다(실측).
    # 추론형 모델은 '생각'도 이 예산에서 쓰므로 답이 짧은 기능일수록 더 넉넉해야 한다
    # (glm 은 독려 1건에 사고 포함 2,365토큰을 썼다). 기능별 하한은 routers.BUDGET.
    "ai_max_output_tokens": 2000,
}
