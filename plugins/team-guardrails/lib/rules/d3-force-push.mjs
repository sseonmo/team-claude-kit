// D3 — `git push` 의 force 계열을 막는다. 단 `--force-with-lease` 는 통과시킨다.
//
// force push 는 남의 커밋을 지우고 되돌리기가 사실상 불가능하다.
// `--force-with-lease` 는 원격이 내가 아는 상태일 때만 성공하므로 남의 커밋을 지우지 않는다 —
// 이 룰이 막으려는 사고가 아니고, 예외로 두지 않으면 정당한 rebase 작업이 전부 막힌다.

import path from 'node:path'
import { splitSegments, tokenize, classifyArgv, stripRedirections } from '../shell-parse.mjs'

export const id = 'D3'

// 값을 따로 받는 git 전역 옵션. 건너뛰지 않으면 `git -C <경로> push` 에서
// 'push' 가 서브커맨드 자리에 오지 않아 룰이 통째로 빗나간다.
const GLOBAL_OPTS_WITH_VALUE = new Set(['-C', '-c'])

export function check(toolName, toolInput, _ctx) {
  try {
    if (toolName !== 'Bash') return null

    const command = toolInput && toolInput.command
    if (typeof command !== 'string' || command === '') return null

    for (const segment of splitSegments(command)) {
      let raw = stripRedirections(tokenize(segment))
      if (raw[0] === 'sudo') raw = raw.slice(1)
      if (path.basename(raw[0] || '') !== 'git') continue

      // `git` 자신과 값을 받는 전역 옵션을 걷어내면 서브커맨드가 맨 앞에 온다
      const tokens = []
      for (let i = 1; i < raw.length; i++) {
        if (GLOBAL_OPTS_WITH_VALUE.has(raw[i])) {
          i++
          continue
        }
        tokens.push(raw[i])
      }

      const { argv, short, long } = classifyArgv(tokens)
      if (argv[0] !== 'push') continue

      // `--force-with-lease`·`--force-if-includes` 는 long 에 별개 이름으로 들어오므로
      // 여기서 자동으로 걸러진다 — 접두사 매칭을 쓰면 이 예외가 무너진다.
      let matched = null
      if (long.has('force')) matched = '--force'
      else if (short.has('f')) matched = '-f'
      else matched = argv.slice(1).find((a) => a.startsWith('+')) || null

      if (!matched) continue

      return {
        decision: 'deny',
        rule: 'D3',
        reason:
          `[guardrail D3] force push 를 막았습니다 (${matched}). 원격의 남의 커밋이 지워질 수 있습니다.\n` +
          `  · 되돌리려던 것이라면: git push --force-with-lease (원격이 예상과 다르면 실패하므로 안전합니다)\n` +
          `  · 정말 무조건 덮어써야 한다면 터미널에서 직접 실행하십시오.`,
      }
    }
    return null
  } catch {
    return null // fail-open
  }
}
