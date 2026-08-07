// D1 — `rm -rf` 의 대상이 프로젝트 밖이면 막는다.
//
// 대상 경로를 보지 않고 `rm -rf` 를 무조건 막으면 `rm -rf node_modules` 까지 막힌다.
// 그런 훅은 오탐이 일상이 되고, 사용자는 훅을 끈다. 꺼진 훅은 없는 훅과 같다.
// 그래서 이 룰의 판정은 "명령이 무엇인가"가 아니라 "대상이 어디인가"다.

import path from 'node:path'
import {
  splitCommand,
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

/**
 * 같은 줄의 앞선 `cd` 를 반영한 기준 디렉토리.
 * 없으면 `cd /tmp && rm -rf junk` 의 `junk` 가 프로젝트 안으로 풀려 그냥 통과한다.
 * 어디로 갔는지 알 수 없으면 `null` — 그 뒤의 상대경로는 판정하지 않는다(fail-open).
 */
function nextBase(base, target, ctx) {
  if (target === undefined) return ctx.home // `cd` 단독은 홈으로 간다
  if (target === '-') return null // 직전 디렉토리 — 알 수 없다
  const p = expandHome(target, ctx)
  // 절대경로든 상대경로든 변수가 남아 있으면 어디로 갔는지 모른다.
  // 리터럴로 취급하면 실재하지 않는 경로를 기준 삼아 정상 삭제를 막는다.
  if (p.includes('$')) return null
  if (path.isAbsolute(p)) return p
  if (base === null) return null
  return path.resolve(base, p)
}

/** 판정 불능이면 null 을 돌려준다. */
function resolveTarget(raw, base, ctx) {
  const p = expandHome(raw, ctx)
  // 셸 변수는 펴지 않는다. 리터럴로 취급하면 존재하지도 않는 경로를 사유에 찍으며 막게 된다.
  if (p.includes('$')) return null
  if (path.isAbsolute(p)) return path.resolve(p)
  if (base === null) return null
  return path.resolve(base, p)
}

// 실제 셸에서 파이프·백그라운드로 이어지는 명령은 서브셸에서 돌아 cd 가 밖으로 나오지 않는다.
const CD_ESCAPES = new Set([';', '&&', '||', '(', ')', null])

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

    // 기준 디렉토리는 서브셸 인스턴스마다 따로 둔다.
    // 새 스코프는 자기를 감싼 스코프의 현재 기준을 물려받는다.
    const baseByScope = new Map([[0, ctx.cwd]])

    for (const seg of splitCommand(command)) {
      if (!baseByScope.has(seg.scopeId)) {
        baseByScope.set(seg.scopeId, baseByScope.get(seg.parentScope) ?? ctx.cwd)
      }
      const base = baseByScope.get(seg.scopeId)

      const tokens = stripCommandPrefixes(stripRedirections(tokenize(seg.text)))
      const { argv, short, long } = classifyArgv(tokens)
      const name = path.basename(argv[0] || '')

      if (name === 'cd') {
        if (CD_ESCAPES.has(seg.sepAfter)) {
          baseByScope.set(seg.scopeId, nextBase(base, argv[1], ctx))
        }
        continue
      }
      if (name !== 'rm') continue

      // 표기·순서를 흡수한 뒤의 판정은 이 두 줄이 전부다
      const recursive = short.has('r') || short.has('R') || long.has('recursive')
      const force = short.has('f') || long.has('force')
      if (!recursive || !force) continue

      for (const raw of argv.slice(1)) {
        const resolved = resolveTarget(raw, base, ctx)
        if (resolved === null) continue // 기준 디렉토리를 모른다 — 막지 않는다

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
