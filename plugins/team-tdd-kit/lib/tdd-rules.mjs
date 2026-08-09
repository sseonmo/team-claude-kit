// TDD Guard — PreToolUse[Edit|Write]
//
// 구현 코드를 작성하거나 수정하려 할 때, 해당 모듈의 테스트 파일이 **먼저** 존재하는지 확인한다.
// 테스트 없이 구현 코드에 손대려 하면 차단한다.
//
// 판정 로직 — Java · Python · Node 세 언어.
//
// 두 가지를 지킨다:
//   1. **신규·기존을 가리지 않는다.** 테스트가 없으면 새 파일을 만들 때도, 있는 파일을
//      고칠 때도 막는다. 신규만 막으면 *기존 파일에 테스트 없이 기능을 덧붙이는 것*이
//      그대로 통과하는데, 실제 코드가 자라는 곳이 대개 거기다.
//      대가로 테스트 없는 레거시는 테스트를 먼저 쓰기 전까지 손댈 수 없다 — 의도된 마찰이다.
//   2. **모르는 언어는 통과시킨다.** Go·Rust 등은 검사 대상이 아니며, 그건
//      "검사했고 문제없음"이 아니라 "검사하지 않음"이다. README 에 지원 범위를 밝혀 둔다.
//
// 테스트 파일은 존재 여부만 본다. 내용은 보지 않으므로 빈 파일로도 게이트는 열린다 —
// 이 훅은 실수 방지용이고, 우회는 리뷰에서 잡는다는 전제다.

import path from 'node:path'

const NODE_EXTS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs']

// 테스트를 모아 두는 디렉터리. 후보 탐색과 "이건 테스트 파일이다" 판정이 **같은 목록**을
// 봐야 한다. 한쪽만 넓히면 `test/` 를 테스트 위치로 인정하면서 그 안의 헬퍼·픽스처는
// 차단하게 되고, 안내는 헬퍼의 테스트를 쓰라고 한다.
const TEST_DIRS = new Set(['__tests__', 'test', 'tests'])

// Next.js 라우팅 파일. **`app/` 또는 `pages/` 안에 있을 때만** 예외다 —
// 이름만 보면 `lib/page.ts`(페이지네이션 헬퍼) · `lib/error.js`(에러 팩토리) 처럼
// Next.js 와 무관한 평범한 모듈이 통째로 빠져나간다.
const NEXT_ROUTE_FILES = new Set(['layout', 'page', 'loading', 'error', 'not-found'])
const NEXT_ROUTE_DIRS = new Set(['app', 'pages'])

// 디렉터리 예외는 **세그먼트 단위**로만 본다.
// 경로 문자열에 부분일치를 걸면 `tailwind-app/` 같은 상위 폴더 이름 하나로
// 그 아래 트리 전체가 조용히 무력화된다(0.1.0 의 실제 구멍이었다).
const NODE_EXEMPT_DIRS = new Set(['types', 'components'])
const PYTHON_EXEMPT_DIRS = new Set(['migrations'])

const PYTHON_EXEMPT_FILES = new Set(['__init__.py', 'setup.py', 'conftest.py', 'manage.py'])
const JAVA_EXEMPT_FILES = new Set(['package-info.java', 'module-info.java'])

function languageOf(filePath) {
  const ext = path.extname(filePath).slice(1)
  if (NODE_EXTS.includes(ext)) return 'node'
  if (ext === 'py') return 'python'
  if (ext === 'java') return 'java'
  return null
}

const segmentsOf = (filePath) => filePath.split('/').filter(Boolean)

// 그 언어에서 "이건 테스트 파일이다" 로 통하는 이름·위치.
// 여기가 빠지면 테스트를 쓰려는 시도 자체가 차단된다 — 확장자만 늘리고 이걸 안 늘리면
// pytest 의 tests/test_x.py, JUnit 의 XTest.java 가 전부 오탐으로 막힌다.
function isTestFile(filePath) {
  const base = path.basename(filePath)
  const segs = segmentsOf(path.dirname(filePath))

  switch (languageOf(filePath)) {
    case 'node':
      return /\.(test|spec)\./.test(base) || segs.some((s) => TEST_DIRS.has(s))
    case 'python':
      return (
        base.startsWith('test_') ||
        /_test\.py$/.test(base) ||
        base === 'conftest.py' ||
        segs.some((s) => TEST_DIRS.has(s))
      )
    case 'java':
      return /(Test|Tests|TestCase)\.java$/.test(base) || isUnderJavaTestRoot(filePath)
    default:
      return false
  }
}

const isUnderJavaTestRoot = (filePath) => filePath.includes('/src/test/')

// 테스트를 요구하지 않는 파일. 설정·타입 선언·프레임워크 규약 파일처럼
// 단위 테스트의 대상이 아닌 것들.
function isExempt(filePath) {
  const base = path.basename(filePath)
  const segs = segmentsOf(path.dirname(filePath))

  switch (languageOf(filePath)) {
    case 'node':
      return (
        base.endsWith('.d.ts') ||
        // basename 기준이다. 경로 어딘가에 `.config.` 가 있다고 예외로 두면
        // `app.config.d/lib/auth.ts` 가 통과한다.
        /\.config\.[^.]+$/.test(base) ||
        (NEXT_ROUTE_FILES.has(base.slice(0, -path.extname(base).length)) &&
          segs.some((s) => NEXT_ROUTE_DIRS.has(s))) ||
        segs.some((s) => NODE_EXEMPT_DIRS.has(s))
      )
    case 'python':
      return PYTHON_EXEMPT_FILES.has(base) || segs.some((s) => PYTHON_EXEMPT_DIRS.has(s))
    case 'java':
      return JAVA_EXEMPT_FILES.has(base)
    default:
      return false
  }
}

// 인정할 테스트 파일의 후보 경로. 언어마다 관례가 갈리는 축이 두 개다 —
// 구분자(`.` vs `_` vs CamelCase)와 배치(같은 폴더 vs 미러링된 별도 트리).
//
// `root` 는 이 파일이 속한 **패키지 루트**다(없으면 프로젝트 루트). 모노레포에서
// 저장소 루트를 기준 삼으면 패키지 안에 모여 있는 테스트를 못 찾는다.
function testCandidates(filePath, root) {
  const dir = path.dirname(filePath)
  const parent = path.dirname(dir)
  const ext = path.extname(filePath)
  const name = path.basename(filePath, ext)

  switch (languageOf(filePath)) {
    case 'node': {
      // 테스트를 모아 두는 디렉터리 관례가 러너마다 다르다 — `__tests__/` 는 jest·vitest,
      // `test/`·`tests/` 는 node:test·mocha·ava 쪽이다. 후자를 빼면 그 레이아웃을 쓰는
      // 저장소는 테스트가 멀쩡히 있는데도 모든 소스가 잠긴다(이 저장소가 정확히 그 경우였다).
      //
      // 같은 폴더 → 부모 → 패키지 루트 순으로 넓힌다.
      const dirs = [dir]
      for (const anchor of [dir, parent]) {
        for (const d of ['__tests__', 'test', 'tests']) dirs.push(`${anchor}/${d}`)
      }
      // 패키지 루트의 test/ 는 플랫도 인정한다 — 이 저장소처럼 `lib/rules/x.mjs` 의
      // 테스트를 `test/x.test.mjs` 에 평평하게 모으는 배치가 흔하다.
      // 저장소 루트가 아니라 **패키지 루트**라서, 이름만 같은 테스트로 뚫리는 범위가
      // 그 패키지 안으로 제한된다.
      if (root) {
        const mirrored = mirrorUnderRoot(dir, root)
        for (const d of ['test', 'tests', '__tests__']) {
          dirs.push(`${root}/${d}`)
          if (mirrored) dirs.push(`${root}/${d}/${mirrored}`)
        }
      }

      // 대상 파일과 같은 확장자를 먼저 본다. 첫 후보가 곧 거부 메시지의 안내 예시라,
      // 순서를 고정하면 `.js` 파일에 `.test.ts` 를 만들라고 안내하게 된다 —
      // 러너가 잡지 못하는 테스트 파일이 생기고, 그 존재만으로 게이트가 영구히 열린다.
      const own = ext.slice(1)
      const out = []
      for (const e of [own, ...NODE_EXTS.filter((x) => x !== own)]) {
        for (const kind of ['test', 'spec']) {
          for (const d of dirs) out.push(`${d}/${name}.${kind}.${e}`)
        }
      }
      return out
    }

    case 'python': {
      const names = [`test_${name}.py`, `${name}_test.py`]
      const out = []
      for (const n of names) {
        out.push(`${dir}/${n}`)
        out.push(`${dir}/tests/${n}`)
        out.push(`${parent}/tests/${n}`)
        if (root) {
          // 루트 tests/ 는 pytest 에서 가장 흔한 배치다. 미러링(tests/services/test_x.py)과
          // 플랫(tests/test_x.py) 을 모두 인정한다 — 플랫 쪽은 모듈명이 같으면
          // 같은 패키지 안 다른 모듈의 테스트로도 통과된다. 관례를 존중한 대가이고, README 에 적어 둔다.
          out.push(`${root}/tests/${n}`)
          out.push(`${root}/test/${n}`)
          const mirrored = mirrorUnderRoot(dir, root)
          if (mirrored) {
            out.push(`${root}/tests/${mirrored}/${n}`)
            out.push(`${root}/test/${mirrored}/${n}`)
          }
        }
      }
      return out
    }

    case 'java': {
      const names = [`${name}Test.java`, `${name}Tests.java`]
      // Maven·Gradle 의 src/main ↔ src/test 미러링. 패키지 경로는 그대로 유지된다.
      const testDir = dir.includes('/src/main/java/')
        ? dir.replace('/src/main/java/', '/src/test/java/')
        : dir
      return names.map((n) => `${testDir}/${n}`)
    }

    default:
      return []
  }
}

// 루트 기준 상대 디렉터리에서 선행 `src/` 를 뗀다.
// `<root>/src/services` → `services` (→ `<root>/tests/services/test_x.py`)
function mirrorUnderRoot(dir, root) {
  const rel = path.relative(root, dir)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  const segs = rel.split('/').filter(Boolean)
  if (segs[0] === 'src') segs.shift()
  return segs.join('/')
}

// 이 파일이 속한 패키지의 루트 — `package.json` 이 있는 가장 가까운 조상.
// 모노레포에서 저장소 루트를 기준 삼으면 `plugins/<n>/test/` 처럼 패키지 안에
// 모여 있는 테스트를 못 찾는다.
//
// 훅 입력의 cwd 에서 멈추지 않는다. cwd 는 사용자가 어디서 claude 를 띄웠는지일 뿐이라
// 패키지 루트보다 깊을 수 있고, 거기서 끊으면 테스트가 멀쩡히 있는 파일이 차단된다.
// 패키지 경계는 파일의 위치가 정하지, 셸의 위치가 정하지 않는다.
function nearestPackageRoot(dir, ctx) {
  let cur = dir
  for (;;) {
    if (ctx.exists(`${cur}/package.json`)) return cur
    const up = path.dirname(cur)
    if (up === cur) return null
    cur = up
  }
}

/**
 * @param {string} rawPath  만들거나 고치려는 파일의 절대 경로
 * @param {{exists: (p: string) => boolean, projectRoot?: string}} ctx
 * @returns {null | {decision: 'deny', reason: string}}
 *   null 은 통과. 지원하지 않는 언어도 null 이다 — "검사했고 문제없음"과 구분되지 않는다.
 */
export function check(rawPath, ctx) {
  if (typeof rawPath !== 'string' || rawPath === '') return null

  // 같은 파일을 가리키는 다른 표기가 다른 판정을 받으면 안 된다.
  // 정규화하지 않으면 `src/components/../lib/auth.ts` 가 `components` 예외로 빠져나간다.
  const filePath = path.normalize(rawPath)

  if (!languageOf(filePath)) return null
  if (isTestFile(filePath) || isExempt(filePath)) return null

  const root = nearestPackageRoot(path.dirname(filePath), ctx) || ctx.projectRoot
  const candidates = testCandidates(filePath, root)
  if (candidates.some((c) => ctx.exists(c))) return null

  const base = path.basename(filePath)
  const example = path.relative(ctx.projectRoot || path.dirname(filePath), candidates[0])
  return {
    decision: 'deny',
    reason: [
      `TDD GUARD: ${base} 에 대한 테스트 파일이 없습니다.`,
      `  · 테스트를 먼저 작성하십시오: ${example}`,
      '  · 기존 파일의 수정에도 적용됩니다. 레거시라면 지금 있는 동작을 고정하는 테스트부터 쓰십시오.',
    ].join('\n'),
  }
}
