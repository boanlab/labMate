# LabMate

[![CI](https://github.com/boanlab/labmate/actions/workflows/ci.yml/badge.svg)](https://github.com/boanlab/labmate/actions/workflows/ci.yml)

연구실 그룹웨어 — 구성원·연구과제·연구비·근태·소통·자원을 한곳에서 관리하는 마이크로서비스 기반 웹 애플리케이션.
학생이 실무에 나가기 전 업무 습관을 익히도록 돕는 AI 멘토를 함께 둡니다(선택 기능, 기본 꺼짐).

- **프론트엔드**: React + Vite (TypeScript)
- **백엔드**: FastAPI 마이크로서비스 7종 (Python 3.12)
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

기동 후 브라우저에서 **http://localhost:8080** 접속(포트는 `.env`의 `GATEWAY_PORT`).

| 항목 | 값 |
|---|---|
| 관리자 계정 | `admin@example.com` |
| 기본 비밀번호 | `labmate-admin-1234` |

> 관리자 계정은 첫 배포 시 `.env`의 `ADMIN_EMAIL` / `ADMIN_PASSWORD`로 **자동 생성**됩니다(이미 관리자가 있으면 건너뜀). 로그인 후 비밀번호 변경을 권장합니다.

---

## 환경설정 (.env)

`make up`이 `.env`가 없으면 `.env.example`을 복사해 만듭니다. 운영 시 반드시 값을 변경하세요.

```ini
ENV=development
GATEWAY_PORT=8080                  # 외부 노출 포트
POSTGRES_USER=labmate
POSTGRES_PASSWORD=change-me        # 강력한 값으로 변경
JWT_SECRET=change-me               # openssl rand -hex 32
ADMIN_EMAIL=admin@example.com     # 첫 배포 자동 관리자 시드
ADMIN_PASSWORD=labmate-admin-1234

VAPID_PUBLIC_KEY=                  # Web Push(선택). 미설정 시 인앱 알림만
VAPID_PRIVATE_KEY=                 # 공개키=uncompressed point, 개인키=raw 32B scalar (base64url)

MAX_UPLOAD_MB=30                   # 첨부 한 개당 상한
DOWNLOAD_TOKEN_HOURS=12            # 첨부 다운로드 쿠키 수명(로그아웃 시 즉시 폐기)
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
| `make health` | 전체 서비스 헬스체크 |
| `make seed` | 관리자 계정 시드(멱등) |
| `make qa` | 회귀 검증 실행(실제 브라우저) — 스택이 떠 있어야 함 |
| `make qa-seed` | 회귀 검증용 페르소나 계정 생성(최초 1회) |
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
| **projects** | `/api/projects` | 연구과제·실적·세부업무·마일스톤·연구노트·자료실 |
| **funds** | `/api/funds` | 예산 편성·연구비 집행·인건비 |
| **attendance** | `/api/attendance` | 출퇴근·휴가·근태정정 |
| **boards** | `/api/boards` | 공지·게시판·회의록·전자결재 |
| **resource** | `/api/resource` | 자산·인프라(장비/랙)·예약·교육 |
| **mentor** | `/api/mentor` | AI 멘토 — 글 점검·주간 회고·상시 대화·지도철학·능동 감독 |

각 서비스는 독립 PostgreSQL DB(`labmate_<service>`)를 사용하고, 서비스 간 직접 호출 없이 공통 JWT로만 인증을 공유합니다.

**알림**: 참여자 지정·전자결재·승인 결과 등 이벤트를 서비스별 `notifications` 테이블에 저장하고, 상단 종(bell)이 각 서비스에서 취합해 표시합니다. 승인 대기·마감 임박처럼 상태가 바뀌면 사라져야 하는 항목은 저장하지 않고 조회 시점에 계산합니다(`derived.py`). 구독 시 브라우저·모바일 Web Push(PWA)도 발송합니다 — `.env`의 `VAPID_*` 설정 시 활성(HTTPS 필요).

**화면 설정**: 표 컬럼 폭·정렬 기준, 다크모드, 사이드바 접힘, 알림 읽음 표시는 브라우저가 아니라 **계정**(`/api/members/prefs`)에 저장됩니다. PC 를 옮겨도 같은 화면으로 시작하고, 한 PC 를 여러 사람이 써도 앞사람 설정을 물려받지 않습니다.

### 디렉터리 구조

```
backend/
  services/<service>/app/   # models.py · schemas.py · routers.py · main.py (관리자 시드 seed.py 는 members)
  libs/common/labmate_common/   # 공통: db · config · security · deps · audit · configstore · dataadmin
                                #       · tenancy · migrate · notifications · push · uploads
frontend/src/
  pages/                       # 화면(라우트)  ·  components/  공용 UI(레이아웃·알림·검색)
  ui/                          # 표·폼·다이얼로그 등 공통 요소  ·  api/  서버 통신·설정  ·  lib/  순수 유틸
deploy/nginx/gateway.conf      # API 게이트웨이 라우팅
deploy/postgres/init/          # 서비스별 DB 생성 스크립트
qa/                            # 회귀 검증(Playwright) — 로컬 스택에 대고 손으로 실행(CI 아님)
docker-compose.yml             # 운영 구성
docker-compose.override.yml    # 개발 오버라이드(소스 마운트 + --reload)
data/                          # postgres 데이터 · 업로드 파일(영속)
```

---

## AI 멘토 (선택)

학생이 회의록·연구노트·세부업무·목표를 쓰는 자리에서 바로 봐 주고, 밀린 일을 먼저 짚어 주는 기능입니다.
**모든 기능은 기본으로 꺼져 있고**, 관리자가 OpenRouter 키를 넣고 하나씩 켜야 동작합니다. 키가 없으면
멘토 버튼과 카드는 화면에 나타나지 않으며 나머지 기능은 그대로 씁니다.

### 켜는 방법

1. [openrouter.ai](https://openrouter.ai) 에서 API 키 발급
2. 관리자 화면 › 환경설정 › **AI 설정** 에 키 입력 — `.env` 나 파일에 두지 않습니다
3. 같은 화면에서 쓸 기능을 켜고, 모델과 월 상한을 정합니다

### 무엇을 하나

| 기능 | 내용 |
|---|---|
| 글 점검 | 연구노트·회의록·업무·목표를 쓰는 자리에서 판정과 고칠 점을 준다 |
| 주간 회고 | 한 주 활동을 모아 회고 초안을 만든다 |
| 학기 목표(OKR) | 무엇이 얼마나 되면 달성인지 숫자로 적게 하고 달성률을 보여 준다 |
| 상시 대화 | 지금 보고 있는 화면을 함께 보며 답한다 |
| 지도철학 | AI 가 지도교수와 대화하며 연구·교육·실무 철학을 모으고, 승인한 지침이 학생 지도의 근거가 된다 |
| 능동 감독 | 주간보고가 밀리거나 마감이 지났는데 갱신이 없으면 멘토가 먼저 짚는다 |
| 지도 현황 | 교수가 누구를 먼저 챙겨야 하는지 한 화면에서 본다 |

### 비용

기본 모델은 `anthropic/claude-haiku-4.5`, 월 상한은 **$5** 입니다(관리자 화면에서 변경). 상한에 닿으면
호출을 멈추고 "이번 달 AI 사용 한도를 다 썼습니다"라고 안내합니다. 다른 기능에는 영향이 없습니다.
사용량은 관리자 화면에서 기능별로 볼 수 있습니다.

### 키 취급

| 항목 | 처리 |
|---|---|
| 저장 | `JWT_SECRET` 에서 파생한 키로 암호화(Fernet)해 `mentor_secrets` 에 보관 |
| 조회 | 평문은 어떤 API 로도 나가지 않는다. 화면에는 앞 8자·뒤 4자만(`sk-or-v1••••••cdef`) |
| 권한 | 등록·변경·삭제 모두 관리자만 |
| 백업 | 관리자 화면 백업(ZIP)에는 mentor 서비스가 **들어가지 않는다** — 키가 백업 파일로 새지 않도록 백업 라우터 자체를 붙이지 않았다. CLI `make backup` 은 `pg_dumpall` 이라 암호화된 상태로 포함되며, 같은 `JWT_SECRET` 없이는 풀 수 없다 |

모델이 내부적으로 거치는 추론 과정은 학생에게 보여 주지 않습니다 — 최종 답변만 화면에 올립니다.

---

## 보안

| 대상 | 정책 |
|---|---|
| 인증 | JWT(access 15분 / refresh 14일). 서비스 간 호출 없이 공유 시크릿으로 서명 검증 |
| 로그인 시도 | 계정 5회 · IP 20회 실패 시 5분 잠금(Redis), 성공하면 초기화 |
| 첨부 업로드 | 확장자 허용 목록 + 한 개당 `MAX_UPLOAD_MB`(기본 30MB). `.html`·`.svg` 등 실행 가능한 형식은 거부 |
| 첨부 다운로드 | 로그인 필수 — gateway 가 `auth_request` 로 httpOnly 쿠키를 확인. 무인증으로 열리는 경로 없음 |
| 첨부 응답 | `nosniff` · `Content-Security-Policy: default-src 'none'; sandbox` · 이미지·PDF 외에는 `Content-Disposition: attachment` |
| 권한 | 역할(prof/phd/master/under/staff/admin) + 위임 관리자·인프라 담당 플래그 |
| 감사 로그 | 서비스별 `audit_logs` 기록, 관리자 화면에서 전 서비스 집계 조회 |

첨부는 앱과 같은 출처(`/uploads/...`)에서 서빙되므로 업로드(형식 제한)와 다운로드(인증·응답 헤더) 양쪽에서 막습니다. 로그인 화면 로고는 파일이 아니라 설정값(data URI)으로 보관해 무인증 경로를 만들지 않습니다.

운영 시 앞단에 HTTPS 리버스 프록시를 두세요 — `ENV=production` 이면 다운로드 쿠키에 `Secure` 가 붙습니다.

---

## 검증

실제 브라우저(Playwright/Chromium)로 5개 페르소나의 업무 흐름·접근성·레이아웃·보안을 확인합니다.
스위트 34개, 검증 항목 640개 규모입니다(AI 멘토 응답 품질 벤치마크 포함 — 켜져 있을 때만 의미가 있습니다).
전제 데이터(과제·공지·근태 등)가 쌓인 로컬 스택에서 손으로 돌리는 것을 전제로 하며, CI 에는
물려 있지 않습니다 — 빈 DB 에서는 상당수 검증이 전제 데이터 부재로 실패합니다.

```bash
make qa-seed   # 페르소나 계정 생성(최초 1회)
make qa        # 전체 회귀 — 실패 시 0이 아닌 값으로 종료
```

전체 로그는 `qa/out/regress.log`, 스크린샷은 `qa/out/shots/`. 자세한 내용은 [qa/README.md](qa/README.md).

---

## 데이터 백업 / 복구

DB와 첨부파일(`data/uploads`)을 하나의 아카이브로 백업·복구합니다.

```bash
make backup                                            # data/backups/labmate_<시각>.tar.gz (DB + 첨부파일)
make restore FILE=data/backups/labmate_<시각>.tar.gz   # 복구(현재 DB·첨부파일을 백업본으로 덮어씀)
```

- `restore`는 앱 서비스 정지 → DB 재적재 → 첨부파일 복원 → 재기동 순으로 진행합니다(되돌릴 수 없음).
- 관리자 화면(환경설정 › 데이터 백업)은 **DB 데이터 + 첨부파일**을 ZIP(`data.json` + `uploads/`)으로 백업·복구합니다. 구 `.json` 백업 파일도 복구 가능합니다(DB만).
- 두 방식의 범위가 한 곳에서 다릅니다: **mentor 서비스는 관리자 화면 백업에 들어가지 않습니다**(OpenRouter 키가 백업 파일로 새지 않도록). CLI `make backup` 은 `pg_dumpall` 이라 포함되며, 키는 암호화된 상태입니다.

---

## 개발

개발은 `make dev-up`으로 기동합니다. `docker-compose.override.yml`이 백엔드 소스를 컨테이너에 마운트하고 `--reload`로 즉시 반영합니다. 백엔드 코드는 저장 시 자동 리로드되며, 프론트엔드 변경은 `docker compose build frontend && docker compose up -d frontend`로 반영합니다.

스키마 변경(컬럼 추가/개명)은 각 서비스 `main.py` lifespan의 `Base.metadata.create_all` + `rename_columns` 멱등 마이그레이션으로 적용됩니다.

변경 후에는 로컬 스택에 대고 `make qa`로 회귀 검증을 돌려 보세요(CI 에는 물려 있지 않음). 주석은 핵심만 명사형으로 남기고 작업 이력은 적지 않습니다([CONTRIBUTING.md](CONTRIBUTING.md)).

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
