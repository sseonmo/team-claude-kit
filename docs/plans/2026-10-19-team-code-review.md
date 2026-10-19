# team-code-review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 범위가 결정론적으로 강제되고 회차를 넘어 수렴하는 다차원 코드 리뷰 스킬 `deep-review` 를 `plugins/team-code-review/` 로 만든다.

**Architecture:** 판단은 LLM(워크플로의 리뷰어·검증자), 계산은 엔진(`engine/*.mjs`, Node 내장만). 스킬은 `cli.mjs prepare` → `Workflow` → `cli.mjs settle` → 출력·게시 순서로 부르기만 한다. 워크플로는 투표 원본을 그대로 돌려주고, 집계·범위 필터·회차 기록·판정은 전부 엔진이 한다 — 그래야 테스트할 수 있다.

**Tech Stack:** Node ≥ 20 내장 모듈(`node:test`, `node:child_process`, `node:crypto`, `node:fs`, `node:vm`), git CLI, `gh` CLI, Claude Code Workflow 도구.

**Spec:** `docs/specs/2026-10-18-team-code-review-design.md` (커밋 `ee30276`). 원형: FinSight `.claude/commands/review-code.md`, `.claude/workflows/review-code.js` (`/Users/guseonmo/Documents/study/ai_lecture/practice/part2_project_finsight`).

## 실행 상태 (Codex 이어서 진행)

- [x] Task 1~4: 기존 구현 복원, Task 4 독립 리뷰 및 diff 안전성 보완 완료.
- [x] Task 5~14: 구현, 모듈별 TDD, 독립 리뷰 및 수정 완료. 전체 자동 테스트 162/162 통과(최종 리뷰·결과 전달 검증 보완 포함).
- [x] Task 15: FinSight 원형/신규 실제 Workflow 비교 3건 + 수렴 재리뷰 1건(축소). 결과는 설계 문서 `## 실증 결과`.
- [x] 전체 브랜치 최종 리뷰 및 재현된 Important 3건 보완·재리뷰 완료. 잔여 Critical/Important 없음.

실제 진행 이력·결정은 `.superpowers/sdd/2026-10-19-team-code-review/progress.md`에 있다. 아래 체크박스는 원래 실행 절차를 보존했다. 기존 Claude Task 4는 RED 실행 증거가 없으며, 이 공백을 사후 실행으로 대체했다고 주장하지 않는다. 이후 엔진 작업은 RED/GREEN 증거를 기록했다.

---

## Global Constraints

- 런타임 의존성 0 — Node 내장 모듈만. `package.json` 은 `"private": true` 와 `"test": "node --test test/*.test.mjs"` 만 둔다(team-tdd-kit 과 같은 형식).
- 리뷰는 **파일을 수정하지 않는다.** 엔진이 쓰는 곳은 `$(git rev-parse --git-common-dir)/deep-review/` 아래뿐이다. `git add`·`git stash`·`git fetch`·index 를 건드리는 명령을 쓰지 않는다.
- 플러그인 이름 `team-code-review`, 스킬 `deep-review`, 버전 `0.1.0`. 마켓플레이스 `.claude-plugin/marketplace.json` 에 등록.
- 인수: `--fast` / `--deep`, `--pr`, `--comment`, `--skip <id> ["메모"]`, `--fresh`, 경로 토큰.
- 모드 값: 빠른 상한 300초·critical/major 검증자 2·minor 0, 정밀 상한 480초·critical/major 3·minor 1, nit 은 두 모드 모두 0.
- 판정: critical ≥1 → `Blocked` / major ≥1 → `Changes Requested` / 그 외 → `Approve`. 실패 차원 또는 index 에만 있는 변경이 있으면 `Approve` 는 `Incomplete` 로. 보류·판단 충돌은 판정에서 뺀다. `unverified` 는 넣는다.
- 발견 id `R<회차>-<번호>`. 회차 기록 `<common-dir>/deep-review/<인코딩된 브랜치>.json`, 실행 기록 `<common-dir>/deep-review/runs.tsv`.
- 코드 주석·문구는 기존 플러그인처럼 한국어, 식별자는 영어. 커밋은 `feat(code-review): …` 형식, 끝에 attribution 두 줄.
- 엔진 모든 모듈은 테스트 먼저(TDD). 예외는 Task 1 스파이크(버린다)와 Task 14 문서.

## Review Focus

테스트가 명시하지 않았지만 사람이 실제로 부딪힐 입력 — 각 줄의 테스트는 담당 Task 에 들어 있다.

1. **한글·공백이 든 파일 이름** — git 은 기본값 `core.quotePath=true` 에서 `"\355\225\234.java"` 처럼 따옴표·8진수로 낸다. 사람은 그 파일도 리뷰되기를 기대한다 → 엔진의 모든 git 호출에 `-c core.quotePath=false`, diff 는 `-z` 없이 파싱하되 따옴표 경로를 풀어야 한다. (Task 3)
2. **CRLF 파일** — Windows 에서 만든 Java 파일. 줄 내용 anchor 가 `\r` 때문에 다음 회차에 대응되지 않으면 보류·충돌이 조용히 무력화된다 → anchor 비교는 끝의 `\r` 을 지운다. (Task 8)
3. **바이너리·거대 생성 파일**(이미지, `package-lock.json`) — 범위에 바이너리가 들어가면 안 되고, 큰 diff 경고가 lockfile 때문에 매번 뜨면 경고가 무시된다 → 바이너리는 범위에서 빼고, 변경 줄 수 집계에서 lockfile(`*.lock`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `gradle.lockfile`)을 뺀다. (Task 3, Task 4)
4. **커밋이 하나도 없는 저장소**(`git init` 직후) — HEAD 가 없어도 첫 커밋 전 리뷰는 되어야 한다 → 기준 커밋은 빈 트리(`git hash-object -t tree /dev/null`, 즉 `4b825dc642cb6eb9a060e54bf8d69288fbee4904`). (Task 4)
5. **저장소 하위 디렉터리에서 실행** — 사람은 어디서 부르든 같은 결과를 기대한다 → 엔진은 `git rev-parse --show-toplevel` 을 cwd 로 쓰고 모든 경로는 루트 기준. 경로 토큰은 호출 cwd 기준으로 풀어 루트 기준으로 바꾼다. (Task 12)

---

## 파일 구조

```
plugins/team-code-review/
  .claude-plugin/plugin.json
  package.json
  README.md
  skills/deep-review/SKILL.md      # Task 14 — 엔진·워크플로를 순서대로 부르기만 한다
  workflows/deep-review.js         # Task 13 — 차원 리뷰 + 검증 투표 원본
  engine/
    config.mjs     # Task 2  — 모드·상한·임계값 상수 (한 곳)
    git.mjs        # Task 2  — git 실행 래퍼
    diff.mjs       # Task 3  — unified diff 파싱, untracked diff
    target.mjs     # Task 4  — 대상 선정, 기준 커밋, index 전용 변경, 크기
    scope.mjs      # Task 5  — 범위 판정·필터
    votes.mjs      # Task 6  — 투표 집계(원형 이식) + fix 안전성 + 관계
    store.mjs      # Task 7  — 회차 기록 입출력, 인코딩, 손상 복구, skip
    match.mjs      # Task 8  — anchor 대응, 같은 자리, 충돌·접기·이월, 수렴 요약
    verdict.mjs    # Task 9  — 판정
    reuse.mjs      # Task 10 — 재사용 키
    runs.mjs       # Task 10 — runs.tsv
    render.mjs     # Task 11 — 터미널 2층 출력, PR payload
    cli.mjs        # Task 12 — prepare / settle / skip
  test/
    helpers.mjs    # 임시 git 저장소 생성 유틸 (Task 3 에서 만든다)
    *.test.mjs
```

## 공유 타입 (모든 Task 가 이 이름을 쓴다)

```js
// Loc       { path, oldPath?, side: 'new' | 'old', line }          — line 은 1부터
// FileDiff  { path, oldPath, status: 'A'|'M'|'D'|'R'|'B',
//             added: number[], removed: number[],                    — new 쪽 / old 쪽 줄 번호
//             addedText: string[], removedText: string[],
//             hunks: [{ oldStart, oldLines, newStart, newLines }] }
// Scope     Map<path, FileDiff>   — 키는 path(삭제 파일은 oldPath)
// Vote      { verdict: 'confirmed'|'refuted', severity, reason, fixSafe: boolean,
//             relation: 'new_problem'|'round_trip'|null }
// RawFinding { dimension, severity, loc: Loc, title, tldr, good, fix,
//              assigned: number, votes: Vote[], priorId: string|null }
// Finding   RawFinding + { id, verification: 'confirmed'|'unverified'|'skipped'|'refuted',
//             votesText, originalSeverity?, reasons: string[], fix: string|null,
//             fixNote: ''|'미검증'|<위험 사유>, conflict?: { priorId }, folded?: { byId, memo, reason } }
// WorkflowResult { dimensions: [{ key, failed, findings: RawFinding[], walkthrough, praise }],
//                  tiebreaks: number, cutoff: boolean }
// Verdict   'Blocked' | 'Changes Requested' | 'Approve' | 'Incomplete'
```

---

### Task 1: 스파이크 — 시간 상한 강제 방법과 실측 (버린다)

설계 "먼저 실증할 것" 절. 코드는 스크래치 디렉터리에만 두고 커밋하지 않는다. 산출물은 **설계 문서의 `## 실증 결과` 절과 Task 2 상수값**이다.

배경: `agent()` 에 timeout 옵션이 없고 워크플로 스크립트에서 `Date.now()` 가 throw 한다(workflow-authoring 레퍼런스). 그래서 두 후보를 시험한다.
- **A안** — 스크립트 안에서 `setTimeout` 으로 deadline 플래그를 세우고 `Promise.race(agent, timer)` 로 끊는다.
- **B안** — 스킬(메인 세션)이 상한에 `TaskStop` 으로 워크플로를 멈추고 `<transcriptDir>/journal.jsonl` 에서 끝난 agent 결과를 읽는다.

**Files:** 스크래치 디렉터리만 (`$SCRATCH/spike/`). 수정: `docs/specs/2026-10-18-team-code-review-design.md` (끝에 `## 실증 결과` 절 추가).

- [ ] **Step 1: A안 가능 여부** — 스크래치에 `spike-timer.js` 를 쓴다. 내용: `log(typeof setTimeout)`, 그리고 `Promise.race([agent('Bash 로 sleep 90 을 실행한 뒤 done 을 반환하라'), new Promise(r => setTimeout(() => r('TIMEOUT'), 30000))])` 의 결과를 `return`. `Workflow({ scriptPath })` 로 실행.
  기록할 것: `setTimeout` 존재 여부, race 결과가 `TIMEOUT` 인가, 워크플로가 약 30초에 끝나는가(남은 agent 가 완료를 막는가), 끊긴 agent 가 계속 돌며 비용을 쓰는가(`/workflows` 로 확인).
- [ ] **Step 2: B안 가능 여부** (A안이 안 될 때만) — 같은 스크립트를 race 없이 실행하고 30초 뒤 `TaskStop`. `journal.jsonl` 에 이미 끝난 agent 의 반환값이 남는지 확인.
- [ ] **Step 3: 실측 준비** — FinSight 를 스크래치로 `git clone --local` 한다(원본 저장소의 worktree 목록을 건드리지 않기 위해). 원형 `review-code.js` 를 스크래치로 복사해 `VOTES = { critical: 2, major: 2, minor: 0, nit: 0 }` 로 바꾸고, `DIMENSIONS` 에 test coverage 를 설계 §6 문구로 추가한다.
- [ ] **Step 4: 실측** — 클론의 최근 비-merge 커밋 10개(`git log --no-merges -10 --format=%H`)마다: detached checkout → `date +%s` → 워크플로(`args.base = <sha>^`) → `date +%s`. 커밋마다 기록: 변경 파일 수, 변경 줄 수(lockfile 제외), 총 소요 초, 300초 초과 여부, 발견 수(심각도별), 검증자 1명 평균 소요 초(journal 의 agent 시작·끝 시각).
  비용 주의: 10회 × (리뷰어 4 + 검증자 최대 수십) — 사용자에게 시작 전에 알린다.
- [ ] **Step 5: 결정과 기록** — 설계 문서 끝에 `## 실증 결과 (2026-10-XX)` 를 추가: 측정표, A/B 중 채택안, 그리고 다음 상수값과 근거.
  - `LARGE_DIFF_LINES` — 300초를 넘기 시작한 변경 줄 수(측정 사이 값). 측정에서 넘은 적이 없으면 측정 최대값의 1.5배.
  - `VERIFY_CAP` — 빠른 모드에서 300초 안에 들어온 최대 검증 대상 발견 수. 정밀 모드는 480/300 비례.
  - `TIEBREAK_MIN_SEC` — 검증자 1명 평균 소요 초 × 1.5.
  - **게이트:** 300초 초과가 10회 중 3회 이상이면 멈추고 사용자에게 보고한다(사용자 결정 1 — "자주 닿으면 다시 논의"). 판정 규칙을 바꿀지 받은 뒤 진행.
- [ ] **Step 6: 커밋**

```bash
git add docs/specs/2026-10-18-team-code-review-design.md
git commit -m "docs(code-review): 시간 상한 강제 방법·실측 결과"
```

---

### Task 2: 골격 · config · git 래퍼

**Files:**
- Create: `plugins/team-code-review/.claude-plugin/plugin.json`, `plugins/team-code-review/package.json`, `plugins/team-code-review/engine/config.mjs`, `plugins/team-code-review/engine/git.mjs`
- Modify: `.claude-plugin/marketplace.json` (plugins 배열 끝에 항목 추가)
- Test: `plugins/team-code-review/test/config.test.mjs`

**Interfaces:**
- Produces: `MODES`, `LARGE_DIFF_LINES`, `VERIFY_CAP`, `TIEBREAK_MIN_SEC`, `LOCKFILES`, `SEVERITY_RANK`, `VERSION` (config.mjs); `git(args: string[], cwd: string, opts?: { allowFail?: boolean, input?: string }) => string`, `gitOk(args, cwd) => boolean`, `repoRoot(cwd) => string`, `commonDir(root) => string` (git.mjs)

- [ ] **Step 1: 실패하는 테스트**

```js
test('모드 값은 설계와 같다', () => {
  assert.deepEqual(MODES.fast, { capSec: 300, votes: { critical: 2, major: 2, minor: 0, nit: 0 } })
  assert.deepEqual(MODES.deep, { capSec: 480, votes: { critical: 3, major: 3, minor: 1, nit: 0 } })
})
test('VERSION 은 plugin.json 과 같다', () => assert.equal(VERSION, '0.1.0'))
test('SEVERITY_RANK 순서', () => assert.deepEqual(SEVERITY_RANK, { critical: 0, major: 1, minor: 2, nit: 3 }))
test('git 은 quotePath 를 끈다', () => { /* 임시 저장소에 '한글.txt' 를 만들고 git(['ls-files','--others'], dir) 가 '한글.txt' 를 그대로 낸다 */ })
```

- [ ] **Step 2:** `cd plugins/team-code-review && npm test` → FAIL (모듈 없음)
- [ ] **Step 3:** 구현. `VERSION` 은 perf-loop `round.mjs` 처럼 `plugin.json` 을 읽는다. `LARGE_DIFF_LINES`·`VERIFY_CAP`(`{ fast, deep }`)·`TIEBREAK_MIN_SEC` 는 Task 1 결과값. `LOCKFILES` 는 Review Focus 3 의 목록. `git()` 은 `execFileSync('git', ['-c','core.quotePath=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 64MB })`, `allowFail` 이면 실패 시 `null`.
- [ ] **Step 4:** `npm test` → PASS
- [ ] **Step 5: 커밋** `feat(code-review): 플러그인 골격과 설정 상수`

---

### Task 3: diff 파싱

**Files:** Create `engine/diff.mjs`, `test/helpers.mjs`; Test `test/diff.test.mjs`

**Interfaces:**
- Consumes: `git` (Task 2)
- Produces: `parseDiff(text: string) => FileDiff[]`, `untrackedDiff(root: string, paths: string[]) => FileDiff[]`, `isLockfile(path) => boolean`; helpers: `makeRepo() => dir`, `commit(dir, files: Record<string,string|null>, msg) => sha` (null 은 삭제)

- [ ] **Step 1: 실패하는 테스트** — 임시 저장소에서 실제 `git diff` 출력을 만들어 파싱한다.
  - `수정` — 3행 변경: `added == [3]`, `removed == [3]`, `status == 'M'`
  - `hunk 여러 개` — 2행·20행 변경: `added == [2, 20]`, `hunks.length == 2`
  - `새 파일` — `status 'A'`, `added == [1,2,3]`, `removed == []`
  - `파일 전체 삭제` — `status 'D'`, `path` 는 옛 경로, `added == []`, `removed == [1,2,3]`
  - `이름 변경` — `git mv a.js b.js` 후 1행 수정: `path 'b.js'`, `oldPath 'a.js'`, `status 'R'`
  - `바이너리` — png 추가: `status 'B'`, `added == []`, `removed == []`
  - `좌표계 (Codex 재현)` — 커밋에서 5행을 바꾸고, 미커밋으로 1행 앞에 두 줄 삽입 → `parseDiff(git(['diff', base], dir))` 의 `added` 가 `[1, 2, 7]`
  - `한글·공백 경로` — `'한 글.java'` 수정 → `path == '한 글.java'` (Review Focus 1)
  - `untracked` — `untrackedDiff(dir, ['new.java'])` 가 `status 'A'`, 줄 전부 `added`
  - `isLockfile` — `package-lock.json`, `sub/yarn.lock` true / `lock.java` false
- [ ] **Step 2:** `npm test` → FAIL
- [ ] **Step 3:** 구현. `diff --git` 헤더·`rename from/to`·`new/deleted file mode`·`Binary files` 를 읽고 `@@ -a,b +c,d @@` 에서 줄 번호를 센다. `\ No newline at end of file` 은 무시. 따옴표 경로는 C 이스케이프를 풀고 UTF-8 로 해석. untracked 는 `git diff --no-index -- /dev/null <path>`(exit 1 이 정상 — `allowFail`) 를 파싱.
- [ ] **Step 4:** `npm test` → PASS
- [ ] **Step 5: 커밋** `feat(code-review): diff 파싱 — 좌표·삭제·이름 변경·untracked`

---

### Task 4: 대상 선정

**Files:** Create `engine/target.mjs`; Test `test/target.test.mjs`

**Interfaces:**
- Consumes: `git`, `gitOk`, `repoRoot` (Task 2); `parseDiff`, `untrackedDiff`, `isLockfile` (Task 3)
- Produces:
  - `selectTarget(state: { dirty: boolean, upstream: string|null, ahead: number, defaultBase: string|null, prBaseOid: string|null, flags: { pr, comment, fast, deep } }) => { kind: 'uncommitted'|'push'|'branch'|'pr'|'none', baseRef: string|null, mode: 'fast'|'deep' }` — 순수 함수
  - `collectTarget(root: string, flags, paths: string[]) => { kind, mode, baseSha, headSha, files: FileDiff[], diffText, changedLines: number, indexOnly: string[], warnings: string[] }`
  - `defaultBranch(root) => string|null`, `indexOnlyChanges(stagedDiff: FileDiff[], unstagedDiff: FileDiff[]) => string[]`

- [ ] **Step 1: 실패하는 테스트**
  - `selectTarget` 표 — 설계 §1 표의 각 행: dirty → `uncommitted`/`fast`, 깨끗+ahead>0 → `push`, upstream 없음 → `branch`(baseRef = defaultBase), `flags.pr` → `pr`/`deep`, `flags.comment` → `pr`/`deep`, 깨끗+ahead 0 → `none`, `flags.deep` 는 모드만 바꾼다
  - `defaultBranch` — `origin/HEAD` 가 없고 `master` 만 있으면 `'master'`, 둘 다 없으면 `null`
  - `PR base` — `prBaseOid` 의 객체가 로컬에 없으면 `collectTarget` 이 `Error('PR base <sha> 가 로컬에 없다 — git fetch origin <base> 후 다시 실행')` 를 던진다
  - `index 전용 변경 (Codex 재현)` — 권한 확인 줄을 지워 stage 한 뒤 작업 트리에서 되살림 → `indexOnly == ['Auth.java']`, `diffText` 는 비어 있음
  - `부분 stage` — 1행 stage + 5행 미stage 추가 → `indexOnly == []`
  - `빈 저장소` — 커밋 0개 + 파일 하나 → `kind 'uncommitted'`, `baseSha == '4b825dc642cb6eb9a060e54bf8d69288fbee4904'` (Review Focus 4)
  - `경로 토큰` — `paths ['src/a']` 면 `files` 가 그 아래만
  - `changedLines` — lockfile 의 줄은 세지 않는다 (Review Focus 3); 넘으면 `warnings` 에 큰 diff 문구가 들어간다
- [ ] **Step 2:** `npm test` → FAIL
- [ ] **Step 3:** 구현. 기준 커밋: `uncommitted` → HEAD(없으면 빈 트리), `push` → `@{upstream}`, `branch` → `merge-base(origin/<default> 또는 <default>, HEAD)`, `pr` → `merge-base(prBaseOid, HEAD)`. diff 는 `git diff <base> -- <paths>` 하나 + `git ls-files --others --exclude-standard`. index 전용 판정: `git diff --cached` 와 `git diff` 를 파싱해 **staged 의 removedText ∩ unstaged 의 addedText** 또는 **staged 의 addedText ∩ unstaged 의 removedText** 가 비어 있지 않은 파일. 큰 diff 문구: `변경 ${n}줄 — 5분 안에 끝나지 않을 수 있다. 경로 인수로 나눠 리뷰하라(예: /deep-review src/order/)`.
- [ ] **Step 4:** `npm test` → PASS
- [ ] **Step 5: 커밋** `feat(code-review): 대상 선정 — 기준 커밋·index 전용 변경·크기 경고`

---

### Task 5: 범위 필터

**Files:** Create `engine/scope.mjs`; Test `test/scope.test.mjs`

**Interfaces:**
- Consumes: `FileDiff` (Task 3)
- Produces: `buildScope(files: FileDiff[]) => Scope`, `inScope(loc: Loc, scope: Scope) => boolean`, `filterFindings(findings: RawFinding[], scope) => { kept: RawFinding[], dropped: number }`, `hunkOf(loc, scope) => { path, side, start, end } | null`, `scopeSummary(scope) => string` (리뷰어 프롬프트용 `path: 3-5, 20 / old: 7`)

- [ ] **Step 1: 실패하는 테스트**
  - `new 쪽 경계` — added `[3,4]`: 줄 3·4 true, 2·5 false
  - `old 쪽 삭제 줄` — removed `[7]`: `{side:'old', line:7}` true, `{side:'new', line:7}` false
  - `파일 전체 삭제` — status D, `{path:'Gone.java', side:'old', line:2}` true
  - `diff 에 없는 파일` — false
  - `바이너리` — status B 의 어떤 위치도 false
  - `filterFindings` — 5개 중 2개 범위 밖 → `kept.length 3`, `dropped 2`
  - `hunkOf` — added `[2,3,20]` 이고 hunks 두 개일 때 줄 3 은 첫 hunk, 줄 20 은 둘째 hunk (new 쪽은 newStart..newStart+newLines-1)
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5: 커밋** `feat(code-review): 결정론적 범위 필터`

---

### Task 6: 투표 집계

원형 `review-code.js` 의 `settleSeverity`·`verifyFinding` 판정부를 순수 함수로 옮기고, fix 안전성·관계 판정을 더한다.

**Files:** Create `engine/votes.mjs`; Test `test/votes.test.mjs`

**Interfaces:**
- Consumes: `SEVERITY_RANK` (Task 2)
- Produces: `settleSeverity(original, confirmations: Vote[]) => severity`, `settleFinding(raw: RawFinding) => Finding` (id 는 아직 없음 — `id: null`)

- [ ] **Step 1: 실패하는 테스트**
  - `2명 2-0` → `confirmed`, `votesText '2/2'`
  - `2명 0-2` → `refuted`
  - `2명 1-1` → `unverified`
  - `2명 중 1명 사망`(votes 1개, assigned 2, confirmed) → `unverified` (과반은 배정 인원 기준)
  - `3명 2-1` → `confirmed`, `3명 1-2` → `refuted`
  - `동점 후 세 번째` — assigned 3, votes [confirmed, refuted, confirmed] → `confirmed '2/3'`
  - `assigned 0` → `skipped`, `votesText '0/0'`, `fixNote '미검증'`
  - `등급 하향` — major, 확인 표 [minor, minor] → `severity 'minor'`, `originalSeverity 'major'`
  - `상향 자르기` — major, 확인 표 [critical, critical] → `'major'`
  - `셋이면 가운데` — critical, 확인 표 [critical, major, minor] → `'major'`
  - `fix 안전성` — 확인 표 중 하나라도 `fixSafe false` → `fix null`, `fixNote` 에 그 표의 `reason` 첫 문장
  - `unverified 의 fix` → fix 유지, `fixNote '미검증'`
  - `관계` — 확인 표가 전부 `round_trip` → `conflict: { priorId }`; 하나라도 `new_problem` → conflict 없음; `priorId null` 이면 관계 무시
  - `검증 0명 + priorId 있음` → `conflict: { priorId }` (설계: 검증 없이 판단 충돌 절로)
  - `test coverage 최고 major` — `dimension 'test-coverage'`, severity critical, 확인 표 [critical, critical] → `'major'`
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5: 커밋** `feat(code-review): 투표 집계 — 2·3명 과반, fix 안전성, 판단 왕복`

---

### Task 7: 회차 기록 저장소와 `--skip`

**Files:** Create `engine/store.mjs`; Test `test/store.test.mjs`

**Interfaces:**
- Consumes: `git`, `commonDir` (Task 2)
- Produces:
  - `recordPath(root) => string | null` — detached HEAD 면 `null`
  - `encodeBranch(name) => string` — `encodeURIComponent` 후 `%` 를 `_` 로 (`feature/x` → `feature_2Fx`)
  - `loadRecord(root) => { record, notice: string|null }` — 없으면 빈 기록, 손상이면 `<파일>.corrupt-<ISO 시각>` 으로 옮기고 notice
  - `saveRecord(root, record)` — 임시 파일 → rename
  - `applySkip(record, id, memo: string|null) => { ok: true, title } | { ok: false, validIds: string[] }` — 순수 함수
  - Record 스키마: `{ version: 1, rounds: [{ n, at, mode, headSha, baseSha, reuseKey, findings: Finding[], conflicts: [{ newId, priorId }], result }], skips: { [id]: { memo, at, snapshot: Anchor|null, adopted: string|null } } }`

- [ ] **Step 1: 실패하는 테스트**
  - `encodeBranch('feature/x') === 'feature_2Fx'`, `encodeBranch('main') === 'main'`
  - `detached HEAD` → `recordPath` 가 `null`
  - `손상 JSON` — `{` 만 든 파일 → 빈 기록 반환, `.corrupt-` 파일이 생기고 notice 가 있다
  - `applySkip 없는 id` → `{ ok: false, validIds: ['R1-1','R1-2'] }`, record 불변(deepEqual)
  - `applySkip 이미 보류` → ok false
  - `applySkip 메모` → `skips['R1-2'].memo === '이미 위에서 막혀 있음'`, `snapshot null`
  - `충돌 짝의 채택 기록` — 마지막 회차 `conflicts [{ newId:'R2-1', priorId:'R1-3' }]` 에서 `R1-3` skip → `adopted 'R2-1'`; `R2-1` skip → `adopted 'R1-3'`
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5: 커밋** `feat(code-review): 회차 기록 저장소와 --skip`

---

### Task 8: 대응 · 같은 자리 · 충돌 · 보류 이월 · 수렴 요약

이 Task 가 "수렴" 의 핵심이다. 설계 §3 을 그대로 코드로 옮긴다.

**Files:** Create `engine/match.mjs`; Test `test/match.test.mjs`

**Interfaces:**
- Consumes: `hunkOf`, `inScope` (Task 5); Record (Task 7)
- Produces:
  - `makeAnchor(lines: string[], line: number) => Anchor` — `{ text, before: string[2], after: string[2] }`, 끝 `\r` 제거
  - `locate(anchor, lines: string[]) => number | null` — 같은 `text` 줄 중 before/after 일치 수가 가장 큰 곳, 동점이면 null 이 아니라 **가장 위**, `text` 가 없으면 null
  - `priorCandidates(record, scope, readLines: (path, side) => string[]) => [{ prior: Finding, loc: Loc, hunk }]` — 모든 이전 회차 발견을 현재 코드에 대응시키고 범위 안인 것만
  - `attachPriors(raws: RawFinding[], candidates, scope) => RawFinding[]` — 같은 hunk 의 후보가 있으면 `priorId` 를 채운다(워크플로 args 에도 쓰인다)
  - `applyHistory(findings: Finding[], record, candidates, readLines) => { findings: Finding[], conflicts: [{newId, priorId}], carried: Finding[] }` — 접기·이월·보류 해제·스냅샷 굳히기
  - `convergence(record, findings, failedDims: string[], candidates) => { resolved, fresh, conflicts, skipped, unchecked }`

- [ ] **Step 1: 실패하는 테스트**
  - `locate 줄 이동` — anchor 를 만든 뒤 위에 3줄 삽입 → 원래 줄 + 3
  - `locate CRLF` — 원본 LF, 현재 CRLF → 같은 줄을 찾는다 (Review Focus 2)
  - `locate 사라짐` → null
  - `같은 자리` — R1 발견이 hunk(10–14) 안 12행에 대응, 새 발견 14행 → `priorId 'R1-1'`; 새 발견 30행(다른 hunk) → null
  - `채택된 판단을 거스르면 접는다` — skips `{ 'R1-3': { adopted: 'R2-1' } }`, 새 발견 conflict `{ priorId: 'R2-1' }` → `folded: { byId: 'R1-3', reason: 'R1-3 기각에 따름' }`, conflicts 에 들어가지 않음
  - `버린 쪽이 대응되지 않아도 접는다` — 위와 같되 R1-3 의 anchor 가 현재 코드에 없음 → 그래도 folded
  - `채택이 없는 왕복` → conflicts `[{ newId, priorId }]`, folded 없음
  - `보류 이월` — skip 된 R1-2 가 범위 안에 대응되고 리뷰어가 다시 안 냄 → `carried` 에 `folded.byId 'R1-2'` 로 들어간다
  - `보류가 처음 대응된 리뷰에서 굳는다` — snapshot null → 이번 호출 뒤 `record.skips['R1-2'].snapshot` 이 현재 anchor
  - `고친 뒤 skip 해도 유지 (Codex 재현)` — R1-3 skip(snapshot null) 전에 그 줄을 이미 고침 → 다음 리뷰에서 굳고, 그다음 리뷰에서 여전히 보류
  - `굳은 뒤 코드가 바뀌면 풀린다` — snapshot 과 현재 anchor.text 가 다르면 skip 해제, 그 발견은 일반 발견
  - `범위 밖 보류는 보여주지 않는다` — carried 에 없음
  - `rebase 후 유지` — 기준 커밋이 바뀌어도 anchor 로 대응되면 후보에 남는다
  - `convergence` — 이전 2건 중 1건 다시 안 남(해결 1), 다른 1건의 차원이 실패 → `unchecked 1`, `resolved 1`
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5: 커밋** `feat(code-review): 회차 대응 — 같은 자리·판단 충돌·보류 이월·수렴 요약`

---

### Task 9: 판정

**Files:** Create `engine/verdict.mjs`; Test `test/verdict.test.mjs`

**Interfaces:**
- Produces: `computeVerdict({ findings: Finding[], failedDims: string[], indexOnly: string[] }) => { verdict: Verdict, counts: { critical, major, minor, nit }, notes: string[] }`

- [ ] **Step 1: 실패하는 테스트**
  - critical 1 → `Blocked`; major 1 → `Changes Requested`; minor 만 → `Approve`; 0건 → `Approve`
  - `unverified` major → `Changes Requested` (판정에 포함)
  - `folded`·`conflict` 가 붙은 major → 세지 않음 → `Approve`
  - `refuted` 는 세지 않음
  - 발견 0 + `failedDims ['security']` → `Incomplete`, notes 에 `⚠ security 차원은 실행되지 않았다`
  - major 1 + failedDims → `Changes Requested` 유지, notes 는 남김
  - 0건 + `indexOnly ['Auth.java']` → `Incomplete`, notes 에 `⚠ 커밋될 내용(index)이 리뷰한 내용(작업 트리)과 다르다: Auth.java`
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5: 커밋** `feat(code-review): 판정 — Incomplete 포함`

---

### Task 10: 재사용 키 · runs.tsv

**Files:** Create `engine/reuse.mjs`, `engine/runs.mjs`; Test `test/reuse.test.mjs`, `test/runs.test.mjs`

**Interfaces:**
- Consumes: `git`, `VERSION` (Task 2)
- Produces: `reuseKey({ headSha, baseSha, diffText, untrackedText, stagedText, mode, rulesText, version }) => string` (sha256 hex), `rulesText(root, files: FileDiff[]) => string` (루트와 변경 파일 상위 디렉터리들의 `CLAUDE.md`·`AGENTS.md` 내용을 경로순으로 이어 붙임), `RUNS_HEADER`, `formatRun(row) => string`, `appendRun(root, row)`

- [ ] **Step 1: 실패하는 테스트**
  - 같은 입력 → 같은 키; `headSha` 만 다름 → 다른 키; `baseSha` 만 → 다름; `mode` 만 → 다름; `rulesText` 만 → 다름; `version` 만 → 다름; `stagedText` 만 → 다름
  - `rulesText` — `src/a/B.java` 변경 시 `CLAUDE.md`, `src/CLAUDE.md`, `src/a/AGENTS.md` 를 포함하고 `other/CLAUDE.md` 는 제외
  - `RUNS_HEADER === 'at\tbranch\tmode\tfiles\tlines\tseconds\tcap_hit\tunverified\ttiebreaks\tverdict'`
  - `appendRun` — 파일이 없으면 헤더부터, 있으면 한 줄만 덧붙인다
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5: 커밋** `feat(code-review): 재사용 키와 실행 기록`

---

### Task 11: 출력 · PR payload

원형 `review-code.md` §5·§6 의 형식을 따른다. 바뀌는 곳만 테스트로 고정한다.

**Files:** Create `engine/render.mjs`; Test `test/render.test.mjs`

**Interfaces:**
- Consumes: `Finding`, `computeVerdict` 결과 (Task 9), `convergence` 결과 (Task 8)
- Produces: `renderTerminal({ verdict, findings, carried, conflicts, convergence, dropped, notices, walkthrough, praise, reusedFrom: number|null }) => string`, `buildPayload({ ...같은 입력, headRefOid, inlineAllowed: boolean }) => { primary: object, fallback: object }`

- [ ] **Step 1: 실패하는 테스트**
  - 층 1 첫 줄 — `[major] R2-1 제목`, `[minor ← major] R2-2 제목`, `[major · 미검증] R2-3 제목`; 터미널에서는 위에 `path:line`(old 쪽은 `path:line (삭제된 줄)`)
  - `→ Fix (미검증)` — fixNote '미검증'; fix null 이면 `→ Fix   제안 없음 — <fixNote>`
  - 수렴 줄 — `이전 회차 대비: 해결 1 · 새 문제 2 · 충돌 1 · 보류 1`, unchecked 0 이면 `미확인` 생략, 1회차에는 줄 자체가 없다
  - `범위 밖 3건 제외` 줄 — dropped 0 이면 없다
  - `## 판단 충돌` 절 — `R1-3 (1회차) … / R2-1 (이번) …` 나란히, `--skip` 안내 한 줄
  - 보류 접힘 — `<details><summary>보류 2건</summary>` 안에 `[보류됨 · R1-2] 제목 — 메모`
  - 재사용 — 첫 줄 `변경 없음 — R3 결과를 다시 보여줍니다`
  - payload — `event 'COMMENT'`, `commit_id === headRefOid`, new → `side 'RIGHT'`, old → `side 'LEFT'`
  - `inlineAllowed false` → `primary.comments` 가 빈 배열이고 body 에 `## 인라인 생략된 발견` 과 모든 발견의 4줄
  - `fallback` — 항상 comments 없음 + 위 절 포함 (422 재시도용)
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5: 커밋** `feat(code-review): 터미널 출력과 PR payload`

---

### Task 12: CLI — prepare / settle / skip

스킬이 부르는 유일한 진입점. 출력은 전부 JSON 한 개(사람용 문구는 그 안의 필드).

**Files:** Create `engine/cli.mjs`; Test `test/cli.test.mjs` (임시 저장소 + 가짜 WorkflowResult)

**Interfaces:**
- Consumes: Task 2–11 전부
- Produces (명령행):
  - `node cli.mjs prepare [--fast|--deep] [--pr] [--comment] [--fresh] [paths…]` → stdout `{ status: 'none'|'reuse'|'run', message, workflowArgs?, reuse?: { rendered, payloadPath? }, pendingPath }`. `workflowArgs = { mode, base, files, scopeText, priors: [{ id, dimension, title, tldr, loc, hunk: { path, side, start, end } }], votes, verifyCap, tiebreakMinSec, capSec }` — `priors` 는 `priorCandidates`(Task 8) 결과. 워크플로는 FS 를 못 읽으므로 hunk 범위를 미리 계산해 넘기고, 워크플로가 발견 위치를 그 범위와 비교해 `priorId` 를 채운다. pending 파일(`<common>/deep-review/.pending.json`)에 시작 시각, 작업 트리 해시(`git status --porcelain` + `git diff` 의 sha256), 대상, 재사용 키를 쓴다.
  - `node cli.mjs settle --result <WorkflowResult.json> [--head-ref-oid <sha>]` → stdout `{ rendered, verdict, payloadPath?, fallbackPath?, treeChanged: boolean }`. 순서: 작업 트리 해시 비교 → `filterFindings` → `attachPriors` 확인 → `settleFinding` → 중복 병합(같은 `loc` 이고 제목이 같으면 심각도 높은 쪽 하나만 남기고 제목 뒤에 겹친 차원 병기, 제목이 다르면 둘 다 남긴다 — 원형의 "같은 줄 다른 결함 손실" 수정) → id 부여(`R<n>-<k>`, 심각도·경로순) → `applyHistory` → `computeVerdict` → `convergence` → `renderTerminal` → (treeChanged 면 기록 생략) `saveRecord` → `appendRun`.
  - `node cli.mjs skip <id> [memo]` → stdout `{ ok, message }`
- 경로 토큰은 호출 cwd 기준 → 루트 기준으로 바꾼다 (Review Focus 5)

- [ ] **Step 1: 실패하는 테스트**
  - `대상 없음` → `status 'none'`
  - `prepare → settle 한 바퀴` — 가짜 결과(major 1 confirmed) → `verdict 'Changes Requested'`, 기록 파일에 1회차, runs.tsv 에 한 줄
  - `범위 밖 발견` — 가짜 결과에 diff 밖 위치 하나 → rendered 에 `범위 밖 1건 제외`, 기록에 없음
  - `재사용` — 같은 상태로 다시 prepare → `status 'reuse'`, `--fresh` 면 `'run'`, 파일 한 글자 수정 → `'run'`
  - `재사용 + --comment` → `reuse.payloadPath` 가 있다(게시 단계로 간다)
  - `리뷰 중 작업 트리 변경` — prepare 후 파일 수정 → settle 의 `treeChanged true`, rendered 맨 위 `⚠ 리뷰 중 작업 트리가 바뀌었다`, 기록 회차 수 그대로
  - `skip 왕복` — `skip R1-1 "메모"` → ok; `skip R9-9` → ok false + 유효 id 목록
  - `중복 병합` — 같은 loc·같은 제목의 security major 와 architecture minor → 하나(major, 제목 끝 `(security · architecture)`); 같은 loc·다른 제목 → 둘
  - `하위 디렉터리 실행` — cwd `src/` 에서 `prepare a/` → files 가 `src/a/…` (Review Focus 5)
  - `detached HEAD` — settle 이 기록을 쓰지 않고 rendered 에 그 사실
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5: 커밋** `feat(code-review): CLI — prepare·settle·skip`

---

### Task 13: 워크플로 `deep-review.js`

원형 `review-code.js` 를 범용화한다. 투표 집계는 하지 않고 **원본 표를 돌려준다**(Task 6 이 집계). 시간 상한은 Task 1 의 채택안으로 구현한다.

**Files:** Create `plugins/team-code-review/workflows/deep-review.js`; Test `test/workflow.test.mjs`

**Interfaces:**
- Consumes: `args` = Task 12 의 `workflowArgs`
- Produces: `WorkflowResult`

- [ ] **Step 1: 실패하는 테스트** — `node:vm` 으로 스크립트를 실행한다. `export const meta` 를 지우고 `async function` 으로 감싼 뒤 `agent`·`parallel`·`pipeline`·`log`·`phase`·`args` 스텁을 주입한다(`pipeline` 스텁은 단계를 순서대로 await 하는 간단한 구현).
  - `차원 4개` — reviewer agent 호출 label 이 `review:correctness`·`review:security`·`review:architecture`·`review:test-coverage`
  - `빠른 모드 표 수` — major 발견 1건 → 검증 agent 2회, minor 1건 → 0회
  - `동점이면 세 번째` — 표 [confirmed, refuted] + 시간 충분 → 세 번째 호출, `assigned 3`, `tiebreaks 1`
  - `동점 + 시간 부족` → 세 번째 없음, `assigned 2`
  - `검증 상한` — `verifyCap 2` 에 major 3건 → 셋째 발견의 `assigned 0`, `votes []`, `log` 에 `검증 상한으로 1건 미검증` (원형 "No silent caps")
  - `차원 실패` — reviewer 스텁이 null → `failed true`
  - `prior 전달` — `args.priors[0].hunk` 범위(12–14) 안의 발견(13행)은 `priorId 'R1-1'`, 검증 프롬프트에 `이전 회차 판단: R1-1`, VERDICT 스키마에 `relation` 이 required; 범위 밖 발견(30행)은 `priorId null`
  - `test coverage 프롬프트` — 언어별 테스트 관례(Java `src/main`↔`src/test`, Python `test_x.py`·`tests/`, Node `*.test.*`·`__tests__/`) 문구가 들어 있다
  - `프롬프트 금지 문구` — reviewer 프롬프트에 `빌드·테스트를 실행하지 마라`, `파일을 수정하지 마라`, 원인 변경 줄 앵커 지시(설계 §2 Codex B안 대조 문구)
  - FinSight 어휘 없음 — 스크립트 전문에 `FinSight`, `RLS`, `Supabase` 가 없다
- [ ] **Step 2:** FAIL
- [ ] **Step 3:** 구현.
  - FINDINGS_SCHEMA 는 원형에서 `in_diff` 를 빼고 `loc: { path, oldPath, side, line }` 로 바꾼다.
  - VERDICT_SCHEMA 에 `fixSafe: boolean`, `relation: enum ['new_problem','round_trip']`(prior 가 있을 때만 required) 추가.
  - 체크리스트 문구는 설계 §6 표 그대로. 리뷰어 프롬프트는 원형 `buildPrompt` 구조 + "시작 전에 `CLAUDE.md`·`AGENTS.md`(루트와 변경 파일 상위 디렉터리)를 읽고, 필수로 표시된 규칙의 명백한 위반은 critical" + `args.scopeText`.
  - 검증 관점: 2명이면 `LENSES[0]`(도달 가능성), `LENSES[1]`(이미 막혀 있는가) + 둘 다에게 `LENSES[2]`(심각도 과장); 세 번째는 `LENSES[2]`. LENSES 문구에서 "RLS, 이후 마이그레이션" 을 "권한 검사, 스키마 제약" 으로 범용화.
  - 상한: Task 1 채택안. A안이면 `setTimeout` 으로 `late`(상한 도달)·`noTiebreak`(상한 − `tiebreakMinSec`) 플래그를 세우고 각 agent 를 race; B안이면 스크립트는 상한을 모르고 Task 14 의 스킬이 `TaskStop` + journal 로 처리(이 경우 `동점 + 시간 부족` 테스트는 `args.tiebreak false` 로 대체).
- [ ] **Step 4:** PASS
- [ ] **Step 5: 커밋** `feat(code-review): deep-review 워크플로`

---

### Task 14: 스킬 · README

**Files:** Create `plugins/team-code-review/skills/deep-review/SKILL.md`, `plugins/team-code-review/README.md`

**Interfaces:**
- Consumes: `cli.mjs` 명령 (Task 12), 워크플로 (Task 13)

- [ ] **Step 1: SKILL.md** — frontmatter `name: deep-review`, description 에 트리거 문구("코드 리뷰해줘", "커밋 전에 봐줘", "push 전 리뷰", "PR 리뷰", "/deep-review --comment"). 본문은 perf-loop `SKILL.md` 처럼 실행 지시만:
  0. 플러그인 루트 찾기 — perf-loop §0 방식(`DEEP_REVIEW_ROOT` 또는 `~/.claude/plugins/cache` 에서 `*team-code-review/*/engine/cli.mjs`)
  1. 인수 → `--skip` 이면 `cli.mjs skip` 결과만 출력하고 **끝**
  2. `cli.mjs prepare` → `none` 이면 message 출력 후 끝 / `reuse` 면 4로 / `run` 이면 message(경고) 출력
  3. `Workflow({ scriptPath: '<ROOT>/workflows/deep-review.js', args: workflowArgs })` — 이 스킬 지시가 Workflow 사용 승인. 완료 알림 전에는 결과를 추측하지 않는다. 반환을 스크래치 파일에 `Write` 한 뒤 `cli.mjs settle --result <파일>` (`--comment` 면 `gh pr view --json headRefOid` 를 넘긴다)
  4. `rendered` 를 그대로 출력(해석·요약·재정렬 금지). `--comment` 면 `gh api repos/{owner}/{repo}/pulls/{n}/reviews --method POST --input <payloadPath>`, 422 면 `fallbackPath` 로 한 번 재시도. PR 이 없으면 게시를 건너뛴다고 알린다
  - Workflow 도구가 없으면 그 사실을 알리고 멈춘다(설계: 대체 경로 없음)
  - Task 1 이 B안을 채택했으면 3 에 추가: 워크플로를 띄운 뒤 `capSec` 이 지나도 완료 알림이 없으면 `TaskStop` 하고, Task 1 에서 확인한 journal 경로에서 끝난 agent 결과로 WorkflowResult 를 만든다(끝나지 않은 차원은 `failed`, 끝나지 않은 검증은 표 없음)
  - 금지: 파일 수정, 결과 해석으로 판정 바꾸기, PR 생성
- [ ] **Step 2: README.md** — team-push-gate README 형식: 설치, 구성 표, 동작(대상 표·모드 표), `--skip` 과 보류, 회차 기록·`runs.tsv` 위치, **보류를 실수로 했으면 기록 JSON 의 `skips` 에서 그 id 를 지운다**(설계 렌즈 4), 알려진 한계(설계 "감수한 트레이드오프" 표), 테스트 명령.
- [ ] **Step 3:** `cd plugins/team-code-review && npm test` → 전부 PASS
- [ ] **Step 4: 커밋** `feat(code-review): deep-review 스킬과 README`

---

### Task 15: FinSight 회귀 실측

**Files:** 수정 `docs/specs/2026-10-18-team-code-review-design.md` (`## 실증 결과` 절에 회귀 결과 추가)

- [ ] **Step 1: 설치** — 로컬 마켓플레이스로 설치(`/plugin`) 후 `/reload-plugins`
- [ ] **Step 2: 원형과 나란히** — FinSight 스크래치 클론에서 최근 커밋 3개를 각각 원형 `/review-code` 와 `/deep-review` 로. 기록: 원형의 범위 안 발견을 새 스킬도 냈는가, 새 스킬의 범위 밖 발견 0건(엔진이 떨어뜨린 건수), 빠른 모드 소요 시간
- [ ] **Step 3: 수렴 시나리오** — 발견 하나를 지적대로 고치고 재실행 → 같은 자리를 되돌리라는 지적이 `판단 충돌` 로 가는가 / `--skip` 후 재실행 → 보류로 접히는가 / 아무것도 안 고치고 재실행 → `변경 없음` 재사용
- [ ] **Step 4:** 결과를 설계 문서에 표로 추가. 기대와 다르면 해당 Task 로 돌아간다.
- [ ] **Step 5: 커밋** `docs(code-review): FinSight 회귀 실측`
