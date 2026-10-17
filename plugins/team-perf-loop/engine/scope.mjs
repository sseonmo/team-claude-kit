// 후보가 고칠 수 있는 경로 검사. glob 은 `**`·`*`·`?` 만 지원한다 —
// Node 22 의 path.matchesGlob 은 experimental 이라 경고를 찍는다.

// 엔진 상태와 설정은 설정과 무관하게 항상 막는다. 후보가 이력이나 판정 기준을 고치면 루프가 무의미해진다.
const ALWAYS_DENY = ['.perf-loop/**', '.claude/**']

export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?'
        i += 2
      } else {
        re += '.*'
        i += 1
      }
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

export function checkPaths(paths, { allow, deny }) {
  const denied = [...ALWAYS_DENY, ...deny].map(globToRegExp)
  const allowed = allow.map(globToRegExp)
  const violations = paths.filter((p) => denied.some((re) => re.test(p)) || !allowed.some((re) => re.test(p)))
  return { ok: violations.length === 0, violations }
}
