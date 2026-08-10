#!/usr/bin/env bash
# handoff 스킬 보조 — 현재 세션의 "기계적 상태"를 한 번에 수집한다.
# LLM 이 손으로 git 명령을 나열하다 빠뜨리는 것을 막기 위한 것이므로, 여기서는 판단하지 않고 사실만 찍는다.
# 임계 판정과 정리 제안 여부는 전부 SKILL.md 가 한다.
#
#   bash state.sh          # 상태 수집
#   bash state.sh --paths  # 경로만(빠름)
#
# 의존성 없음. GNU(리눅스)·BSD(macOS) 양쪽에서 동작한다.

set -uo pipefail

# ── 이식성 헬퍼 ──────────────────────────────────────────
# 파일 수정일(YYYY-MM-DD). GNU 는 stat -c, BSD 는 stat -f 라 둘 다 시도한다.
mtime_date() {
  local d
  d="$(stat -c '%y' "$1" 2>/dev/null | cut -d' ' -f1)"
  [ -n "$d" ] || d="$(stat -f '%Sm' -t '%Y-%m-%d' "$1" 2>/dev/null)"
  printf '%s' "${d:-?}"
}

# ── 프로젝트 메모리 디렉토리 찾기 ─────────────────────────
# Claude Code 규칙: cwd 의 `/` `_` `.` 를 `-` 로 바꾼 것이 ~/.claude/projects/ 아래 디렉토리명.
slug_of() { printf '%s' "$1" | sed -e 's#[/_.]#-#g'; }

CWD="$(pwd)"
SLUG="$(slug_of "$CWD")"
MEM="$HOME/.claude/projects/$SLUG/memory"

# 계산한 경로가 없으면 basename 으로 후보를 찾는다(워크트리·심링크 대비).
# 단 접미사가 정확히 `-<BASE>` 인 후보가 **유일할 때만** 채택한다.
# 느슨한 glob(`*BASE`)으로 head -1 을 집으면 basename 만 같은 무관한 프로젝트가 걸린다 —
# 그 경우 남의 메모리에 인계를 쓰거나, 현재 프로젝트의 MEMORY.md 가 자동 로드되지 않아
# 이 스킬의 핵심 메커니즘(대기 포인터)이 조용히 죽는다. 애매하면 채택하지 않는 쪽이 맞다.
MEM_FALLBACK=no
if [ ! -d "$MEM" ]; then
  BASE="$(basename "$CWD" | sed -e 's#[_.]#-#g')"
  CANDS="$(ls -1d "$HOME/.claude/projects/"*"-$BASE" 2>/dev/null)"
  CAND_N="$(printf '%s' "$CANDS" | grep -c . || true)"
  if [ "$CAND_N" = "1" ]; then
    MEM="$CANDS/memory"
    MEM_FALLBACK=yes
  fi
fi

echo "MEMORY_DIR=$MEM"
echo "MEMORY_DIR_FALLBACK=$MEM_FALLBACK"
echo "MEMORY_EXISTS=$([ -d "$MEM" ] && echo yes || echo no)"
echo "HANDOFF_FILE=$MEM/handoff-active.md"
echo "HANDOFF_PENDING=$([ -f "$MEM/handoff-active.md" ] && echo yes || echo no)"
echo "CWD=$CWD"
[ "${1:-}" = "--paths" ] && exit 0

# ── 메모리 인덱스 ────────────────────────────────────────
# MEMORY.md 는 매 세션 자동 로드되므로 크기가 곧 고정 비용이다.
# MEMORY_LINES 만 임계가 걸린 신호이고, 나머지는 사람이 보고 판단할 참고값이다.
IDX="$MEM/MEMORY.md"
if [ -f "$IDX" ]; then
  # grep -c 는 0건이어도 "0" 을 찍고 exit 1 이라, `|| echo 0` 을 붙이면 0 이 두 번 나온다.
  idx_lines="$(grep -c '^- \[' "$IDX" 2>/dev/null || true)"
  echo "MEMORY_LINES=${idx_lines:-0}"
  echo "MEMORY_BYTES=$(wc -c < "$IDX" | tr -d ' ')"
  # 줄 길이는 바이트가 아니라 문자로 센다 — 한글 1자가 3바이트라 바이트로 재면 3배로 부풀려진다.
  # wc -m 이 문자를 세고, awk length() 는 로케일과 무관하게 바이트를 세므로 쓰지 않는다.
  longest=0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    c=$(printf '%s' "$line" | wc -m | tr -d ' ')
    [ "$c" -gt "$longest" ] && longest=$c
  done <<EOF
$(grep '^- \[' "$IDX" 2>/dev/null)
EOF
  echo "MEMORY_LONGEST_CHARS=$longest"
else
  echo "MEMORY_LINES=0"
  echo "MEMORY_BYTES=0"
  echo "MEMORY_LONGEST_CHARS=0"
fi

if [ -d "$MEM" ]; then
  echo "MEMORY_FILES=$(find "$MEM" -maxdepth 1 -name '*.md' ! -name 'MEMORY.md' 2>/dev/null | wc -l | tr -d ' ')"
  echo "--- STALE_30D (30일 이상 미수정 — 정리 후보) ---"
  find "$MEM" -maxdepth 1 -name '*.md' ! -name 'MEMORY.md' ! -name 'handoff-active.md' -mtime +30 2>/dev/null \
    | sort | while read -r f; do echo "  $(basename "$f")  ($(mtime_date "$f"))"; done
fi

# ── git 상태 ─────────────────────────────────────────────
if git rev-parse --git-dir >/dev/null 2>&1; then
  echo "BRANCH=$(git branch --show-current 2>/dev/null)"
  echo "HEAD_SHA=$(git rev-parse --short HEAD 2>/dev/null)"
  echo "HEAD_MSG=$(git log -1 --pretty=%s 2>/dev/null)"
  echo "DIRTY_COUNT=$(git status --porcelain | wc -l | tr -d ' ')"
  echo "STASH_COUNT=$(git stash list | wc -l | tr -d ' ')"
  echo "WORKTREE_COUNT=$(git worktree list 2>/dev/null | wc -l | tr -d ' ')"
  # 상태 코드를 그대로 남긴다. 화이트리스트로 거르면 삭제( D)·add 후 재수정(AM)·rename(R )이
  # 빠져 "미커밋 파일이 빠짐없이 적혔는가" 체크리스트가 조용히 통과한다.
  echo "--- MODIFIED (tracked) ---"
  git status --porcelain | grep -v '^??' || true
  echo "--- UNTRACKED ---"
  git status --porcelain | grep '^??' | sed 's/^...//' || true
else
  echo "BRANCH=(git 아님)"
fi
