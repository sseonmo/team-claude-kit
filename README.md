# team-kit

팀 공용 Claude Code 플러그인 마켓플레이스.

| 플러그인 | 내용 |
|---|---|
| **team-wiki-kit** | LLM Wiki 운영 — `/wiki-init` + `wiki-ingest` · `wiki-lint` · `wiki-query` 스킬 |
| **team-repo-audit** | 레포 AI-readiness 감사 — `ai-readiness-cartography` 스킬 |
| **team-tdd-kit** | 테스트 없는 구현 파일의 작성·수정 차단 (Java·Python·Node) — `PreToolUse[Edit\|Write]` hook |
| **team-guardrails** | 되돌릴 수 없는 위험 명령 차단 — `PreToolUse[Bash]` hook (프로젝트 밖 `rm -rf` · force push) |
| **team-push-gate** | push 전 AI 코드 리뷰 게이트 — `/push-gate-install` 로 `.git/hooks/pre-push` 설치 |
| **team-handoff** | `/clear` 를 건너뛰는 작업 인계 — `/handoff` 하나로 저장·재개 |
| **team-plan-verify** | 계획을 네 관점(사용자·엔지니어·실패/보안·과잉)으로 순차 검증 — `/plan-verify` |
| **team-security-scan** | OWASP Top 10:2025 보안 감사 — `owasp-scan` 스킬, 검증 통과분만 담은 HTML 리포트 |

## 설치

### 팀원 개인 설치

```
/plugin marketplace add sseonmo/team-claude-kit
/plugin install team-wiki-kit@team-kit
/plugin install team-repo-audit@team-kit
/plugin install team-tdd-kit@team-kit
/plugin install team-guardrails@team-kit
/plugin install team-push-gate@team-kit
/plugin install team-handoff@team-kit
/plugin install team-plan-verify@team-kit
/plugin install team-security-scan@team-kit
```

private 레포이므로 팀원은 `sseonmo/team-claude-kit` 에 대한 GitHub 접근 권한과
로컬 git 인증(HTTPS credential helper 또는 SSH 키)이 있어야 한다.

### 프로젝트 단위 자동 배포 (권장)

프로젝트 레포의 `.claude/settings.json` 에 아래를 커밋한다. 팀원은 clone 후 Claude Code를
열기만 하면 자동으로 설치·활성화된다.

```json
{
  "extraKnownMarketplaces": {
    "team-kit": {
      "source": { "source": "github", "repo": "sseonmo/team-claude-kit" },
      "autoUpdate": true
    }
  },
  "enabledPlugins": {
    "team-wiki-kit@team-kit": true,
    "team-repo-audit@team-kit": true,
    "team-tdd-kit@team-kit": true,
    "team-guardrails@team-kit": true,
    "team-push-gate@team-kit": true,
    "team-handoff@team-kit": true,
    "team-plan-verify@team-kit": true,
    "team-security-scan@team-kit": true
  }
}
```

`source` 는 호스팅에 따라 셋 중 하나를 쓴다:

| 방식 | source |
|---|---|
| GitHub (private 포함) | `{"source":"github","repo":"org/repo"}` |
| 사내 Git (GitLab 등) | `{"source":"url","url":"https://git.corp/team-kit.git"}` |
| 모노레포 내장 | `{"source":"directory","path":"./tools/team-kit"}` |

## 사용

### team-wiki-kit

```
/wiki-init 읽은 아티클에서 나온 개념을 누적하는 위키
```

이후 `raw/<소스명>/script.md` 에 소스를 넣고:

- "ep01 넣어줘" → `wiki-ingest`
- "점검해줘" → `wiki-lint`
- 위키 내용에 대한 질문 → `wiki-query`

세 스킬은 `WIKI_SCHEMA.md` + `wiki/` + `raw/` 구조를 전제로 한다. 없으면 `/wiki-init` 을 먼저 돌린다.

### team-repo-audit

```
이 레포 AI-readiness 점수 매겨줘
```

`docs/ai-readiness-map.html` (대시보드) + `ai-readiness-score.json` (원자료) + ROI 순 액션 리스트를 산출한다.
Python 3.10+ 만 있으면 되고 외부 의존성은 없다.

### team-tdd-kit

설치하면 바로 동작한다. 명령어 없음 — `Edit`/`Write` 마다 자동으로 걸린다.

```
lib/slugify.ts 작성 시도  → 차단 (테스트 없음)
lib/slugify.test.ts 작성  → 통과
lib/slugify.ts 재시도     → 통과
```

Java · Python · Node 를 지원하며 각 언어의 테스트 관례를 따로 인정한다(Java 는 `src/main` ↔ `src/test`
미러링, Python 은 `test_x.py`·`tests/`, Node 는 `*.test.*`·`__tests__/`). 그 외 언어는 검사하지 않는다.

**신규·기존을 가리지 않는다** — 이미 있는 파일을 고칠 때도 테스트가 없으면 막힌다. 그래서 테스트 없는
레거시는 테스트를 먼저 쓰기 전까지 손댈 수 없다(의도된 마찰). Node 예외 목록이
**Next.js 레이아웃을 가정**하므로(`components/` 는 통째로 예외,
로직은 `lib/` 에 둔다는 전제) 다른 구조라면 `lib/tdd-rules.mjs` 의 `NODE_EXEMPT_DIRS` 를 조정해서 쓴다.
`Edit|Write` 에 훅을 거는 다른 TDD 플러그인과 함께 켜면 둘 다 발동한다.

### team-guardrails

설치하면 바로 동작한다. 명령어 없음 — `Bash` 호출마다 자동으로 걸린다.
`jq` 도 필요 없다(Node 내장만 쓴다).

```
rm -rf node_modules   → 통과   (프로젝트 안이면 막지 않는다)
rm -rf ~              → 차단
cd /tmp && rm -rf /   → 차단
git push -f           → 차단
git push --force-with-lease → 통과
echo "rm -rf /"       → 통과   (정규식 훅이 막던 오탐)
```

**대상 경로를 보고 판정하므로** `rm -rf` 를 무조건 막는 방식과 달리 정상적인 빌드 정리를
방해하지 않는다. 변수 치환·스크립트 경유 같은 우회는 **의도적으로 통과시킨다** —
실수를 막는 장치이지 악의를 막는 장치가 아니다. 자세한 것은 플러그인 README 참조.

### team-push-gate

설치해도 바로 걸리지 않는다. **저장소마다 한 번씩** 실행해야 한다.

```
/push-gate-install
```

`.git/hooks/pre-push` 에 훅을 복사한다. 남의 훅이 이미 있으면 덮지 않고 멈추고,
우리가 설치한 것이라도 내용이 다르면 diff 를 보여주고 확인을 받는다.

```
git push            → 리뷰가 돈다 (최대 350초)
SKIP_AI_REVIEW=1 git push   → 건너뛴다
git push --no-verify        → 건너뛴다
```

**fail-closed 다.** claude 를 못 찾음 · 실행 실패 · 타임아웃 · `VERDICT` 줄 없음 → 전부 차단.
`.md` 만 바뀐 push 는 리뷰를 건너뛴다(의도된 동작).
`core.hooksPath` 를 쓰는 저장소(husky·lefthook 등)에서는 걸리지 않으며, 설치할 때 그 사실을 경고한다.

### team-handoff

```
/handoff        → 저장 (그다음 /clear 는 직접 입력)
/handoff        → 재개
```

명령은 하나다. 저장이냐 재개냐는 스킬이 판정하므로 문구를 외울 필요가 없다.

저장하면 프로젝트 메모리에 인계 파일을 쓰고 **자동 로드되는 `MEMORY.md` 에 대기 포인터를 심는다** —
그래서 새 세션이 스스로 "인계받을 작업이 있다"를 안다. 요약이 아니라 **재개 지시서**를 쓰므로
다음 세션이 첫 명령을 바로 칠 수 있다.

재개하면 기록을 현재 repo 와 대조하고, 어긋나면 파일이 아니라 현실을 믿고 그 사실을 알린다.
작업이 끝나면 기존 메모리 **갱신을 신설보다 우선**해 인덱스가 순증하지 않게 한다.

`/clear` 자체는 CLI 동작이라 스킬이 실행할 수 없다 — 그 한 번만 직접 입력한다.

### team-plan-verify

```
/plan-verify                 # 대상을 스스로 찾고 규모를 판정
/plan-verify docs/design.md  # 문서 지정
/plan-verify feature         # 규모 강제 (full | feature)
```

렌즈 넷이 **서로의 영역을 침범하지 않고** 순서대로 돈다 — 사용자 → 엔지니어 → 실패/보안 → 과잉.
같은 각도로 여러 번 보면 같은 것만 잡히기 때문이다. 사용자 렌즈만이 **기능이 통째로 없는 것**을
잡고, 과잉 렌즈는 **앞선 셋이 추가한 것**을 재심사한다(아무것도 덜어내지 못하면 그 라운드는 실패).

**대상이 파일이 아니어도 된다.** 플래닝 직후가 검증하기 가장 좋은 시점인데 그때는 문서가 없다 —
대화로만 합의한 계획이면 한 벌로 정리해 고정한 뒤 검증에 들어간다.
검증 중에는 파일을 쓰지 않고, 발견을 모아 승인 후 일괄 반영한다.

### team-security-scan

```
/owasp-scan
```

"이 레포 보안 점검해줘", "릴리스 전에 취약점 스캔" 처럼 말해도 걸린다.
`.security/owasp-<날짜>.html` 에 단일 파일 대시보드를 남긴다.

A01~A10 을 서브에이전트 열 개로 나눠 훑고, `critical`·`high` 는 **반박 검증**을 거쳐
기각된 것은 리포트에 넣지 않는다. 항목마다 "있어야 할 것이 없는" **부재 점검**을 따로 지시한다 —
스킬 없이 돌렸을 때 완전히 놓친 3건이 전부 그 유형이었다(보안 로깅 전무·빈 `catch` fail-open·`DEBUG=true`).

**코드는 고치지 않는다.** 산출물은 리포트이고, 수정은 별도 작업으로 한다.
못 돌린 도구는 리포트에 배너로 남는다 — **도구가 조용한 영역은 깨끗한 영역이 아니다**(실측 커버리지 약 1/3).
조립 스크립트는 Python 3 stdlib only.

## 참고 문서

| 문서 | 내용 |
|---|---|
| `docs/pr-review-architecture.html` | **PR 자동 리뷰**(GitHub Actions + `gpt-5` 5축 채점 → `risk:*` 라벨 → 조건부 자동 머지)의 구조·채점 기준 전문·점수 계산 예시·**다른 저장소 이식 절차**. 브라우저로 연다 |

위 문서가 다루는 것은 플러그인이 아니라 `yt-thumbnail-maker` 저장소의 `scripts/pr-review/` 구현이다.
같은 것을 플러그인으로 옮길지 검토하는 중이라 참고용으로 함께 둔다.

## 릴리스

플러그인을 고쳤으면 **반드시 두 곳의 `version` 을 같이 올린다**. 버전이 캐시 키라 안 올리면
팀원은 옛 버전을 계속 쓴다.

1. `plugins/<name>/.claude-plugin/plugin.json` 의 `version`
2. `.claude-plugin/marketplace.json` 의 해당 항목 `version`

## 호환성

`plugin.json` 에 `displayName` 필드를 넣지 않는다 — Claude Code v2.1.143 미만이 매니페스트를
거부한다. 팀원 CC 버전이 제각각인 동안은 넣지 말 것.
