# LabMate

[![CI](https://github.com/boanlab/labmate/actions/workflows/ci.yml/badge.svg)](https://github.com/boanlab/labmate/actions/workflows/ci.yml)

연구실 그룹웨어. 구성원·연구과제·연구비·근태·소통·자원을 한곳에서 관리합니다.

연구실 업무를 굴리는 것만이 목적은 아닙니다. 학생이 실무에 나가기 전 보고서·회의록·일정 관리 같은
업무 습관을 익히도록 돕는 **AI 멘토**를 함께 둡니다(선택 기능, 기본 꺼짐).

## 무엇을 하나

| 영역 | 기능 |
|---|---|
| **업무** | 연구과제·프로젝트, 세부업무, 분기 목표(OKR), 연구노트, 캘린더 |
| **소통** | 공지, 게시판, 회의록, 전자결재(위임·승인취소), 알림(인앱 + Web Push) |
| **연구비** | 예산 편성, 연구비 집행, 학생인건비(참여율 편성·지급확정) |
| **근태** | 출퇴근·자리비움, 휴가 신청·승인, 근태 정정 요청 |
| **자원** | 자산, 인프라(장비·랙), 예약 |
| **성과** | 연구실적 등록·집계, 과제별 목표 대비 달성 현황 |
| **AI 멘토** | 글 점검, 주간 회고, 상시 대화, 지도교수 철학 반영, 밀린 일 독려 |

## 빠른 시작

Docker · Docker Compose · `make` 가 필요합니다.

```bash
make up        # 이미지 pull → 기동 → 게이트웨이 갱신
make dev-up    # 소스에서 빌드해 기동(개발)
```

**http://localhost:8080** 접속 후 `admin@example.com` / `labmate-admin-1234` 로 로그인합니다.
관리자 계정은 첫 배포 때 `.env` 값으로 자동 생성되며, 로그인 후 비밀번호를 바꾸세요.

## 구성

React + Vite(TypeScript) · FastAPI 마이크로서비스 7종(Python 3.12) · PostgreSQL 16(서비스별 DB) · Redis ·
nginx 게이트웨이 · Docker Compose.

| 서비스 | 라우트 | 담당 |
|---|---|---|
| members | `/api/members` | 인증·계정·구성원·권한위임 |
| projects | `/api/projects` | 연구과제·실적·세부업무·목표·연구노트·아카이브 |
| funds | `/api/funds` | 예산·연구비 집행·인건비 |
| attendance | `/api/attendance` | 출퇴근·휴가·근태정정 |
| boards | `/api/boards` | 공지·게시판·회의록·전자결재 |
| resource | `/api/resource` | 자산·인프라·예약 |
| mentor | `/api/mentor` | AI 멘토 |

각 서비스는 독립 DB(`labmate_<service>`)를 쓰고, 서로 직접 호출하지 않습니다 — 공통 JWT 로만 인증을 공유합니다.

표 컬럼 폭·정렬, 다크모드, 사이드바 접힘 같은 화면 설정은 브라우저가 아니라 **계정**에 저장됩니다.
PC 를 옮겨도 같은 화면으로 시작하고, 한 PC 를 여럿이 써도 앞사람 설정을 물려받지 않습니다.

## 문서

| 문서 | 내용 |
|---|---|
| [운영](docs/operations.md) | 환경설정 · 명령어 · 배포 · 백업/복구 · 트러블슈팅 |
| [AI 멘토](docs/ai-mentor.md) | 켜는 방법 · 기능 · 비용 · 키 취급 |
| [보안](docs/security.md) | 인증 · 권한 · 첨부 · 감사 로그 |
| [회귀 검증](qa/README.md) | 실제 브라우저로 도는 검증 — `make qa` |
| [기여](CONTRIBUTING.md) | 개발 환경 · 코드 규약 · CI · 변경 절차 |

## 라이선스

[MIT](LICENSE)
