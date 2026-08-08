#!/usr/bin/env bash
# 현재 저장소의 .git/hooks/pre-push 에 pre-push 게이트를 설치한다.
#
#   사용법: install-hook.sh [--force]
#   종료코드: 0 설치함/이미 최신 · 1 오류·중단 · 2 다름(확인 필요)
#
# 자동으로 덮지 않는다. 남의 훅이면 멈추고, 우리 것이라도 내용이 다르면 2 를 내고 멈춘다.

set -uo pipefail

MARKER='# managed by team-push-gate'
SRC="$(cd "$(dirname "$0")/.." && pwd)/templates/pre-push"
FORCE="${1:-}"

say() { printf '%s\n' "$*"; }

if [ ! -f "$SRC" ]; then
  say "❌ 원본을 찾을 수 없습니다: $SRC"
  say "   team-push-gate 플러그인이 온전히 설치되지 않았습니다."
  exit 1
fi

# worktree 에서는 --git-dir 이 .git/worktrees/<name> 을 가리키지만
# git 은 훅을 공통 디렉토리에서 찾는다. 반드시 --git-common-dir 을 써야 한다.
GIT_DIR=$(git rev-parse --git-common-dir 2>/dev/null)
if [ -z "${GIT_DIR:-}" ]; then
  say "❌ 여기는 git 저장소가 아닙니다. 설치할 저장소 안에서 실행하세요."
  exit 1
fi

DEST="$GIT_DIR/hooks/pre-push"
HOOKS_PATH=$(git config --get core.hooksPath 2>/dev/null || true)

warn_hooks_path() {
  [ -z "${HOOKS_PATH:-}" ] && return 0
  say ""
  say "⚠️  이 저장소는 core.hooksPath 가 '$HOOKS_PATH' 로 설정돼 있습니다."
  say "    git 은 그 디렉토리만 보므로 방금 설치한 $DEST 는 실행되지 않습니다."
  say "    걸리게 하려면 훅을 '$HOOKS_PATH' 에 두거나 그 설정을 해제해야 합니다."
  say "    (설정을 해제하면 그쪽 훅이 전부 죽습니다 — 직접 확인하고 결정하세요)"
}

if [ -e "$DEST" ]; then
  if ! grep -qF "$MARKER" "$DEST"; then
    say "❌ 이미 다른 pre-push 훅이 있습니다: $DEST"
    say "   team-push-gate 가 설치한 것이 아니므로 덮지 않습니다."
    say "   내용을 확인하고 직접 합치거나 옮긴 뒤 다시 실행하세요."
    exit 1
  fi
  if cmp -s "$SRC" "$DEST"; then
    say "✅ 이미 최신입니다: $DEST"
    warn_hooks_path
    exit 0
  fi
  if [ "$FORCE" != "--force" ]; then
    say "⚠️  설치된 훅이 원본과 다릅니다: $DEST"
    say "--- 설치된 것(왼쪽) vs 원본(오른쪽) ---"
    diff "$DEST" "$SRC"
    say "--- 갱신하려면 --force 로 다시 실행하세요 ---"
    exit 2
  fi
fi

mkdir -p "$(dirname "$DEST")"
cp "$SRC" "$DEST" || { say "❌ 복사에 실패했습니다: $DEST"; exit 1; }
chmod +x "$DEST" || { say "❌ 실행권한을 줄 수 없습니다: $DEST"; exit 1; }

say "✅ 설치 완료 → $DEST"
warn_hooks_path
exit 0
