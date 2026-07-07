# 반응형 테이블 E2E 검증 (Playwright)

여러 브라우저 폭(360/390/768/1024/1440px)에서 목록 페이지의 가로 오버플로우·컬럼 최소폭을 측정하고
스크린샷을 남긴다. 호스트에 node가 없어도 되도록 Playwright 도커 이미지로 실행한다.

토큰은 실행 시점에 `.env`의 `JWT_SECRET`으로 서명해 주입한다(비밀번호·시크릿 노출 없음).
`PROF_ID`에는 기존 비관리자 사용자 UUID를 넣는다(역할 게이트가 있는 목록 페이지 접근용).

```bash
# 앱이 localhost:8090에서 떠 있어야 함
IMG=mcr.microsoft.com/playwright:v1.49.1-jammy
PROF_ID=$(docker exec labmate-postgres-1 psql -U labmate -d labmate_members -tAc \
  "SELECT id FROM users WHERE role IN ('prof','phd','master','under') AND coalesce(active,true) LIMIT 1")
docker run --rm --network host --env-file .env -e PROF_ID="$PROF_ID" \
  -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 -v "$PWD/frontend/e2e":/work -w /work "$IMG" \
  bash -lc 'npm i --no-save playwright@1.49.1 >/dev/null 2>&1 && node responsive.js'
# 결과: shots/*.png, report.json
```

각 행 판정: `pOv`(페이지 가로 스크롤)=0, `tOv`(카드 내 표 가로 스크롤)=0, fit 표는 최소 컬럼폭 ≥ 32px.
