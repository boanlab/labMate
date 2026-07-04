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

    upload_dir: str = "/data/uploads"

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
