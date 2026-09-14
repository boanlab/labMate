#!/bin/sh
# 지난 배포의 자산을 남겨 둔다.
#
# 화면을 열어 둔 사람은 옛 번들을 쥐고 있다. 편집기처럼 필요할 때 받아 오는 조각이
# 새 배포로 사라지면 그 화면은 흰 화면이 된다. 그래서 새 자산을 보관 폴더에 얹어 두고,
# 지금 배포에 없는 이름은 그쪽에서 내어 준다. 오래된 것은 날짜로 정리한다.
set -e
KEEP=/srv/keep/assets
mkdir -p "$KEEP"
find "$KEEP" -type f -mtime +14 -delete 2>/dev/null || true   # 2주면 충분히 남긴 셈이다
cp -a /usr/share/nginx/html/assets/. "$KEEP"/ 2>/dev/null || true
exec /docker-entrypoint.sh "$@"
