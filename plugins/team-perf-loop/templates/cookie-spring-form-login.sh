#!/bin/sh
# Spring Security form login 으로 세션 쿠키를 받아 perf-loop 형식([{name,value}])으로 출력한다.
#   PERF_USER=... PERF_PASS=... sh .claude/perf-loop/cookie.sh <port>
# 로그인 경로·파라미터 이름이 기본값(/login, username, password, _csrf)과 다르면 아래를 고친다.
set -eu
PORT=${1:?port}
BASE="http://localhost:$PORT"
LOGIN_PATH=${PERF_LOGIN_PATH:-/login}
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT

PAGE=$(curl -sf -c "$JAR" -b "$JAR" "$BASE$LOGIN_PATH")
# CSRF 가 꺼져 있으면 빈 값으로 보낸다
CSRF=$(printf '%s' "$PAGE" | sed -n 's/.*name="_csrf"[^>]*value="\([^"]*\)".*/\1/p' | head -1)

# 성공도 실패도 302 다 — 실패는 /login?error 로 간다
RESULT=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -c "$JAR" -b "$JAR" \
  --data-urlencode "username=${PERF_USER:?PERF_USER}" \
  --data-urlencode "password=${PERF_PASS:?PERF_PASS}" \
  --data-urlencode "_csrf=$CSRF" \
  "$BASE$LOGIN_PATH")
case "$RESULT" in
  "302 "*error*) echo "로그인 실패: $RESULT" >&2; exit 1 ;;
  "302 "*) ;;
  *) echo "로그인 응답이 302 가 아니다: $RESULT" >&2; exit 1 ;;
esac

# Netscape 쿠키 파일: 7번째 열이 값, 6번째가 이름. #HttpOnly_ 접두어 줄도 쿠키다.
awk -F '\t' 'BEGIN{printf "["; n=0} /^#HttpOnly_/ {sub(/^#HttpOnly_/, "")} /^#/ || NF < 7 {next}
  {printf "%s{\"name\":\"%s\",\"value\":\"%s\"}", (n++ ? "," : ""), $6, $7} END{print "]"}' "$JAR"
