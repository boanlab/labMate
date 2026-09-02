"""연구비(funds) 도메인 관리자 편집형 마스터데이터 기본값."""
from __future__ import annotations

from typing import Any

DEFAULTS: dict[str, Any] = {
    # 비목(name)+세목(subs). 예산 표준 7비목
    "budget_types": [
        {"name": "인건비", "subs": []},
        {"name": "학생인건비", "subs": []},
        {"name": "장비비", "subs": []},
        {"name": "재료비", "subs": []},
        {"name": "연구활동비", "subs": ["국내여비", "국외여비", "회의비", "학회/세미나참가비", "소프트웨어활용비", "연구환경유지비", "논문게재료", "인쇄비"]},
        {"name": "연구수당", "subs": []},
        {"name": "간접비", "subs": []},
    ],
    # 학력등급별 월 기준단가(원)
    "grade_rates": {"교수": 0, "박사과정": 3000000, "석사과정": 2200000, "학사과정": 1300000},
    # 집행 결재 사용 여부.
    #  True  — 작성중 → 상신(증빙 필수) → 승인 시 예산 차감. 연구비 감사에 대비한 기본값.
    #  False — 등록 즉시 집행 확정(교수가 직접 정리하는 소규모 연구실용)
    "expense_approval": True,
}
