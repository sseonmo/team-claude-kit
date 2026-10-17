---
name: perf-loop-init
description: 프로젝트에 성능 최적화 루프(perf-loop)를 처음 붙인다 — 스택을 판별해 `.claude/perf-loop.json` 과 후보 지침 초안을 만들고, 승인받아 저장한 뒤 측정 도구 설치·루프 브랜치·벤치 worktree 를 준비하고 실제로 빌드·기동·로그인·촬영까지 돌려 본다. "perf-loop 붙여줘", "성능 루프 설정", "lighthouse 루프 초기화", "/perf-loop-init" 류 요청에 사용. 이미 설정이 있는 프로젝트에서 루프를 돌리는 것은 이 스킬이 아니라 perf-loop 다.
---

# perf-loop-init

설정 파일을 만드는 것으로 끝나지 않는다. **벤치에서 빌드 → 기동 → 쿠키 → 모든 페이지 200 → 기준 화면
미리보기까지 통과해야 완료다.** 초안만 쓰고 끝내면 첫 실행이 한 시간 뒤 사전 점검에서 멈춘다.

## 0. 플러그인 루트

캐시에는 구버전이 함께 남으므로 버전 정렬로 최신 설치본을 고정한다. 개발 중이면 `PERF_LOOP_ROOT` 가 우선한다.

```bash
ROOT=${PERF_LOOP_ROOT:-$(find "$HOME/.claude/plugins/cache" -path '*team-perf-loop/*/engine/round.mjs' 2>/dev/null | sort -V | tail -1)}
ROOT=${ROOT%/engine/round.mjs}
[ -f "$ROOT/engine/round.mjs" ] || echo "PERF_LOOP_NOT_INSTALLED"
```

이후 모든 명령은 **대상 저장소 루트**에서 `node "$ROOT/engine/info.mjs"` 로 벤치·도구 경로를 얻는다.
세션 cwd 가 다른 저장소여도 된다 — 각 Bash 호출에서 `cd <대상 루트> &&` 로 시작한다.

## 1. 전제 확인

- 대상이 git 저장소다(`git -C <대상> rev-parse --show-toplevel`). 이후 명령은 그 루트에서 실행한다
- `.claude/perf-loop.json` 이 이미 있으면 덮지 않는다. 무엇을 다시 할지(설정 수정 / 벤치 재생성 / 실증만) 묻는다
- `node -v` 가 22 이상, Chrome 설치(`ls "/Applications/Google Chrome.app"` 또는 `which google-chrome`)

## 2. 측정 도구 설치 (머신당 1회)

```bash
TOOLS=$(node "$ROOT/engine/info.mjs" | node -pe 'JSON.parse(require("fs").readFileSync(0)).tools')
mkdir -p "$TOOLS"
if ! cmp -s "$ROOT/tools/package.json" "$TOOLS/package.json" || [ ! -d "$TOOLS/node_modules" ]; then
  cp "$ROOT/tools/package.json" "$ROOT/tools/load.mjs" "$TOOLS/"
  [ -f "$ROOT/tools/package-lock.json" ] && cp "$ROOT/tools/package-lock.json" "$TOOLS/"
  (cd "$TOOLS" && npm install --no-audit --no-fund)
fi
cp "$ROOT/tools/load.mjs" "$TOOLS/"
```

## 3. 스택 판별 → 초안

| 표지 | 템플릿 | 지침 |
|---|---|---|
| `build.gradle*` 또는 `pom.xml` + `spring-boot-starter-thymeleaf` | `templates/spring-thymeleaf.json` | `guide-common.md` + `guide-spring-thymeleaf.md` |
| `package.json` 에 `next` | `templates/nextjs.json` | `guide-common.md` + `guide-nextjs.md` |
| 그 밖 | 둘 중 가까운 것을 고르고 build·start 를 직접 채운다 | `guide-common.md` 만 — 스택별 표는 사용자와 함께 쓴다 |

화면이 없는 순수 백엔드(API·배치)는 1단계 측정기(Lighthouse)로 잴 수 없다. 그 사실을 알리고 멈춘다.

템플릿을 출발점으로 **프로젝트를 읽어** 채운다. 추측으로 채운 값은 초안에 그렇다고 표시한다.

- **build/start** — Maven 이면 `./mvnw -q package -DskipTests` / `target/*.jar`. 래퍼(`gradlew`·`mvnw`)가 없으면 알린다.
  Spring 의 `readyPath` 는 Actuator 가 없으면 `/` 로 바꾼다(응답이 오기만 하면 기동으로 본다)
- **port** — `lsof -tiTCP:<port> -sTCP:LISTEN` 이 비어 있는 포트(기본 3100)
- **measurer.pages** — 대표 페이지 3개 이내. 공개 1 + 로그인 필요 1~2. 많을수록 회차가 길어진다(페이지당 약 1분 × runs)
  - Spring: `@GetMapping` 이 뷰 이름을 돌려주는 컨트롤러에서 고른다
  - 동적 경로(`/items/{id}`)는 실제로 200 이 나는 id 를 사용자에게 받는다
- **gate.screens** — 페이지보다 넓게. 측정하지 않는 화면의 회귀도 여기서 막힌다
- **gate.freezeDateTz** — 화면에 서버 기준 날짜(오늘·D-day·남은 일수)가 찍히는 앱만
- **auth** — 로그인 방식을 읽고 쿠키 명령을 만든다. 로그인이 없으면 `null`, 모든 `auth` 를 `false`
  - Spring Security form login: `templates/cookie-spring-form-login.sh` 를 `.claude/perf-loop/cookie.sh` 로 복사하고
    테스트 계정을 사용자에게 받는다. **비밀번호를 설정 파일에 그대로 쓸지 환경변수로 뺄지 묻는다**
  - 그 밖: stdout 에 `[{"name":..,"value":..}]` 를 출력하는 명령이면 된다. `{port}` 를 쓸 수 있다
- **preflight** — 서버가 의존하는 외부 것(DB·Redis·docker compose)마다 하나. `fix` 에 해결 명령
- **checks** — 컴파일·테스트. Spring 은 `./gradlew test` 를 **한 번 재서** 걸린 시간을 알린다(후보마다 돈다)
- **scope.allow** — 화면·정적 리소스·설정. 비즈니스 로직·테스트·빌드 파일·마이그레이션은 막는다

초안 검증: `node "$ROOT/engine/info.mjs" <초안 경로>` 의 `errors` 가 비어야 한다.

## 4. 승인 → 저장 → 커밋

설정 전문과 지침 차이(템플릿에서 바꾼 줄)를 보여주고 승인받는다. 승인 후:

- `.claude/perf-loop.json`, `.claude/perf-loop/guide.md`(공통 + 스택 지침 이어붙임), 필요하면 `.claude/perf-loop/cookie.sh`
- **커밋은 묻고 한다.** 벤치는 루프 브랜치를 체크아웃하므로 설정이 커밋되어 있어야 벤치에 보인다.
  커밋을 원치 않으면 여기서 멈추고 이유를 알린다

## 5. 루프 브랜치·벤치

```bash
eval "$(node "$ROOT/engine/info.mjs" | node -e 'const j=JSON.parse(require("fs").readFileSync(0));console.log(`BENCH=${j.bench}\nBRANCH=${j.config.loopBranch}`)')"
git branch "$BRANCH" HEAD                      # 이미 있으면 묻는다 — 지우거나 reset 하지 않는다
git worktree add "$BENCH" "$BRANCH"
```

- `copyFiles` 를 저장소 루트에서 벤치로 복사한다(gitignore 대상이라 worktree 에 따라오지 않는다)
- `setup` 명령을 벤치에서 차례로 실행한다
- 벤치를 저장소 밖에 두는 이유: Stop 훅·IDE·빌드 도구가 측정 중인 빌드 산출물을 덮어쓰지 않게

## 6. 실증 (완료 조건)

```bash
cd "$BENCH" && node "$ROOT/engine/round.mjs" preview .perf-loop/.local/shots/preview
```

Bash timeout 600000. `{"ok":true}` 가 나와야 한다. 실패하면 메시지 그대로 보여주고, 설정을 고쳐 커밋 →
벤치에서 `git merge --ff-only <원래 브랜치>` → 다시 실증. 통과하면 `preview/` 의 모바일·데스크톱 한 장씩을
`Read` 로 열어 보여준다(CSS 빠짐·로그인 화면이 찍혔으면 쿠키·리소스 문제다).

마지막에 한 줄: "준비됐습니다. `/perf-loop` 로 한 회차(기준선 + 2라운드)를 돌릴 수 있습니다."
