// D3 — `git push` 의 force 계열을 막는다. 단 `--force-with-lease` 는 통과시킨다.
//
// force push 는 남의 커밋을 지우고 되돌리기가 사실상 불가능하다.
// `--force-with-lease` 는 원격이 내가 아는 상태일 때만 성공하므로 남의 커밋을 지우지 않는다 —
// 이 룰이 막으려는 사고가 아니고, 예외로 두지 않으면 정당한 rebase 작업이 전부 막힌다.

import path from 'node:path'
import {
  splitSegments,
  tokenize,
  classifyArgv,
  stripRedirections,
  stripCommandPrefixes,
  stripUnknownWrapper,
} from '../shell-parse.mjs'

export const id = 'D3'

// 값을 따로 받는 git 전역 옵션. 건너뛰지 않으면 `git -C <경로> push` 에서
// 'push' 가 서브커맨드 자리에 오지 않아 룰이 통째로 빗나간다.
const GLOBAL_OPTS_WITH_VALUE = new Set(['-C', '-c'])

// 이 룰이 존재하는 이유가 이 한 줄이다 — force push 를 막는 것보다 안전한 대안으로 보내는 게 목적이다.
// deny·ask 어느 판정에서도, 진입점이 사유를 갈아끼우는 승격 경로에서도 이 줄은 살아남아야 한다.
const ALTERNATIVE_LEASE =
  '  · 되돌리려던 것이라면: git push --force-with-lease (원격이 예상과 다르면 실패하므로 안전합니다)'

export function check(toolName, toolInput, _ctx) {
  try {
    if (toolName !== 'Bash') return null

    const command = toolInput && toolInput.command
    if (typeof command !== 'string' || command === '') return null

    let asked = null // 확신이 없어 물을 것. 막을 것이 하나라도 나오면 그쪽이 이긴다.

    for (const segment of splitSegments(command)) {
      // 이 룰에는 이동 축이 없다 — `nice`·`timeout` 아래의 git 은 실제로 실행되므로 벗긴다
      let raw = stripCommandPrefixes(stripRedirections(tokenize(segment)), {
        execWrappers: true,
      })

      // 이름을 아는 래퍼를 벗겨도 git 이 안 나오면 **모르는 래퍼** 모양인지 본다.
      // 이름 목록은 닫히지 않으므로(0.2.1~0.2.3 이 그 방식으로 소모됐다) 확신할 수 없고,
      // 확신이 없으니 막지도 통과시키지도 않고 묻는다. D1 과 같은 처리다.
      let wrapper = null
      if (path.basename(raw[0] || '') !== 'git') {
        const wrapped = stripUnknownWrapper(raw, 'git')
        if (!wrapped) continue
        wrapper = raw.slice(0, raw.length - wrapped.length).join(' ')
        raw = wrapped
      }

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

      if (wrapper !== null) {
        asked = asked || {
          decision: 'ask',
          rule: 'D3',
          // 되묻기 안내와 달리 이 줄은 판정이 deny 로 바뀌어도 유효하다. 그래서 따로 낸다 —
          // 진입점이 승격할 때 reason 을 갈아끼우면서 이 줄까지 버리면
          // force push 를 막으면서 안전한 대안을 알려주지 않게 된다.
          alternative: ALTERNATIVE_LEASE,
          reason:
            `[guardrail D3] 알 수 없는 래퍼(${wrapper}) 뒤에 force push (${matched}) 가 있습니다.\n` +
            `  · 이 앞부분이 git 을 실제로 실행하는지 알 수 없어, 막지 않고 묻습니다.\n` +
            ALTERNATIVE_LEASE,
        }
        continue // 막을 것은 다음 세그먼트에서 계속 찾는다
      }

      return {
        decision: 'deny',
        rule: 'D3',
        reason:
          `[guardrail D3] force push 를 막았습니다 (${matched}). 원격의 남의 커밋이 지워질 수 있습니다.\n` +
          `${ALTERNATIVE_LEASE}\n` +
          `  · 정말 무조건 덮어써야 한다면 터미널에서 직접 실행하십시오.`,
      }
    }
    return asked
  } catch {
    return null // fail-open
  }
}
