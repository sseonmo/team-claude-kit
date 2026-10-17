# team-perf-loop

측정 기반 **자율 최적화 루프**. karpathy/autoresearch 의 "고치고 → 재고 → 나으면 남긴다" 를
라운드마다 후보 여러 개로 돌린다. 원형은 FinSight 의 Lighthouse 루프다.

## 문제

에이전트에게 "성능 올려줘" 라고 하면 고친 것과 잰 것과 판단한 것이 전부 한 머릿속에서 일어난다.
점수가 노이즈로 오른 것인지, 화면을 망가뜨리고 오른 것인지, 두 변경 중 무엇이 효과였는지 알 수 없다.

## 해결

```
[기준선] 엔진: build → 기준 화면 촬영(연속 2회 일치) → 측정
   ▼  가설 = 측정기가 준 개선 기회 중 절감이 큰 순 (실패 2회 가설은 제외)
[라운드] 후보 A·B·C — 각자 worktree 에서 가설 하나만 겨냥한 커밋 1개
   ▼
   엔진(직렬): 경로 검사 → preflight → 검사 → build → 검사 → 서버 { 관문 → 측정 }
   → 기준선 + minGain 이상이고 가드가 떨어지지 않은 후보 중 최고 1개만 ff-merge
   → .perf-loop/results.tsv 에 기록·커밋
```

- **판정은 LLM 이 하지 않는다.** 비교·가드·종료·가설 선택은 `engine/judge.mjs` 의 순수 함수다
- **환경 오류는 멈추고, 후보 탓만 crash 로 기록한다.** 이력이 오염되면 멀쩡한 가설이 영구히 빠진다
- **스크린샷 관문** — 후보 화면이 기준과 픽셀 단위로 다르면 점수와 무관하게 `gate` 로 탈락한다
- **허용 경로 밖을 건드린 후보는 측정 없이 `scope` 로 탈락한다.** `.claude/`·`.perf-loop/` 는 항상 금지
- 병합·push 하지 않는다. keep 커밋은 루프 브랜치에만 남는다

## 사용법

```
/perf-loop-init      # 프로젝트당 1회
/perf-loop           # 한 회차 = 기준선 재측정 + 2라운드
/perf-loop 4         # 4라운드
```

**init** 은 스택을 판별해 `.claude/perf-loop.json`·`.claude/perf-loop/guide.md` 초안을 만들고, 승인받아 커밋한 뒤
측정 도구 설치 → 루프 브랜치·벤치 worktree → **실제 빌드·기동·로그인·촬영**까지 통과해야 끝난다.

**perf-loop** 는 사전 점검 → 기준 화면을 보여주고 승인 → 워크플로 → 결과 표. 회차 번호는 이력에서 자동으로 정한다.

## 설정 — `.claude/perf-loop.json`

| 키 | 뜻 |
|---|---|
| `build` · `server.start` · `server.port` | 빌드와 기동 명령. `{port}` 치환. 벤치를 cwd 로 `sh -c` |
| `server.readyPath` · `readyTimeoutSec` | 기동 판정 URL(응답만 오면 됨)·대기 시간. 후보 서버가 안 뜨면 crash |
| `preflight[]` | `{name, cmd, fix}` — 실패 = 환경 오류로 멈춤. `fix` 는 안내만 |
| `checks.beforeBuild` · `afterBuild` | lint·컴파일·테스트. 실패 = crash |
| `auth.cookieCmd` | stdout 에 `[{"name","value"}]`. 없으면 `null` |
| `measurer` | `{type: "lighthouse", runs, pages: [{path, auth}]}` |
| `gate` | `{type: "screenshots", screens, viewports?, freezeDateTz?}` 또는 `null` |
| `scope.allow` · `deny` | 후보가 고칠 수 있는 glob(`**`·`*`·`?`). deny 우선 |
| `thresholds` | `minGain` 1 · `target` 90 · `stallRounds` 5 · `maxRounds` 20 · `candidates` 3 |
| `copyFiles` · `setup` · `loopBranch` · `guide` | 벤치 준비와 후보 지침 |

템플릿: `templates/spring-thymeleaf.json`, `templates/nextjs.json`.

## 파일

| 위치 | 내용 |
|---|---|
| 벤치 `~/.cache/perf-loop/<저장소>-<해시>/bench` | 루프 브랜치 worktree. 측정은 여기서만 |
| 후보 `~/.cache/perf-loop/<저장소>-<해시>/cand/*` | 후보 worktree. 후보가 끝나면 지운다 |
| 도구 `~/.cache/perf-loop/tools` | lighthouse·chrome-launcher·puppeteer-core·sharp (버전 고정) |
| `.perf-loop/results.tsv` | 이력 — 루프 브랜치에만 커밋 |
| `.perf-loop/.local/` | best.json·로그·스크린샷(diff 는 다른 픽셀이 빨갛게) |

## 요구 사항

Node 22+, Chrome, git. 측정 도구는 init 이 설치한다(플러그인 캐시는 재클론되므로 그 안에 두지 않는다).

## 개발

```bash
node --test plugins/team-perf-loop/test/*.test.mjs
```

`examples/spring-thymeleaf/` 는 E2E 대상이다 — 일부러 느린 Spring Boot 4 + Thymeleaf + Security 앱.
`node make-assets.mjs` 로 무거운 리소스를 만든 뒤 별도 디렉터리에 복사해 `git init` 하고
`PERF_LOOP_ROOT=<이 디렉터리>` 로 init → perf-loop 를 돌린다.

설계·결정 근거: `docs/specs/2026-10-11-team-perf-loop-design.md`.
