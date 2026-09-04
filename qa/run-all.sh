#!/usr/bin/env bash
# LabMate 회귀 검증 — 전체 묶음을 한 번에 돌리고, 하나라도 실패하면 0이 아닌 값으로 끝난다.
#
#   ./run-all.sh                     기동돼 있는 스택(기본 http://localhost:8080)에 대고 실행
#   LM_BASE=http://호스트:8080 ./run-all.sh
#
# 화면에는 묶음별 끝 몇 줄만, 전체 로그는 out/regress.log. 판정은 전체 로그 기준.
set -u
set -o pipefail   # 파이프 끝의 tail 이 아니라 검증 스크립트의 종료 코드를 본다
cd "$(dirname "$0")"

OUT="${LM_OUT:-$PWD/out}"
LOG="$OUT/regress.log"
mkdir -p "$OUT"
: > "$LOG"

# 관리자 계정 — 일부 검증(결재 설정 전환)에서 필요하다.
ENV_FILE="${LM_ENV_FILE:-../.env}"
ADM_E="${LM_ADMIN_EMAIL:-$( [ -f "$ENV_FILE" ] && grep '^ADMIN_EMAIL=' "$ENV_FILE" | cut -d= -f2 )}"
ADM_P="${LM_ADMIN_PW:-$( [ -f "$ENV_FILE" ] && grep '^ADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2- )}"

CRASHED=""
run() {
  local title="$1"; shift
  printf '\n\033[1m── %s\033[0m\n' "$title"
  printf '\n── %s\n' "$title" >> "$LOG"
  if ! "$@" 2>&1 | tee -a "$LOG" | tail -"${TAIL:-3}"; then
    # 검증 실패와 검증 자체의 중단은 다르다 — 후자는 아무 판정도 못 한 것이므로 별도로 센다.
    printf '\033[1m   ↑ 이 묶음이 끝까지 돌지 못했습니다\033[0m\n'
    CRASHED="$CRASHED\n  - $title"
  fi
}

run "전 페르소나 라우트 크롤"      node scripts/crawl.mjs
run "업무 시나리오 1"              env TAIL=4 node scripts/sc-workday.mjs
run "업무 시나리오 2"              env TAIL=6 node scripts/sc-workday2.mjs
run "뷰포트 스윕(레이아웃)"       env TAIL=3 node scripts/responsive.mjs
run "대비(WCAG AA)"                node scripts/contrast.mjs
run "라벨-입력 연결"               node scripts/a11y-labels.mjs
run "터치 타깃"                    node scripts/touch-targets.mjs
run "작성 중 이탈 보호"            node scripts/verify-dataloss.mjs
run "모달 이탈 가드"               node scripts/verify-modal-guard.mjs
run "검증 실패 포커스"             node scripts/verify-focus-invalid.mjs
run "날짜·시간 검증"               node scripts/verify-dates.mjs
run "일괄 수정 검증"               node scripts/verify-batch.mjs
run "업무 길잡이·편의"             env TAIL=3 node scripts/verify-guides.mjs
run "로딩 표시(느린 회선)"         env TAIL=2 node scripts/verify-loading.mjs
run "페이징 경계(대량)"            env TAIL=2 node scripts/verify-paging.mjs
run "학생인건비 편성"              env TAIL=2 node scripts/verify-payroll.mjs
run "연구노트 검색·태그"           env TAIL=2 node scripts/verify-notes.mjs
run "연구비 집행 결재"             env TAIL=2 LM_ADMIN_EMAIL="$ADM_E" LM_ADMIN_PW="$ADM_P" node scripts/verify-expense-approval.mjs
run "마감 알림·캘린더"             env TAIL=2 node scripts/verify-deadlines.mjs
run "자산 예약 연동"               env TAIL=2 node scripts/verify-bookable.mjs
run "전역 검색·내 할 일"           env TAIL=2 node scripts/verify-search-todo.mjs
run "표 정렬·컬럼 폭"              env TAIL=2 node scripts/verify-table-tools.mjs
run "화면 설정 계정 저장"          env TAIL=2 node scripts/verify-prefs.mjs
run "알림 폴링"                    env TAIL=2 node scripts/verify-notif.mjs
run "퇴사·삭제 구성원 이름"     env TAIL=3 node scripts/verify-member-names.mjs
run "지도철학 인터뷰"            env TAIL=3 node scripts/verify-philosophy.mjs
run "멘토와 보내는 한 주"        env TAIL=10 node scripts/sc-mentor-week.mjs
run "AI 멘토 화면"              env TAIL=3 LM_ADMIN_EMAIL="$ADM_E" LM_ADMIN_PW="$ADM_P" node scripts/verify-mentor-ui.mjs
run "첨부 보안"                    env TAIL=3 node scripts/verify-upload-security.mjs
run "동시 편집(낙관적 잠금)"       node scripts/concurrency.mjs

# ── 판정 ──
plain() { sed 's/\x1b\[[0-9;]*m//g' "$LOG"; }
FAILED=$(plain | grep -c '^❌' || true)
BUGS=$(plain | grep -c '\[BUG\]' || true)
ERRS=$(plain | grep -c '\[ERR\]' || true)

printf '\n\033[1m===== 요약 =====\033[0m\n'
plain | grep -E '^결과:' | awk -F'[:/ ]+' '{p+=$2; t+=$3} END {if (t) printf "  검증 항목  %d/%d 통과\n", p, t}'
printf '  실패 %s · 결함 %s · 오류 %s\n' "$FAILED" "$BUGS" "$ERRS"
[ -n "$CRASHED" ] && printf '  중단된 묶음:%b\n' "$CRASHED"
echo "  전체 로그: $LOG"

if [ -n "$CRASHED" ] || [ "$FAILED" -gt 0 ] || [ "$BUGS" -gt 0 ] || [ "$ERRS" -gt 0 ]; then
  printf '\n\033[1m실패 항목\033[0m\n'
  plain | grep -E '^❌|\[BUG\]|\[ERR\]' | head -40
  exit 1
fi
echo "  전부 통과"
