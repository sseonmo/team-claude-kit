---
name: perf-loop
description: 성능 최적화 루프를 한 회차 실행한다 — 기준선 재측정 후 라운드마다 후보 에이전트 여러 개가 변경 하나씩을 만들고, 결정론적 측정으로 기준선보다 나은 최고 1개만 루프 브랜치에 keep 한다. "성능 최적화 루프 돌려줘", "perf-loop 실행", "lighthouse 루프 돌려", "/perf-loop 3" 류 요청에 사용. `.claude/perf-loop.json` 이 없는 프로젝트면 perf-loop-init 을 먼저 안내한다.
---

# perf-loop

이 스킬은 **사전 점검 → 기준 화면 확인 → 워크플로 호출 → 결과 정리**만 한다. 측정·판정·git 은 전부
엔진(`round.mjs`)과 워크플로가 결정론적으로 한다 — 결과를 해석해 바꾸지 마라.

## 0. 플러그인 루트·정보

```bash
ROOT=${PERF_LOOP_ROOT:-$(find "$HOME/.claude/plugins/cache" -path '*team-perf-loop/*/engine/round.mjs' 2>/dev/null | sort -V | tail -1)}
ROOT=${ROOT%/engine/round.mjs}
[ -f "$ROOT/engine/round.mjs" ] || echo "PERF_LOOP_NOT_INSTALLED"
node "$ROOT/engine/info.mjs"     # 저장소 루트에서 — bench·config·errors
```

`config` 가 null 이거나 `errors` 가 있으면 멈추고 `/perf-loop-init` 을 안내한다.
`info.mjs` 는 대상 저장소 안에서 실행한다(`cd <저장소> && node ...`). 세션 cwd 가 다른 저장소여도 된다 —
후보 에이전트는 벤치 저장소에서 직접 worktree 를 만든다(`<벤치>/../cand/`).

## 1. 인수

- 숫자 하나 — 라운드 수. 없으면 2. 그 밖의 토큰은 무시한다
- **회차(run) 번호는 받지도 묻지도 않는다.** 엔진이 `.perf-loop/results.tsv` 의 마지막 run + 1 로 정한다

## 2. 사전 점검

하나라도 실패하면 그 자리에서 멈추고 이유와 해결 명령을 보여준다. 고칠 수 있는 것만 직접 고친다.

1. **벤치** — `git -C $BENCH rev-parse --abbrev-ref HEAD` 가 `config.loopBranch`, `git -C $BENCH status --porcelain` 에
   `.perf-loop/.local/` 밖의 줄이 없어야 한다. 벤치가 없으면 `/perf-loop-init` 을 안내한다
2. **원래 브랜치와 맞추기** — 루프 브랜치를 만든 브랜치(대개 `main`)에 새 커밋이 있으면 `git -C $BENCH merge --ff-only main`.
   fast-forward 가 안 되면(루프 브랜치에 아직 옮기지 않은 keep 커밋이 있다) 멈추고 묻는다 — 루프 브랜치를 임의로 rebase·reset 하지 않는다.
   병합으로 의존성 파일(`package-lock.json`·`build.gradle*`·`pom.xml`)이 바뀌었으면 `setup` 을 벤치에서 다시 돈다
3. **설정의 preflight** — 각 `cmd` 를 벤치에서 돌려 본다. 실패하면 `fix` 를 보여준다. `fix` 를 묻지 않고 실행하지 않는다
4. **포트** — `lsof -tiTCP:<port> -sTCP:LISTEN` 에 출력이 있으면 멈춘다. 무엇이 쓰는지(`ps -p <pid>`) 보여주고 맡긴다. 임의로 kill 하지 않는다
5. **자정** — `gate.freezeDateTz` 가 있을 때만. 그 시간대로 22:30 이후면 "1회 실행이 길어 자정을 넘기면 환경 오류로 멈춘다" 고 알리고 진행 여부를 묻는다

## 3. 기준 화면 확인

기준이 틀리면 그 실행의 판정 전체가 틀어진다. 관문(`gate`)이 없으면 이 단계는 build·기동·페이지 200 확인만 한다.

```bash
cd $BENCH && node "$ROOT/engine/round.mjs" preview .perf-loop/.local/shots/preview
```

Bash timeout 600000. 실패하면 메시지를 보여주고 멈춘다.
`Read` 로 `preview/` 의 `mobile__root.png` 와 로그인 화면 하나의 `desktop_*.png` 를 열어 보여주고 묻는다:
"이 화면이 이번 실행의 기준이 됩니다. 진행할까요?" — 답을 받기 전에 워크플로를 띄우지 않는다.
CSS 가 빠졌거나 로그인 화면이 찍혔으면 묻지 말고 그 사실을 알리고 멈춘다.

## 4. 워크플로 실행

```
Workflow({
  scriptPath: '<ROOT>/workflows/perf-loop.js',
  args: {
    bench: '<BENCH 절대 경로>',
    engine: '<ROOT 절대 경로>',
    guide: '<config.guide>',
    allow: <config.scope.allow>,
    candidates: <config.thresholds.candidates>,
    rounds: <1 의 라운드 수>,
  },
})
```

- `args.run` 을 넣지 않는다
- 실행 중에는 `/workflows` 로 진행을 볼 수 있다고 한 줄 알린다. 완료 알림이 올 때까지 결과를 추측하지 않는다
- 세션 cwd 를 벤치로 옮기지 않는다 — Stop 훅 같은 것이 측정 중인 벤치를 다시 빌드한다

## 5. 결과 정리

워크플로 요약(`run`·`aborted`·`stop`·`bestScore`·`rounds`)과 `$BENCH/.perf-loop/results.tsv` 의 이번 run 줄로 정리한다.

- `aborted` 가 있으면 그 문구를 그대로 맨 앞에. 로그는 `$BENCH/.perf-loop/.local/run<N>-*.json.log`
- 이번 run 번호, 기준선 점수 → 최종 `bestScore`, 종료 사유(`stop.reason`: target·stall·max-rounds·no-hypotheses)
- 라운드별 후보 표: 후보 · 가설 · 결과(keep/outcompeted/discard/gate/crash/scope) · 점수 · 사유
- `gate` 가 있으면 `$BENCH/.perf-loop/.local/shots/run<N>/r<R>-<후보>/diff/` (다른 픽셀이 빨갛게 칠해진 이미지)
- keep 커밋이 있으면 `git -C $BENCH log --oneline main..<loopBranch>` 를 보여주고 끝에 한 줄:
  "keep 커밋은 루프 브랜치에만 있습니다. 반영하려면 따로 말씀해 주세요." — 이 스킬은 병합·push 하지 않는다

## 정리 (요청받았을 때만)

후보 브랜치 `perf/cand/*` 는 먼저 남은 후보 worktree(`<벤치>/../cand/*`)를 `git worktree remove`
(디렉터리가 없으면 `git worktree prune`)한 뒤 `git branch -D`. 체크아웃 중인 브랜치는 `branch -D` 가 거부된다.
