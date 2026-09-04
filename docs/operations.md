# 운영

설치·배포·백업 등 스택을 돌리는 데 필요한 것들. 처음이라면 [README](../README.md)부터 보세요.

## 환경설정 (.env)

`make up` 이 `.env` 가 없으면 `.env.example` 을 복사해 만듭니다. 운영 시 반드시 값을 바꾸세요.

```ini
ENV=development
GATEWAY_PORT=8080                  # 외부 노출 포트
POSTGRES_USER=labmate
POSTGRES_PASSWORD=change-me        # 강력한 값으로 변경
JWT_SECRET=change-me               # openssl rand -hex 32
ADMIN_EMAIL=admin@example.com      # 첫 배포 자동 관리자 시드
ADMIN_PASSWORD=labmate-admin-1234

VAPID_PUBLIC_KEY=                  # Web Push(선택). 미설정 시 인앱 알림만
VAPID_PRIVATE_KEY=                 # 공개키=uncompressed point, 개인키=raw 32B scalar (base64url)

MAX_UPLOAD_MB=30                   # 첨부 한 개당 상한
DOWNLOAD_TOKEN_HOURS=12            # 첨부 다운로드 쿠키 수명(로그아웃 시 즉시 폐기)
```

`JWT_SECRET` 은 인증 서명과 OpenRouter 키 암호화에 함께 쓰입니다 — 바꾸면 저장된 AI 키를 풀 수 없어 다시 등록해야 합니다.

## 배포 방식

| 방식 | 명령 | 내용 |
|---|---|---|
| 레지스트리(기본) | `make up` | `boanlab/labmate-*:v0.1` 이미지를 받아 기동. 소스·빌드 불필요 |
| 소스 빌드(개발) | `make dev-up` | 소스에서 빌드, 소스 마운트 + `--reload` |

이미지 조직·버전은 변수로 덮어씁니다: `make build-images ORG=myorg VERSION=v0.2`, `make up VERSION=latest`.

## 명령어

`make help` 로 전체 목록을 봅니다.

**기동·상태**

| 명령 | 설명 |
|---|---|
| `make up` / `make deploy` | 이미지 pull + 기동 + 게이트웨이 갱신 |
| `make dev-up` | 소스에서 빌드해 기동 |
| `make stop` / `make down` / `make restart` | 중지 / 제거 / 재시작 (데이터 유지) |
| `make ps` / `make logs` / `make health` | 상태 · 로그(`S=members-service` 로 개별) · 헬스체크 |

**데이터**

| 명령 | 설명 |
|---|---|
| `make seed` | 관리자 계정 시드(멱등) |
| `make backup` | DB + 첨부파일 → `data/backups/labmate_<시각>.tar.gz` |
| `make restore FILE=…` | 백업 아카이브로 복구 |
| `make reset` | ⚠ 모든 데이터 삭제 후 관리자만 재시드 |
| `make purge` | ⚠⚠ `data/` 까지 영구 삭제 — 공장 초기화 |

**검증·배포**

| 명령 | 설명 |
|---|---|
| `make qa-seed` / `make qa` | 페르소나 계정 생성(최초 1회) · 회귀 검증 |
| `make build` / `make build-images` | 이미지 빌드 |
| `make push-images` / `make release` | 레지스트리 푸시 · 빌드+푸시 |
| `make clean` / `make clean-all` | 컨테이너 제거 · ⚠ 볼륨·이미지까지 |

## 백업 / 복구

```bash
make backup                                            # DB + 첨부파일
make restore FILE=data/backups/labmate_<시각>.tar.gz   # 현재 데이터를 덮어씀(되돌릴 수 없음)
```

`restore` 는 앱 정지 → DB 재적재 → 첨부파일 복원 → 재기동 순으로 돕니다.

관리자 화면(환경설정 › 데이터 백업)에서도 ZIP(`data.json` + `uploads/`)으로 백업·복구할 수 있습니다.
**범위가 한 곳에서 다릅니다** — mentor 서비스는 화면 백업에 들어가지 않습니다(OpenRouter 키가 백업
파일로 새지 않도록). CLI `make backup` 은 `pg_dumpall` 이라 포함되며, 키는 암호화된 상태입니다.

## 트러블슈팅

| 증상 | 조치 |
|---|---|
| `/api/<service>` 가 502 이거나 엉뚱한 응답 | 게이트웨이가 옛 컨테이너 IP 를 캐시한 경우 — `make gateway-restart` |
| 로그인 안 됨 / 관리자 없음 | `make seed` (`.env` 기반, 멱등) |
| 포트 충돌 | `.env` 의 `GATEWAY_PORT` 변경 후 `make up` |
| 완전 초기화 | 데이터만 `make reset` · DB 파일까지 `make purge` |
