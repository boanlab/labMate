"""resource 도메인 관리자 편집형 마스터데이터 기본값."""
from __future__ import annotations

from typing import Any

DEFAULTS: dict[str, Any] = {
    "booking_resources": ["세미나실"],
    "rack_max_u": 42,
    "device_types": ["CPU서버", "GPU서버", "스토리지서버", "VPN라우터", "1G스위치", "10G스위치", "KVM", "기타"],
    "asset_types": ["대학자산", "산학협력단", "연구실", "기타"],
    "video_cats": ["세미나", "튜토리얼", "강연", "기타"],
}
