# 보안

| 대상 | 정책 |
|---|---|
| 인증 | JWT(access 15분 / refresh 14일). 서비스 간 호출 없이 공유 시크릿으로 서명 검증 |
| 로그인 시도 | 계정 5회 · IP 20회 실패 시 5분 잠금(Redis), 성공하면 초기화 |
| 권한 | 역할(prof/phd/master/under/staff/admin) + 위임 관리자·인프라 담당 플래그 |
| 첨부 업로드 | 확장자 허용 목록 + 한 개당 `MAX_UPLOAD_MB`(기본 30MB). `.html`·`.svg` 등 실행 가능한 형식은 거부 |
| 첨부 다운로드 | 로그인 필수 — gateway 가 `auth_request` 로 httpOnly 쿠키를 확인. 무인증으로 열리는 경로 없음 |
| 첨부 응답 | `nosniff` · `Content-Security-Policy: default-src 'none'; sandbox` · 이미지·PDF 외에는 `Content-Disposition: attachment` |
| AI 키 | 암호화 저장, 평문 미노출, 관리자 전용 — [AI 멘토](ai-mentor.md#키-취급) |
| 감사 로그 | 서비스별 `audit_logs` 기록, 관리자 화면에서 전 서비스 집계 조회 |

첨부는 앱과 같은 출처(`/uploads/...`)에서 서빙되므로 업로드(형식 제한)와 다운로드(인증·응답 헤더)
양쪽에서 막습니다. 로그인 화면 로고는 파일이 아니라 설정값(data URI)으로 보관해 무인증 경로를
만들지 않습니다.

운영 시 앞단에 HTTPS 리버스 프록시를 두세요 — `ENV=production` 이면 다운로드 쿠키에 `Secure` 가 붙습니다.
