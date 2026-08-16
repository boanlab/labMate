# 기여 가이드

LabMate에 기여해 주셔서 감사합니다. 이 문서는 개발 환경 구성과 코드 규약을 정리합니다.

## 개발 환경

전제: Docker / Docker Compose, `make`.

```bash
make dev-up     # .env 생성 → 소스 빌드 → 기동(소스 마운트·리로드)
make health     # 서비스 상태 확인
make logs S=members-service   # 개별 서비스 로그
```

- 개발은 `make dev-up`으로 기동합니다. `docker-compose.override.yml`이 백엔드 소스를 마운트해 `--reload`로 즉시 반영합니다. (`make up`은 레지스트리 이미지를 pull해 기동하는 운영 기본값입니다.)
- 프론트엔드 변경은 `docker compose build frontend && docker compose up -d frontend`로 반영합니다.

## 프로젝트 구조

| 경로 | 내용 |
|---|---|
| `backend/services/<service>/app/` | `models.py`(SQLAlchemy) · `schemas.py`(Pydantic) · `routers.py` · `main.py` |
| `backend/libs/common/labmate_common/` | 공통 모듈(db · config · security · audit · configstore · dataadmin · tenancy · migrate) |
| `frontend/src/` | React 페이지·컴포넌트 |
| `deploy/` | nginx 게이트웨이 · postgres 초기화 |

서비스 6종(members · projects · funds · attendance · boards · resource)은 독립 DB를 사용하고 공통 JWT로 인증을 공유합니다.

## 코드 규약

- **주석**: 핵심만 간략하게 명사형. 코드가 자명한 내용·작업 이력은 적지 않습니다. 비자명한 도메인 규칙·의도(why)만 남깁니다.
- **스키마 변경**: 컬럼 추가/개명은 각 서비스 `main.py` lifespan의 `create_all` + `rename_columns` 멱등 마이그레이션으로 적용합니다. 기존 데이터를 파괴하지 않습니다.
- **API 경로**: `/api/<service>/...`. 프론트엔드는 `api` 클라이언트(baseURL `/api`)로 호출합니다.
- **권한**: 역할(prof/phd/master/under/staff/admin) + 위임 관리자 플래그로 제어합니다.

## CI

PR과 `main` push마다 GitHub Actions(`.github/workflows/ci.yml`)가 돕니다. 로컬에서 미리 돌려볼 수 있는 것들:

| CI 잡 | 확인 내용 | 로컬 실행 |
| --- | --- | --- |
| `backend` | 린트(`backend/ruff.toml`) + 여섯 서비스 임포트 | `cd backend && ruff check .` |
| `frontend` | 타입 체크 + 빌드 | `cd frontend && npm ci && npm run build` |
| `compose` | compose 파일 보간/스키마 | `docker compose config -q` |
| `shell` | postgres init 스크립트 | `shellcheck deploy/postgres/init/*.sh` |
| `images` | 변경된 서비스의 이미지 빌드 | `make build` |

린트는 지금 실제 오류(문법·미정의 이름·미사용 임포트)만 막습니다. 스타일 규칙은 기존 코드 정리 후 `backend/ruff.toml`의 `select`에 추가하면 됩니다.

프론트 의존성을 추가/변경하면 `npm install <pkg>`로 갱신된 `frontend/package-lock.json`을 함께 커밋합니다. CI와 이미지 빌드 모두 `npm ci`(락파일 기준)로 설치하므로, 락파일이 없거나 `package.json`과 어긋나면 실패합니다.

## 변경 절차

1. 브랜치 생성 후 작업합니다.
2. 백엔드 변경 시 `make dev-up && make health`로 정상 기동을 확인합니다.
3. 게이트웨이가 옛 컨테이너 IP를 캐시하면 `make gateway-restart`.
4. PR에 변경 의도와 영향 범위를 간략히 적습니다.
