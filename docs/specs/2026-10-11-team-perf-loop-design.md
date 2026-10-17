# team-perf-loop — 측정 기반 자율 최적화 루프를 플러그인으로

2026-10-11 · 신규 `plugins/team-perf-loop/` · 1단계 설계
원형: FinSight `scripts/lighthouse/` + `.claude/workflows/lighthouse-loop.js`
(설계 `docs/superpowers/specs/2026-10-11-lighthouse-loop-design.md`, 2026-10-11 main `aa926c2`)

## 왜 만드나

FinSight 에서 검증한 루프(후보 3개 → 결정론적 측정 → 최고 1개 keep)를 다른 프로젝트에서도
쓰고 싶다. 사용자는 혼자 쓰고, 대상은 대부분 Java 다 — **서버 렌더링 웹(Spring Boot + Thymeleaf/JSP)과
순수 백엔드/배치** 둘 다.

지금 코드는 루프 자체와 FinSight 사정(로컬 Supabase·`next start`·포트 3100·쿠키 발급·
Next.js 경로 규칙·서울 날짜)이 한 파일 안에 섞여 있어 그대로는 옮길 수 없다.

## 단계

| 단계 | 내용 | 검증 |
|---|---|---|
| **1단계 (이 문서)** | 엔진·측정기·관문 분리. 측정기 `lighthouse`, 관문 `screenshots` 하나씩 | 이식 테스트 통과 + FinSight 회귀 실측 |
| 2단계 (별도 설계) | 측정기 `http-load`(k6 p95)·`command-timer`(배치), 관문 `snapshot` | 실제 Java 백엔드 프로젝트에서 노이즈 실측 후 |

2단계를 지금 설계하지 않는 이유: 부하 테스트 노이즈·JVM 워밍업·측정 전 DB 상태 복원은
실측 없이 정하면 `MIN_GAIN`·반복 횟수가 추측이 된다. 1단계는 **2단계가 끼워질 자리(인터페이스)만** 고정한다.

## 지키는 선 (원형에서 그대로)

- 판정은 LLM 이 하지 않는다. 비교·가드레일·종료·가설 선택은 순수 함수, 에이전트는 스크립트 출력을 전달만 한다
- 환경 오류(exit 1)는 루프를 멈추고, 후보 탓(exit 2)만 crash 로 기록한다 — 이력이 오염되면 멀쩡한 가설이 영구히 빠진다
- 후보가 고칠 수 있는 경로는 허용 목록으로 제한하고, 엔진 상태 파일은 설정과 무관하게 항상 금지한다
- push·병합하지 않는다. keep 커밋은 루프 브랜치에만 남는다

## 구조

```
plugins/team-perf-loop/
├─ .claude-plugin/plugin.json
├─ skills/
│  ├─ perf-loop/SKILL.md          한 회차 실행 (FinSight /perf-loop 커맨드의 일반화)
│  └─ perf-loop-init/SKILL.md     설정 초안 작성 + 도구 설치 + 벤치 준비
├─ workflows/perf-loop.js         Workflow 스크립트 (lighthouse-loop.js 일반화)
├─ engine/
│  ├─ round.mjs                   baseline / evaluate / wait  (원형 round.mjs)
│  ├─ judge.mjs                   decide / pickHypotheses / shouldStop / 이력  (원형 judge.mjs)
│  ├─ config.mjs                  설정 로드·검증·기본값
│  ├─ scope.mjs                   glob → 정규식, 경로 검사
│  ├─ server.mjs                  preflight / build / checks / withServer / 인증
│  └─ tools.mjs                   공용 도구 디렉터리에서 import
├─ measurers/lighthouse.mjs       (원형 measure.mjs 의 Lighthouse 부분)
├─ gates/screenshots.mjs          (원형 shots.mjs)
├─ templates/                     spring-thymeleaf.json · nextjs.json · guide 초안
└─ tools/package.json + lock      lighthouse · chrome-launcher · puppeteer-core · sharp (버전 고정)
```

프로젝트 쪽에 생기는 것:

```
<project>/
├─ .claude/perf-loop.json         설정 (커밋)
├─ .claude/perf-loop/guide.md     후보 에이전트 지침 (원형 program.md 의 "후보 에이전트 지침")
└─ .perf-loop/results.tsv         이력 (루프 브랜치에만 커밋됨)
   .perf-loop/.local/             best.json·측정 로그·스크린샷 (gitignore)
```

### 의존성 — 머신 공용 디렉터리

`~/.cache/perf-loop/tools/` 에 `tools/package.json` 을 복사하고 `npm ci`. `perf-loop-init` 이
lock 해시가 다를 때만 다시 설치한다. 엔진은 `createRequire('~/.cache/perf-loop/tools/package.json')`
로 경로를 풀어 동적 import 한다(ESM 은 `NODE_PATH` 를 보지 않는다).

- 플러그인 디렉터리에 두지 않는다: 플러그인 캐시는 재클론되어 `node_modules` 가 사라진다
- 프로젝트 devDeps 에 두지 않는다: Java 프로젝트에 `package.json` 을 만들 수는 없다
- 엔진 자체는 Node 22 stdlib 만 쓴다. glob 은 `path.matchesGlob` 이 22.x 에서 experimental 이라 `scope.mjs` 에 작은 변환기를 둔다(`**`·`*`·`?` 만)

### 벤치

`~/.cache/perf-loop/<repo 이름>-<경로 해시 6자>/bench` — 루프 브랜치를 체크아웃한 worktree.
저장소 밖에 두는 이유는 원형과 같다(Stop 훅·IDE·빌드 도구가 벤치를 건드리지 않게).
`copyFiles` 의 gitignore 파일(`.env` 등)을 복사하고 `setup` 명령을 돌린다.

엔진 코드가 프로젝트 밖(플러그인)으로 나오므로 원형의 "루프 브랜치의 스크립트가 main 보다 앞서 있을 수 있다"
문제와 `scriptPath` 우회가 사라진다. 대신 **플러그인 버전**이 결과에 영향을 준다 → `results.tsv`
기준선 줄의 description 에 엔진 버전을 남긴다.

## 설정 — `.claude/perf-loop.json`

```jsonc
{
  "loopBranch": "perf/loop",
  "copyFiles": [".env", ".env.local"],
  "setup": ["npm ci"],                       // 벤치 생성 시 + main 병합으로 lock 이 바뀌었을 때
  "preflight": [                             // 실패 = 환경 오류 → 멈춤. fix 는 안내만, 자동 실행 안 함
    { "name": ".env.local", "cmd": "test -f .env.local", "fix": "cp ../.env.local ." },
    { "name": "로컬 Supabase", "cmd": "curl -sf -o /dev/null http://127.0.0.1:54321/rest/v1/", "fix": "npx supabase start" }
  ],
  "checks": {                                // 실패 = 후보 crash
    "beforeBuild": ["npm run lint"],
    "afterBuild": ["npx tsc --noEmit", "npx vitest run"]
  },
  "build": "npm run build",                  // 실패 = 후보 crash
  "server": {
    "start": "node_modules/.bin/next start -p {port}",
    "port": 3100,
    "readyPath": "/",
    "readyTimeoutSec": 60
  },
  "auth": { "cookieCmd": "sh scripts/lighthouse/cookie.sh" },   // 없으면 null. stdout = [{name,value}]
  "measurer": {
    "type": "lighthouse",
    "runs": 3,
    "pages": [{ "path": "/", "auth": false }, { "path": "/dashboard", "auth": true }]
  },
  "gate": {
    "type": "screenshots",                   // 없으면 null — 화면 회귀를 막을 장치가 없다는 경고를 init 이 남긴다
    "screens": [{ "path": "/", "auth": false }],
    "freezeDateTz": "Asia/Seoul"             // 선택. 화면에 서버 날짜가 찍히는 앱만. 기준선과 날짜가 바뀌면 환경 오류
  },
  "scope": {
    "allow": ["src/components/**", "src/app/**/page.tsx", "next.config.ts", "public/**"],
    "deny": ["**/*.test.*", "**/.env*", "package.json", "package-lock.json"]
  },
  "thresholds": { "minGain": 1, "target": 90, "stallRounds": 5, "maxRounds": 20, "candidates": 3 },
  "guide": ".claude/perf-loop/guide.md"
}
```

- 명령은 전부 벤치를 cwd 로 `sh -c` 실행한다. `{port}` 만 치환한다
- 엔진이 설정과 무관하게 항상 금지하는 경로: `.claude/**`, `.perf-loop/**`
- `config.mjs` 가 필수 키·타입·`measurer.type`·`gate.type` 을 검증하고, 틀리면 baseline 전에 환경 오류로 멈춘다

### Spring Boot + Thymeleaf 템플릿 (init 이 채우는 초안)

```jsonc
{
  "setup": [],
  "build": "./gradlew bootJar -x test",
  "checks": { "beforeBuild": [], "afterBuild": ["./gradlew test"] },
  "server": { "start": "java -jar build/libs/*-SNAPSHOT.jar --server.port={port}", "port": 3100, "readyPath": "/actuator/health", "readyTimeoutSec": 120 },
  "auth": { "cookieCmd": "<init 이 Spring Security 설정을 읽고 작성 — form login 이면 POST /login 후 JSESSIONID>" },
  "scope": {
    "allow": ["src/main/resources/templates/**", "src/main/resources/static/**", "src/main/resources/application*.yml", "src/main/java/**/config/**"],
    "deny": ["src/test/**", "build.gradle*", "settings.gradle*", "src/main/resources/db/**"]
  }
}
```

Maven 이면 `./mvnw -q package -DskipTests` / `target/*.jar`. 후보 worktree 는 `~/.gradle`·`~/.m2` 캐시를
공유하므로 node 처럼 의존성 문제가 없다. `./gradlew test` 가 후보마다 돌아 회차가 길어지므로
init 이 `test` 소요 시간을 한 번 재서 안내한다.

## 인터페이스 — 2단계가 끼워질 자리

### 측정기 (`measurers/<type>.mjs`)

```js
export const direction = 'higher'          // 'higher' | 'lower' (2단계 p95 는 lower)
export async function measure({ baseUrl, cookies, config, log }) → {
  score,                                   // 판정 지표 하나 (원형 perfAvg)
  units: [{ id, score, guards: { a11y, bp, seo } }],   // 원형 perPage. guards 는 기준선보다 나빠지면 discard
  opportunities: [{ id, savings, units: [id] }],       // 원형 opportunities(auditId·savingsMs·pages). 없으면 []
}
```

`judge.mjs` 는 `perfAvg`·`auditId`·`savingsMs` 이름을 `score`·`id`·`savings` 로 바꾸고, `direction` 에 따라
`gain` 부호를 뒤집는다. 가드는 "기준선보다 낮아지면 안 되는 수치" 로만 다룬다(이름을 모른다).

`opportunities` 가 비면 `no-hypotheses` 로 끝난다. 2단계 백엔드 측정기가 무엇을 가설로 줄지
(프로파일러 hot method, slow query) 는 2단계에서 정한다.

### 관문 (`gates/<type>.mjs`)

```js
export async function captureRef({ baseUrl, cookies, config }, refDir)
export async function check({ baseUrl, cookies, config }, refDir, outDir) → { ok, diffs: [string] }
```

관문 실패는 `visual` 대신 일반화한 `gate` 상태로 기록한다. 측정기보다 먼저 돌고, 실패하면 측정하지 않는다(원형과 같음).

### 상태 분류 — 원형에서 바뀌는 한 곳

| 상황 | 원형 | 일반화 |
|---|---|---|
| 후보 서버가 `readyTimeoutSec` 안에 안 뜸 | 환경 오류(멈춤) | **crash** — 서버를 띄우기 직전 같은 후보의 preflight 가 통과했으므로 환경은 살아 있다. Spring 빈 설정을 깨뜨린 후보가 회차 전체를 멈추면 안 된다 (2026-10-12 사용자 승인) |

이 변경의 위험: preflight 와 서버 기동 사이에 환경이 죽으면 crash 로 오기록된다. 가설은 실패 2회에서 제외되므로 1회 오기록으로 버려지지는 않는다.
| 그 밖 (preflight 실패·리다이렉트·이동 예외·5xx 등) | 원형 그대로 | 원형 그대로 |

## 실행 흐름 (스킬)

**`/perf-loop-init`** — 프로젝트당 1회
1. 스택 판별(`build.gradle`·`pom.xml`·`package.json`+`next`) → 템플릿 선택
2. 프로젝트를 읽어 설정 초안 작성 — 측정 페이지·촬영 화면·scope·auth `cookieCmd` 스크립트
3. 사용자에게 초안을 보여주고 승인받은 뒤 저장
4. 도구 설치(`~/.cache/perf-loop/tools`), 루프 브랜치·벤치 생성, `setup`
5. **실증:** 벤치에서 preflight → build → 서버 → 쿠키 → 모든 페이지 200 확인 → 기준 화면 미리보기 2장.
   통과해야 init 완료. 안 되면 무엇이 막혔는지 보여주고 멈춘다

**`/perf-loop [라운드 수]`** — FinSight `/perf-loop` 커맨드 절차와 같다
사전 점검(벤치 브랜치·깨끗함, main ff 병합, preflight, 포트) → 기준 화면 확인(사람 승인) →
`Workflow({ scriptPath: '<플러그인 루트>/workflows/perf-loop.js', args: { bench, engine, rounds } })`
→ 결과 정리. 회차 번호는 받지 않는다(이력에서 자동). 자정 검사는 `gate.freezeDateTz` 가 있을 때만.

## 1단계 작업 순서

0. **스파이크** — 저장소 밖(플러그인 캐시) 경로의 스크립트를 `Workflow({ scriptPath })` 로 부를 수 있는지.
   **2026-10-12 통과** — scratchpad 의 에이전트 0개짜리 스크립트가 실행되고 `args` 가 그대로 전달됐다
1. 플러그인 골격 + `config.mjs`·`scope.mjs` (테스트 먼저)
2. `judge.mjs` 일반화 — 원형 `judge.test.mjs` 를 이름만 바꿔 이식해 같은 판정이 나오는지 확인 + `direction` 테스트 추가
3. `server.mjs`·`measurers/lighthouse.mjs` — 원형 `measure.test.mjs` 이식
4. `gates/screenshots.mjs` — 원형 `shots.test.mjs` 이식
5. `round.mjs` — 원형 `round.test.mjs` 이식 + 서버 미기동 crash 테스트
6. 워크플로 + 스킬 2개 + 템플릿
7. **FinSight 회귀** — FinSight 설정 파일 작성(아래), 같은 커밋에서 플러그인 baseline 을 돌려
   - 기준 화면 22장이 원형 `shots.mjs ref` 결과와 픽셀 단위로 같은지
   - `score` 가 원형 baseline(77.33) 과 노이즈 범위(±2) 안인지, opportunities 상위 3개가 같은지

   FinSight 의 `scripts/lighthouse/` 는 이 단계에서 지우지 않는다. 회귀가 통과한 뒤 별도로 정한다
8. **Spring 샘플 앱 E2E** — `examples/spring-thymeleaf/`: Spring Boot 3 + Thymeleaf + Security(form login) + Actuator,
   페이지 2~3개(공개 1·로그인 필요 1~2). 루프가 고칠 거리가 있도록 압축·캐시 헤더 없음, 무거운 정적 리소스.
   `/perf-loop-init` 이 스택을 판별하고 설정 초안을 만들고, 실증(쿠키·200·미리보기)을 통과하는지,
   `/perf-loop` 1회가 끝까지 도는지 확인한다. 플러그인을 고칠 때마다 다시 돌리는 회귀 대상으로 남긴다

**1단계 완료 조건:** 단위 테스트 통과 + 7(FinSight 회귀) + 8(Spring 샘플 E2E).

테스트는 원형처럼 `node --test`. OpenAI·네트워크 호출 없음.

## FinSight 설정 대응표 (회귀용)

| 원형 위치 | 설정 |
|---|---|
| `measure.mjs` preflight `.env.local`·Supabase·포트 | `preflight` 2개 + 엔진 공통 포트 검사 |
| `make-cookie.mjs` + `.env.local` 의 anon key | `auth.cookieCmd` — anon key 를 읽어 넘기는 2줄 셸 스크립트를 FinSight 에 추가 |
| `pages.json` / `screens.json` | `measurer.pages` / `gate.screens` |
| `judge.mjs` FORBIDDEN·ALLOWED | `scope.deny` / `scope.allow` (glob 으로 변환) |
| `inspect()` lint → build → tsc → vitest | `checks.beforeBuild` / `build` / `checks.afterBuild` |
| `seoulDate`·`gateResult` 날짜 확인 | `gate.freezeDateTz: "Asia/Seoul"` |
| `program.md` 후보 지침 | `.claude/perf-loop/guide.md` |
| `results.tsv` (run 1~2 이력) | `.perf-loop/results.tsv` 로 옮긴다 — 열 이름이 바뀌므로 헤더만 갱신 |

### 플러그인 루트 찾기

`${CLAUDE_PLUGIN_ROOT}` 에 기대지 않고 `team-security-scan` 의 관례를 따른다 — 캐시에 구버전이 함께 남으므로
버전 정렬로 최신 설치본을 고정한다.

```bash
ROOT=$(find "$HOME/.claude/plugins/cache" -path '*team-perf-loop/*/engine/round.mjs' 2>/dev/null | sort -V | tail -1)
ROOT=${ROOT%/engine/round.mjs}
[ -d "$ROOT" ] || echo "PERF_LOOP_NOT_INSTALLED"
```

## 구현 중 바뀐 것

- **후보 worktree 를 엔진 쪽에서 만든다.** 원형은 후보 에이전트를 `isolation: 'worktree'` 로 띄웠는데, 이 worktree 는
  **세션 cwd 저장소**에 생긴다. 세션이 FinSight 에 있는 채로 다른 프로젝트의 루프를 돌리면 후보가 엉뚱한 저장소에서
  일한다. 후보 프롬프트가 `git -C <벤치> worktree add -b <후보 브랜치> <벤치>/../cand/<브랜치> <최고 커밋>` 으로
  직접 만들고 끝나면 지운다. 세션 cwd 제약이 사라졌다
- **`round.mjs measure`** — 기록·커밋 없는 단독 실측. 원형 `program.md` 의 "PR 전 11개 단독 실측" 과 FinSight 회귀 비교에 쓴다
- **`round.mjs preview`** — 원형 `shots.mjs ref` 에 해당. 관문이 없으면 build·기동·페이지 200 까지만
- **`cookieCmd`·`preflight` 에도 `{port}` 치환** — 쿠키 스크립트가 로그인 요청을 보낼 곳을 알아야 한다
- **도구 로딩** — `createRequire` 대신 도구 디렉터리 안의 `load.mjs` 가 `import()` 한다. ESM 전용 패키지의 exports 조건 문제를 피한다
- **`.perf-loop/.local/` 는 작업 트리 검사에서 뺀다** — 첫 실행의 측정 로그가 `.perf-loop/.gitignore` 보다 먼저 생긴다
- **로그인 쿠키를 브라우저 쿠키 저장소에 넣는다 + 최종 URL 검사** — 원형은 Lighthouse `extraHeaders` 로 넘겼는데,
  SEO 감사의 `robots.txt` 요청 같은 곳에는 헤더가 붙지 않는다. Spring 샘플에서 그 요청이 로그인 리다이렉트를 타며
  익명 `JSESSIONID` 를 심어 2·3회차가 `/login` 을 쟀고, 3회 중앙값이 로그인 페이지의 100점이 됐다(E2E run 1).
  사전 점검(fetch)·스크린샷 관문은 매번 깨끗한 상태라 이를 보지 못했다. 이제 페이지마다 Chrome 을 새로 띄워
  쿠키 저장소에 넣고, `finalDisplayedUrl` 이 요청 경로와 다르면 환경 오류(1)로 멈춘다.
  **FinSight 원형 `measure.mjs` 도 같은 방식이다** — 회귀 비교에서 이 검사가 드러낸다
- **상태 이름 `visual` → `gate`**, 열 이름 `auditId`·`perfAvg` → `hypothesis`·`score`

## 결정 사항

- 플러그인 이름 `team-perf-loop` — 마켓플레이스 관례(`team-*`)
- 서버 미기동은 crash (위 표, 2026-10-12 승인)
- 실제 Thymeleaf 프로젝트가 없으므로 검증용 샘플 앱을 만든다(아래 8번, 2026-10-12 결정)
