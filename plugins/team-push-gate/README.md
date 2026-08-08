# team-push-gate

`git push` 전에 `claude` 로 코드 리뷰를 돌리고, 심각한 결함이면 **push 를 막는** git 훅.

> **훅을 나르는 플러그인이지, 훅을 거는 플러그인이 아니다.**
> Claude Code 플러그인은 git 훅을 설치할 수 없다. 이 플러그인은 스크립트를 나르고,
> `/push-gate-install` 이 그것을 저장소에 복사한다. **설치는 저장소마다 한 번씩 사람이 한다.**

## 설치

```
/push-gate-install
```

## 구성

| 종류 | 파일 | 하는 일 |
|---|---|---|
| 훅 | `templates/pre-push` | push 범위를 `/code-review` 로 검토하고 `VERDICT` 로 판정 |
| 스크립트 | `scripts/install-hook.sh` | 원본을 `.git/hooks/pre-push` 로 복사. 남의 훅은 덮지 않는다 |
| 커맨드 | `commands/push-gate-install.md` | 위 스크립트를 부르고 결과를 안내 |

## 동작

```
1. push 범위 계산 (새 브랜치면 merge-base 부터)
2. .md 만 바뀌었으면 스킵
3. claude -p "/code-review …" 실행 (최대 350초, bypassPermissions)
4. 출력에서 VERDICT: PASS | FAIL 을 읽어 판정
```

**fail-closed 다.** claude 를 못 찾음 · 실행 실패 · 타임아웃 · `VERDICT` 줄 없음 → **전부 차단.**
게이트가 조용히 무력화되는 것보다 시끄럽게 막히는 편이 낫다는 선택이다.

우회: `SKIP_AI_REVIEW=1 git push` 또는 `git push --no-verify`

## 알려진 한계

- **설치는 저장소마다 수동이다.** 설치하지 않은 저장소에는 게이트가 없다.
- **자동 갱신이 없다.** 원본을 고쳐도 설치된 사본은 그대로다. `/push-gate-install` 을 다시 부르면
  차이를 보여주고 갱신한다.
- **`core.hooksPath` 를 쓰는 저장소에서는 걸리지 않는다.** `husky`·`lefthook`·`pre-commit` 이
  이 설정을 박는다. git 은 그 디렉토리만 보므로 `.git/hooks/pre-push` 는 실행되지 않는다.
  설치 시 경고하지만 **해결은 사람이 한다** — 그 설정을 해제하면 그쪽 훅이 전부 죽기 때문이다.
- **`bypassPermissions` 로 리뷰어를 돌린다.** push 마다 그 머신의 도구 권한을 전부 준다.
  이게 없으면 "승인이 거부되어 확인하지 못했음" 수준의 리뷰만 나온다.
- **비용이 크다.** 리뷰 회당 중앙값 210초(실측 28건).
- **미탐을 잡지 못한다.** diff 에 없는 것은 리뷰에 없다.
- **`.md` 만 바뀐 push 는 스킵된다.** 문서 전용 push 에 350초를 태우지 않기 위한 **의도된 동작**이다.
  문서를 리뷰받고 싶으면 코드 변경과 같은 push 에 실어 보낸다.

## 테스트

```bash
npm test        # node --test test/*.test.mjs — 19건
```

훅은 스텁 `claude` 를 `CLAUDE_BIN` 으로 주입해 실제로 실행하며 검증한다.
`CLAUDE_BIN` 은 테스트 주입점이고, 지정됐는데 실행할 수 없으면 **막는다**(fail-closed).
