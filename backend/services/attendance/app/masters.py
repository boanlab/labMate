"""근태(attendance) 도메인 마스터데이터 기본값."""
from __future__ import annotations

from typing import Any

DEFAULTS: dict[str, Any] = {
    # 휴가 종류: deduct=연차잔여 차감 여부, fraction=일수 환산(1/0.5/0.25)
    "leave_types": [
        {"name": "연차", "deduct": True, "fraction": 1.0},
        {"name": "반차", "deduct": True, "fraction": 0.5},
        {"name": "병가", "deduct": False, "fraction": 1.0},
        {"name": "공가", "deduct": False, "fraction": 1.0},
    ],
    # 연 부여 연차 기본 일수
    "annual_leave_default": 15,
    # 근태 상태 코드
    "attendance_states": ["업무중", "자리비움", "출장", "휴가", "퇴근", "미체크"],
}
