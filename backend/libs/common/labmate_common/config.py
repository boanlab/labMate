"""환경변수 기반 공통 설정."""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    service_name: str = "service"
    env: str = "development"

    database_url: str = "postgresql+psycopg://labmate:labmate@localhost:5432/labmate"
    redis_url: str = "redis://localhost:6379/0"

    # JWT — 모든 서비스가 동일한 값을 공유해야 토큰 검증이 된다.
    jwt_secret: str = "dev-insecure-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    refresh_token_days: int = 14
    # 첨부 다운로드 전용 쿠키의 수명(시간). 접근 토큰보다 길게 둬야 화면을 오래 열어 둔
    # 사용자가 첨부를 눌렀을 때 갑자기 막히지 않는다. 로그아웃하면 즉시 폐기된다.
    download_token_hours: int = 12

    upload_dir: str = "/data/uploads"
    # 첨부 한 개당 상한(MB). gateway 의 client_max_body_size 보다 작아야 의미가 있다.
    max_upload_mb: int = 30

    # Web Push(VAPID) — 모든 서비스가 동일 키 공유. 미설정 시 푸시 비활성(인앱 알림은 정상).
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:admin@labmate.local"

    # 첫 배포 자동 관리자 시드(.env의 ADMIN_EMAIL/ADMIN_PASSWORD)
    admin_email: str = "labmate@kloud.zone"
    admin_password: str = "labmate123"

    @property
    def is_prod(self) -> bool:
        return self.env.lower() in ("production", "prod")


settings = Settings()
