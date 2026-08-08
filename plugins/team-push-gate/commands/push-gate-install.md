---
description: 현재 저장소에 pre-push AI 리뷰 게이트를 설치한다 (.git/hooks/pre-push)
allowed-tools: Bash(find:*), Bash(bash:*), Read
---

# push-gate-install

현재 저장소의 `.git/hooks/pre-push` 에 push 전 AI 리뷰 게이트를 설치한다.
판정은 전부 `scripts/install-hook.sh` 가 한다 — **이 문서에서 직접 파일을 복사하지 마라.**

## 절차

### 1. 설치 스크립트를 찾는다

```bash
find "$HOME/.claude/plugins" -path '*team-push-gate/scripts/install-hook.sh' 2>/dev/null | head -1
```

비어 있으면 플러그인이 제대로 설치되지 않은 것이다. 사용자에게 알리고 중단한다.

### 2. 실행한다

```bash
bash <찾은 경로>
```

### 3. 종료코드에 따라 분기한다

| 코드 | 할 일 |
|---|---|
| 0 | 4번으로 간다 |
| 1 | **중단한다.** 스크립트 출력을 그대로 보여준다. 남의 훅이 있는 경우이므로 사용자가 직접 판단해야 한다 |
| 2 | 스크립트가 낸 diff 를 보여주고 **갱신할지 묻는다.** 승인하면 `bash <경로> --force` 로 다시 실행한 뒤 4번으로 간다. 거절하면 그대로 끝낸다 |

**어떤 경우에도 `CLAUDE.md` 를 비롯한 저장소 파일을 고치지 마라.** 훅은 각자 머신에 설치하는
것이라, 공유 문서에 "이 저장소의 push 는 게이트를 탄다"고 적으면 설치하지 않은 동료에게 거짓이 된다.

### 4. 설치 후 안내

스크립트 출력(`core.hooksPath` 경고 포함)을 보여준 뒤, 아래를 덧붙인다:

> - 이 훅은 **이 저장소에만** 설치됐습니다. 다른 저장소·다른 사람에게는 없습니다.
> - push 할 때 리뷰가 돌며 **최대 350초**까지 걸립니다.
> - **fail-closed** 입니다 — 리뷰를 못 돌리거나 판정을 못 얻으면 통과가 아니라 **막힙니다.**
> - 우회: `SKIP_AI_REVIEW=1 git push` 또는 `git push --no-verify`

## 체크리스트

- [ ] `install-hook.sh` 를 찾아서 실행했다 (직접 복사하지 않았다)
- [ ] 종료코드 1 이면 중단했다
- [ ] 종료코드 2 이면 사용자에게 묻고, 승인받은 경우에만 `--force` 를 붙였다
- [ ] 저장소 파일을 고치지 않았다
- [ ] 350초·fail-closed·우회 방법을 안내했다
