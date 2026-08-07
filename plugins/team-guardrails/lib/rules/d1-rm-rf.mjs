// D1 — `rm -rf` 의 대상이 프로젝트 밖이면 막는다.
//
// 대상 경로를 보지 않고 `rm -rf` 를 무조건 막으면 `rm -rf node_modules` 까지 막힌다.
// 그런 훅은 오탐이 일상이 되고, 사용자는 훅을 끈다. 꺼진 훅은 없는 훅과 같다.
// 그래서 이 룰의 판정은 "명령이 무엇인가"가 아니라 "대상이 어디인가"다.
//
// **`cd` 가 어디로 갔는지는 해석하지 않는다.** 앞에 `cd` 가 나왔다는 사실만 보고,
// 그 뒤의 상대경로는 판정을 접는다. 절대경로는 그대로 판정한다.
//
// v0.1.1~0.1.7 이 `cd` 의 목적지를 추적했고 릴리스마다 오탐을 냈다 — 서브셸·형제 서브셸·
// 파이프·조건문·반복문·여러 줄 스크립트·브레이스 그룹·함수 정의가 전부 "그 `cd` 가 실제로
// 실행되는가"에 다르게 답하는데, 그건 문자열만 보고 알 수 없다.
// `deploy() { cd /tmp; }` 와 `{ cd /tmp; }` 는 글자가 거의 같지만 답이 반대다.
//
// 반대로 `cd` 를 통째로 무시해도 안 된다. `cd packages/app && rm -rf ../shared` 의 `..` 은
// 옮긴 위치 기준이라, 프로젝트 루트로 풀면 정상 명령이 "프로젝트 밖"이 된다.
// 그래서 "모른다"로 두는 것이 두 오탐을 동시에 피하는 유일한 자리다.
//
// 잃는 것은 `cd /tmp && rm -rf junk` 류의 미탐이다. 파국적인 대상(`/`·`~`·프로젝트 밖
// 절대경로)은 절대경로라 `cd` 와 무관하게 그대로 막힌다.

import path from 'node:path'
import {
  splitSegments,
  tokenize,
  classifyArgv,
  stripRedirections,
  stripCommandPrefixes,
} from '../shell-parse.mjs'

export const id = 'D1'

/** `~` 와 리터럴 `$HOME` 만 편다. 그 외 변수는 펴지 않는다(정적 판정의 한계 — 의도된 동작). */
function expandHome(p, ctx) {
  if (p === '~') return ctx.home
  if (p.startsWith('~/')) return path.join(ctx.home, p.slice(2))
  if (p === '$HOME' || p === '${HOME}') return ctx.home
  if (p.startsWith('$HOME/')) return path.join(ctx.home, p.slice(6))
  if (p.startsWith('${HOME}/')) return path.join(ctx.home, p.slice(8))
  return p
}

/** 판정 불능이면 null 을 돌려준다. */
function resolveTarget(raw, ctx, cdSeen) {
  const p = expandHome(raw, ctx)
  // 셸 변수는 펴지 않는다. 리터럴로 취급하면 존재하지도 않는 경로를 사유에 찍으며 막게 된다.
  if (p.includes('$')) return null
  // 앞에 cd 가 있었다면 이 상대경로가 어디를 가리키는지 모른다
  if (cdSeen && !path.isAbsolute(p)) return null
  return path.resolve(ctx.cwd, p)
}

/** 위험하면 사유 문자열을, 안전하면 null 을 돌려준다. */
function dangerOf(resolved, ctx) {
  if (resolved === '/') return '루트 디렉토리'
  if (resolved === ctx.home) return '홈 디렉토리'
  if (resolved === ctx.cwd) return '프로젝트 루트 자체(.git 포함)'
  const rel = path.relative(ctx.cwd, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return '프로젝트 밖'
  return null
}

export function check(toolName, toolInput, ctx) {
  try {
    if (toolName !== 'Bash') return null
    if (!ctx || !ctx.cwd || !ctx.home) return null // 판정 근거가 없으면 막지 않는다

    const command = toolInput && toolInput.command
    if (typeof command !== 'string' || command === '') return null

    let cdSeen = false // 목적지는 안 본다. 있었다는 사실만 본다.

    for (const segment of splitSegments(command)) {
      const tokens = stripCommandPrefixes(stripRedirections(tokenize(segment)))
      const { argv, short, long } = classifyArgv(tokens)
      const name = path.basename(argv[0] || '')

      if (name === 'cd') {
        cdSeen = true
        continue
      }
      if (name !== 'rm') continue

      // 표기·순서를 흡수한 뒤의 판정은 이 두 줄이 전부다
      const recursive = short.has('r') || short.has('R') || long.has('recursive')
      const force = short.has('f') || long.has('force')
      if (!recursive || !force) continue

      for (const raw of argv.slice(1)) {
        const resolved = resolveTarget(raw, ctx, cdSeen)
        if (resolved === null) continue // 판정 불능 — 막지 않는다

        const why = dangerOf(resolved, ctx)
        if (!why) continue

        return {
          decision: 'deny',
          rule: 'D1',
          reason:
            `[guardrail D1] rm -rf 대상이 ${why}입니다: ${resolved}\n` +
            `  · 프로젝트 안(${ctx.cwd})의 경로는 막지 않습니다 — node_modules·dist 삭제는 그대로 됩니다.\n` +
            `  · 정말 이 경로를 지워야 한다면 터미널에서 직접 실행하십시오.`,
        }
      }
    }
    return null
  } catch {
    return null // fail-open — 모르면 아무것도 하지 않는다
  }
}
