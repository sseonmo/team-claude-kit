# team-kit

팀 공용 Claude Code 플러그인 마켓플레이스.

| 플러그인 | 내용 |
|---|---|
| **team-wiki-kit** | LLM Wiki 운영 — `/wiki-init` + `wiki-ingest` · `wiki-lint` · `wiki-query` 스킬 |
| **team-repo-audit** | 레포 AI-readiness 감사 — `ai-readiness-cartography` 스킬 |

## 설치

### 팀원 개인 설치

```
/plugin marketplace add sseonmo/team-claude-kit
/plugin install team-wiki-kit@team-kit
/plugin install team-repo-audit@team-kit
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
    "team-repo-audit@team-kit": true
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

## 릴리스

플러그인을 고쳤으면 **반드시 두 곳의 `version` 을 같이 올린다**. 버전이 캐시 키라 안 올리면
팀원은 옛 버전을 계속 쓴다.

1. `plugins/<name>/.claude-plugin/plugin.json` 의 `version`
2. `.claude-plugin/marketplace.json` 의 해당 항목 `version`

## 호환성

`plugin.json` 에 `displayName` 필드를 넣지 않는다 — Claude Code v2.1.143 미만이 매니페스트를
거부한다. 팀원 CC 버전이 제각각인 동안은 넣지 말 것.
