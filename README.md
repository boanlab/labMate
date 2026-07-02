# LabMate

연구실 그룹웨어 — 구성원·연구과제·연구비·근태·소통·자원을 한곳에서 관리하는 마이크로서비스 기반 웹 애플리케이션.

- **프론트엔드**: React + Vite (TypeScript)
- **백엔드**: FastAPI 마이크로서비스 6종 (Python 3.12)
- **데이터베이스**: PostgreSQL 16 (서비스별 DB로 격리) + Redis
- **게이트웨이**: nginx (`/api/<service>/*` 라우팅 + 프론트 서빙)
- **구동**: Docker Compose

---

## 빠른 시작

전제: Docker / Docker Compose, `make`.

```bash
make up        # .env 자동 생성(없으면) → 레지스트리 이미지 pull → 기동 → 게이트웨이 갱신
make dev-up    # 소스에서 빌드해 기동(개발 — 소스 마운트·리로드)
```

기동 후 브라우저에서 **http://localhost:8090** 접속.

| 항목 | 값 |
|---|---|
| 관리자 계정 | `labmate@kloud.zone` |
| 기본 비밀번호 | `labmate123` |

> 관리자 계정은 첫 배포 시 `.env`의 `ADMIN_EMAIL` / `ADMIN_PASSWORD`로 **자동 생성**됩니다(이미 관리자가 있으면 건너뜀). 로그인 후 비밀번호 변경을 권장합니다.

---

## 환경설정 (.env)

`make up`이 `.env`가 없으면 `.env.example`을 복사해 만듭니다. 운영 시 반드시 값을 변경하세요.

```ini
ENV=development
GATEWAY_PORT=8090                  # 외부 노출 포트
POSTGRES_USER=labmate
POSTGRES_PASSWORD=change-me        # 강력한 값으로 변경
JWT_SECRET=change-me               # openssl rand -hex 32
ADMIN_EMAIL=labmate@kloud.zone     # 첫 배포 자동 관리자 시드
ADMIN_PASSWORD=labmate123
```

---

## 명령어 (Makefile)

```bash
make help      # 전체 명령 목록
```

| 명령 | 설명 |
|---|---|
| `make up` / `make deploy` | 레지스트리 이미지 pull + 기동 + 게이트웨이 갱신(기본) |
| `make dev-up` | 소스에서 빌드해 기동(개발 — 소스 마운트·리로드) |
| `make build` | 이미지 빌드만 |
| `make stop` | 컨테이너 중지(데이터 유지) |
| `make down` | 컨테이너 제거(데이터 유지) |
| `make restart` | 전체 재시작 |
| `make ps` | 컨테이너 상태 |
| `make logs` | 로그 follow (`make logs S=members-service` 로 개별) |
| `make health` | 6개 서비스 헬스체크 |
| `make seed` | 관리자 계정 시드(멱등) |
| `make backup` | 전체 백업(DB + 첨부파일) → `data/backups/labmate_<시각>.tar.gz` |
| `make restore FILE=…` | 백업 아카이브로 DB·첨부파일 복구 |
| `make reset` | ⚠ 모든 데이터 삭제 후 관리자만 재시드 |
| `make clean` | 컨테이너+네트워크 제거(데이터 유지) |
| `make clean-all` | ⚠ 컨테이너+볼륨+빌드이미지 제거 |
| `make purge` | ⚠⚠ `data/`(DB·업로드)까지 영구 삭제 — 공장 초기화 |
| `make build-images` | 배포용 이미지 빌드 → `boanlab/labmate-<service>:{v0.1,latest}` |
| `make push-images` | 이미지 레지스트리 푸시(`v0.1`+`latest`, `docker login` 필요) |
| `make release` | 이미지 빌드 + 푸시 |
| `make pull` | 레지스트리에서 이미지 받기 |
| `make prod-up` | `make up` 별칭(하위호환) |
| `make prod-down` | 레지스트리 배포 중지/제거 |

이미지 조직/버전은 변수로 덮어쓸 수 있습니다: `make build-images ORG=myorg VERSION=v0.2`, `make up VERSION=latest`.

### 배포 방식 두 가지

- **레지스트리 배포(기본)**: `make up` — `boanlab/labmate-*:v0.1` 이미지를 받아 그대로 기동(소스/빌드 불필요). `docker-compose.yml`의 각 서비스는 `image:`로 푸시 이미지를 참조합니다.
- **소스 빌드(개발)**: `make dev-up` — `build:`로 소스에서 빌드, 소스 마운트 + `--reload`.

---

## 서비스 구성

게이트웨이가 `/api/<service>/*` 경로를 각 서비스로 프록시합니다.

| 서비스 | 라우트 | 담당 도메인 |
|---|---|---|
| **members** | `/api/members` | 인증·계정·구성원·권한위임 |
| **projects** | `/api/projects` | 연구과제·실적·세부업무·마일스톤·연구노트 |
| **funds** | `/api/funds` | 예산 편성·연구비 집행·인건비 |
| **attendance** | `/api/attendance` | 출퇴근·휴가·근태정정 |
| **boards** | `/api/boards` | 공지·게시판·회의록·전자결재 |
| **resource** | `/api/resource` | 자산·인프라(장비/랙)·예약·교육 |

각 서비스는 독립 PostgreSQL DB(`labmate_<service>`)를 사용하고, 서비스 간 직접 호출 없이 공통 JWT로만 인증을 공유합니다.

### 디렉터리 구조

```
backend/
  services/<service>/app/   # models.py · schemas.py · routers.py · main.py · seed.py
  libs/common/labmate_common/   # 공통: db · config · security · audit · configstore · dataadmin · tenancy · migrate
frontend/src/                  # React 페이지·컴포넌트
deploy/nginx/gateway.conf      # API 게이트웨이 라우팅
deploy/postgres/init/          # 서비스별 DB 생성 스크립트
docker-compose.yml             # 운영 구성
docker-compose.override.yml    # 개발 오버라이드(소스 마운트 + --reload)
data/                          # postgres 데이터 · 업로드 파일(영속)
```

---

## 데이터 백업 / 복구

DB와 첨부파일(`data/uploads`)을 하나의 아카이브로 백업·복구합니다.

```bash
make backup                                            # data/backups/labmate_<시각>.tar.gz (DB + 첨부파일)
make restore FILE=data/backups/labmate_<시각>.tar.gz   # 복구(현재 DB·첨부파일을 백업본으로 덮어씀)
```

- `restore`는 앱 서비스 정지 → DB 재적재 → 첨부파일 복원 → 재기동 순으로 진행합니다(되돌릴 수 없음).
- 관리자 화면(환경설정 › 데이터 백업)의 JSON 백업/복구는 **DB 데이터만** 다룹니다(첨부파일 미포함). 첨부파일까지 포함한 완전 백업은 `make backup`을 사용하세요.

---

## 개발

개발은 `make dev-up`으로 기동합니다. `docker-compose.override.yml`이 백엔드 소스를 컨테이너에 마운트하고 `--reload`로 즉시 반영합니다. 백엔드 코드는 저장 시 자동 리로드되며, 프론트엔드 변경은 `docker compose build frontend && docker compose up -d frontend`로 반영합니다.

스키마 변경(컬럼 추가/개명)은 각 서비스 `main.py` lifespan의 `Base.metadata.create_all` + `rename_columns` 멱등 마이그레이션으로 적용됩니다.

---

## 트러블슈팅

- **`/api/<service>` 응답이 엉뚱하거나 502** — 백엔드 재빌드 후 게이트웨이가 옛 컨테이너 IP를 캐시한 경우. `make gateway-restart`.
- **로그인 안 됨 / 관리자 없음** — `make seed`로 `.env` 기반 관리자 재생성(멱등).
- **포트 충돌** — `.env`의 `GATEWAY_PORT` 변경 후 `make up`.
- **완전 초기화** — 데이터만: `make reset` · DB 파일까지: `make purge`.

---

## 라이선스 / 기여

- 라이선스: [MIT](LICENSE)
- 기여 방법: [CONTRIBUTING.md](CONTRIBUTING.md)
