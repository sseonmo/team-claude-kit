#!/usr/bin/env bash
# handoff 스킬 보조 — 현재 세션의 "기계적 상태"를 한 번에 수집한다.
# LLM 이 손으로 git 명령을 나열하다 빠뜨리는 것을 막기 위한 것이므로, 여기서는 판단하지 않고 사실만 찍는다.
# 임계 판정과 정리 제안 여부는 전부 SKILL.md 가 한다.
#
#   bash state.sh          # 상태 수집
#   bash state.sh --paths  # 경로만(빠름)
#   bash state.sh --verify # 저장된 handoff-active.md 를 기계 검증(저장 직후 필수)
#
# 메모리 디렉토리는 cwd 가 아니라 **세션 ID 로 찾은 트랜스크립트의 부모**로 정한다.
# 그래서 `cd` 한 뒤 실행해도 같은 프로젝트를 본다(출처는 MEMORY_DIR_SOURCE 가 밝힌다).
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

# 파일이 며칠 묵었는지. `find -mtime` 은 하루씩 되짚어야 해서 느리므로 epoch 으로 뺀다.
age_days() {
  local e now
  [ -f "$1" ] || { printf '%s' '-'; return; }
  e="$(stat -c '%Y' "$1" 2>/dev/null)"
  [ -n "$e" ] || e="$(stat -f '%m' "$1" 2>/dev/null)"
  [ -n "$e" ] || { printf '%s' '?'; return; }
  now="$(date +%s)"
  printf '%s' "$(( (now - e) / 86400 ))"
}

# ── 프로젝트 메모리 디렉토리 찾기 ─────────────────────────
# Claude Code 규칙: cwd 의 `/` `_` `.` 를 `-` 로 바꾼 것이 ~/.claude/projects/ 아래 디렉토리명.
slug_of() { printf '%s' "$1" | sed -e 's#[/_.]#-#g'; }

CWD="$(pwd)"
MEM_CALC="$HOME/.claude/projects/$(slug_of "$CWD")/memory"
MEM="$MEM_CALC"
MEM_SOURCE=cwd

# ① 세션 앵커 — cwd 가 세션을 띄운 위치와 다르면 위 계산은 **조용히 틀린다.**
# 스킬이 `cd` 한 뒤 실행되면(플러그인 개발·워크트리·하위 디렉토리 탐색) 슬러그가 달라져,
# 진행 중인 인계가 있는데도 `HANDOFF_STATE=none` 이 나온다. 그러면 저장 모드가 엉뚱한
# 디렉토리에 새 인계를 쓰고 진짜 인계는 방치되며, `--verify` 도 **같은 틀린 경로**를 보므로
# `VERIFY_RESULT=pass` 가 찍힌다 — 자기검증이 성립하지 않는 지점이다.
# Claude Code 는 세션 트랜스크립트를 **자기가 고른 슬러그 디렉토리**에 쓰므로,
# 슬러그 규칙을 재현하지 말고 그 실물의 부모 디렉토리명을 정답으로 삼는다.
# (`CLAUDE_PROJECT_DIR` 은 훅에서만 설정되고 스킬 실행 시에는 unset 이라 쓸 수 없다.)
if [ -n "${CLAUDE_CODE_SESSION_ID:-}" ]; then
  _jsonl="$(find "$HOME/.claude/projects" -maxdepth 2 -name "$CLAUDE_CODE_SESSION_ID.jsonl" 2>/dev/null | head -1)"
  if [ -n "$_jsonl" ]; then
    MEM="$(dirname "$_jsonl")/memory"
    MEM_SOURCE=session
  fi
fi

# ② 앵커도 없고(세션 밖 실행·트랜스크립트 만료) 계산한 경로도 없으면 basename 으로 찾는다.
# 단 접미사가 정확히 `-<BASE>` 인 후보가 **유일할 때만** 채택한다.
# 느슨한 glob(`*BASE`)으로 head -1 을 집으면 basename 만 같은 무관한 프로젝트가 걸린다 —
# 그 경우 남의 메모리에 인계를 쓰거나, 현재 프로젝트의 MEMORY.md 가 자동 로드되지 않아
# 이 스킬의 핵심 메커니즘(대기 포인터)이 조용히 죽는다. 애매하면 채택하지 않는 쪽이 맞다.
if [ "$MEM_SOURCE" = "cwd" ] && [ ! -d "$MEM" ]; then
  BASE="$(basename "$CWD" | sed -e 's#[_.]#-#g')"
  CANDS="$(ls -1d "$HOME/.claude/projects/"*"-$BASE" 2>/dev/null)"
  CAND_N="$(printf '%s' "$CANDS" | grep -c . || true)"
  if [ "$CAND_N" = "1" ]; then
    MEM="$CANDS/memory"
    MEM_SOURCE=basename
  fi
fi

# FALLBACK 은 "추정이라 사람이 확인해야 한다"는 신호다. 세션 앵커는 추정이 아니라 실물이고,
# basename 추정이라도 결과가 cwd 계산값과 **같으면** 추정한 바가 없으므로 켜지 않는다.
MEM_FALLBACK=no
if [ "$MEM_SOURCE" = "basename" ] && [ "$MEM" != "$MEM_CALC" ]; then MEM_FALLBACK=yes; fi

echo "MEMORY_DIR=$MEM"
echo "MEMORY_DIR_SOURCE=$MEM_SOURCE"
echo "MEMORY_DIR_FALLBACK=$MEM_FALLBACK"
echo "MEMORY_EXISTS=$([ -d "$MEM" ] && echo yes || echo no)"
echo "HANDOFF_FILE=$MEM/handoff-active.md"
echo "HANDOFF_PENDING=$([ -f "$MEM/handoff-active.md" ] && echo yes || echo no)"
# 인계의 나이는 재개 모드가 가장 먼저 알아야 할 값이다 — 오래된 인계일수록 본문이 현재 repo 와
# 어긋나 있고(원칙 4), 며칠씩 방치된 것은 이미 해소됐을 수도 있다. STALE_30D 는 인계 파일을
# 명시적으로 제외하므로(정리 후보로 오인돼 삭제되면 안 된다) 여기서 따로 찍는다.
echo "HANDOFF_AGE_DAYS=$(age_days "$MEM/handoff-active.md")"

# 이 스킬의 실제 대기 신호는 파일이 아니라 **인덱스의 포인터 한 줄**이다.
# 새 세션이 자동으로 읽는 것은 MEMORY.md 뿐이므로, 파일만 있고 포인터가 없으면 인계는 100% 실패한다.
# 그런데 그 실패는 "사용자가 /handoff 를 칠 이유를 모른다"는 형태로 나타나 영영 발견되지 않는다.
# 그래서 둘을 따로 재고, 조합을 HANDOFF_STATE 한 값으로 내려준다.
_ho="$MEM/handoff-active.md"
# 줄 시작에 `^- [` 앵커를 건다 — 산문 속 인라인 언급("…의 ](handoff-active.md) 포인터가 없으면")이
# 포인터로 오인되는 것을 막는다. 코드펜스 안의 형식 예시까지 막지는 **못한다**(그 줄도 `- [` 로
# 시작한다) — 다만 MEMORY.md 는 한 줄짜리 인덱스라 코드펜스가 들어갈 자리가 아니라 감수한다.
# 주제까지 대조하지는 않는다. 정상적인 요약 변형을 FAIL 로 잡으면 이 신호를 믿을 수 없게 된다.
_ptr=no
[ -f "$MEM/MEMORY.md" ] && grep -q '^- \[.*](handoff-active\.md)' "$MEM/MEMORY.md" 2>/dev/null && _ptr=yes
echo "INDEX_PTR=$_ptr"
if [ -f "$_ho" ] && [ "$_ptr" = "yes" ]; then echo "HANDOFF_STATE=pending"
elif [ -f "$_ho" ]; then                      echo "HANDOFF_STATE=orphan"
elif [ "$_ptr" = "yes" ]; then                echo "HANDOFF_STATE=ghost"
else                                          echo "HANDOFF_STATE=none"; fi
echo "CWD=$CWD"
# 세션 앵커가 cwd 계산값과 갈리면, 메모리는 세션 프로젝트를 보는데 **아래 git 상태는 이 cwd 의
# repo** 를 본다. 둘이 다른 저장소일 수 있으므로(플러그인 개발 중 흔하다) 그 사실을 밝힌다.
# 굳이 세션 디렉토리로 되돌리지는 않는다 — 지금 작업 중인 repo 의 상태야말로 인계에 필요하다.
if [ "$MEM_SOURCE" = "session" ] && [ "$MEM" != "$MEM_CALC" ]; then
  echo "CWD_MOVED=yes"
else
  echo "CWD_MOVED=no"
fi
[ "${1:-}" = "--paths" ] && exit 0

# ── --verify: 저장 직후 자기검증 ──────────────────────────
# 저장 모드의 체크리스트는 전부 LLM 자기보고라, 지키지 않아도 아무도 모른다.
# 실제로 지켜지지 않은 항목(특히 "다음 단계 1 = 실행 명령")이 반복 관측됐다.
# 그래서 기계로 셀 수 있는 것만 여기서 센다. 판정은 pass/fail 로 명확히 낸다.
if [ "${1:-}" = "--verify" ]; then
  HO="$MEM/handoff-active.md"
  fail=0
  if [ ! -f "$HO" ]; then
    echo "VERIFY_FILE=FAIL — 저장된 handoff-active.md 가 없다"
    echo "VERIFY_RESULT=fail"; exit 1
  fi
  echo "VERIFY_FILE=ok"

  # ① 인덱스 포인터 — 이게 없으면 새 세션은 인계를 발견하지 못한다(치명)
  if [ "$_ptr" = "yes" ]; then
    echo "VERIFY_INDEX_PTR=ok"
  else
    echo "VERIFY_INDEX_PTR=FAIL — MEMORY.md 에 ](handoff-active.md) 포인터가 없다"
    fail=1
  fi

  # ② 필수 섹션 — 이모지·괄호 표기가 흔들려도 걸리도록 핵심어로만 찾는다
  miss=""
  for sec in "지금 무엇을 하는 중인가" "다음 단계" "하지 말 것" "확인된 사실" "결정 대기" "상태"; do
    grep -q "^## .*$sec" "$HO" || miss="$miss $sec"
  done
  if [ -z "$miss" ]; then
    echo "VERIFY_SECTIONS=ok"
  else
    echo "VERIFY_SECTIONS=FAIL — 누락:$miss"
    fail=1
  fi

  # ③ "다음 단계 1" 이 실행 명령인가 — 다음 세션이 첫 명령을 바로 칠 수 있어야 한다.
  #    1 항목은 여러 줄에 걸치므로 `1.` 부터 `2.` 직전까지를 한 덩어리로 본다.
  step1="$(awk '/^## .*다음 단계/{f=1;next} f&&/^## /{exit} f' "$HO" \
         | awk '/^[[:space:]]*1\./{g=1} g&&/^[[:space:]]*2\./{exit} g')"
  if printf '%s' "$step1" | grep -q '`'; then
    echo "VERIFY_STEP1_CMD=ok"
  else
    echo "VERIFY_STEP1_CMD=FAIL — '다음 단계 1' 에 실행 명령(백틱)이 없다"
    fail=1
  fi

  # ④ 미커밋 수 대조 — 본문이 실제와 어긋나면 다음 세션이 작업을 잃는다
  if git rev-parse --git-dir >/dev/null 2>&1; then
    now="$(git status --porcelain | wc -l | tr -d ' ')"
    # frontmatter 의 description 에도 "미커밋" 이 흔히 들어가므로 파일 전체를 훑으면
    # 제목의 일련번호가 개수로 잘못 잡힌다. "## 상태" 섹션 안에서만 센다.
    # 제목이 `## 현재 상태`·`## 📊 상태` 로 흔들려도 잡는다. `^## 상태` 로 못 박으면
    # VERIFY_SECTIONS 는 ok 인데 VERIFY_DIRTY 만 FAIL 이 나고, 메시지가 원인을 가리키지 않는다.
    said="$(awk '/^## .*상태/{f=1;next} f&&/^## /{exit} f' "$HO" \
          | grep -m1 '미커밋' | grep -oE '[0-9]+' | head -1)"
    if [ -z "$said" ]; then
      echo "VERIFY_DIRTY=FAIL — 본문에 미커밋 수가 없다(실제 $now)"; fail=1
    elif [ "$said" = "$now" ]; then
      echo "VERIFY_DIRTY=ok ($now)"
    else
      echo "VERIFY_DIRTY=FAIL — 본문 $said · 실제 $now"; fail=1
    fi
  else
    echo "VERIFY_DIRTY=skip (git 아님)"
  fi

  [ "$fail" = "0" ] && echo "VERIFY_RESULT=pass" || echo "VERIFY_RESULT=fail"
  exit "$fail"
fi

# ── 메모리 인덱스 ────────────────────────────────────────
# MEMORY.md 는 매 세션 자동 로드되므로 크기가 곧 고정 비용이다.
# MEMORY_LINES 만 임계가 걸린 신호이고, 나머지는 사람이 보고 판단할 참고값이다.
IDX="$MEM/MEMORY.md"
if [ -f "$IDX" ]; then
  # grep -c 는 0건이어도 "0" 을 찍고 exit 1 이라, `|| echo 0` 을 붙이면 0 이 두 번 나온다.
  idx_lines="$(grep -c '^- \[' "$IDX" 2>/dev/null || true)"
  echo "MEMORY_LINES=${idx_lines:-0}"
  echo "MEMORY_BYTES=$(wc -c < "$IDX" | tr -d ' ')"
  # 줄 길이는 바이트가 아니라 문자로 세려는 것이다 — 한글 1자가 3바이트라 바이트로 재면 3배가 된다.
  # 다만 `wc -m` 이 문자를 세는 것은 **로케일이 UTF-8 일 때뿐**이고, LC_ALL=C 면 바이트를 센다
  # (한글 8자 → 9 vs 25). 임계가 걸린 신호가 아니라 사람이 눈으로 보는 참고값이라 보정하지 않는다.
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
  # detached HEAD 에서 --show-current 는 빈 문자열이라 `BRANCH=` 만 남고,
  # 인계 본문의 "브랜치:" 가 공란으로 찍혀 다음 세션이 어디에 서 있는지 알 수 없게 된다.
  _br="$(git branch --show-current 2>/dev/null)"
  [ -n "$_br" ] || _br="(detached @ $(git rev-parse --short HEAD 2>/dev/null))"
  echo "BRANCH=$_br"
  # 어느 저장소의 상태인지 밝힌다 — CWD_MOVED=yes 면 세션 프로젝트와 다른 repo 일 수 있다.
  echo "GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)"
  echo "HEAD_SHA=$(git rev-parse --short HEAD 2>/dev/null)"
  echo "HEAD_MSG=$(git log -1 --pretty=%s 2>/dev/null)"
  echo "DIRTY_COUNT=$(git status --porcelain | wc -l | tr -d ' ')"
  echo "STASH_COUNT=$(git stash list | wc -l | tr -d ' ')"
  # `git worktree list` 는 메인 체크아웃도 세므로 추가 워크트리가 없어도 1 이 나온다.
  # 숫자만 −1 하면, 그동안 오프셋을 손으로 보정해 온 모델이 이중 보정해 워크트리 1개를
  # "없음"으로 쓴다. 그래서 **이름을 함께 바꿔** 의미가 달라졌다는 것을 드러낸다.
  _wt="$(git worktree list 2>/dev/null | wc -l | tr -d ' ')"
  echo "WORKTREE_OTHERS=$([ "${_wt:-0}" -gt 0 ] && echo $((_wt - 1)) || echo 0)"
  # 상태 코드를 그대로 남긴다. 화이트리스트로 거르면 삭제( D)·add 후 재수정(AM)·rename(R )이
  # 빠져 "미커밋 파일이 빠짐없이 적혔는가" 체크리스트가 조용히 통과한다.
  echo "--- MODIFIED (tracked) ---"
  git status --porcelain | grep -v '^??' || true
  # 미추적 항목이 디렉토리면 git 은 한 줄로 접어 보여준다(`?? .claude/worktrees/`).
  # 그 한 줄이 DIRTY_COUNT 에서도 1 로 세어지므로, 안에 몇 개가 들었는지 모르면 "미커밋 1개" 로
  # 요약돼 수백 개의 파일이 통째로 인계에서 사라진다. 그래서 **표시만** 덧붙인다 —
  # DIRTY_COUNT 는 git 의 셈 그대로 둔다(--verify 가 본문과 대조하는 값이라 정의가 흔들리면 안 된다).
  echo "--- UNTRACKED ---"
  git status --porcelain | grep '^??' | sed 's/^...//' | while IFS= read -r p; do
    if [ -d "$p" ]; then
      echo "$p  ($(find "$p" -type f 2>/dev/null | wc -l | tr -d ' ') files)"
    else
      echo "$p"
    fi
  done
else
  echo "BRANCH=(git 아님)"
fi
