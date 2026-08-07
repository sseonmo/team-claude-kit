#!/usr/bin/env node
// PreToolUse 진입점 — stdin 파싱, 룰 순회, 출력. 판정 로직은 여기 두지 않는다.
//
// 두 가지를 절대 어기지 않는다:
//   1. 판정은 오직 JSON `permissionDecision` 으로 전달한다. 종료 코드로 차단하지 않는다.
//      (`exit 2` 는 차단이지만 사유가 구조적으로 전달되지 않고, `exit 1` 과 헷갈리는 순간
//       조용히 무력화된다 — 이 플러그인을 만들게 한 실제 사고가 그것이었다.)
//   2. 전 구간 fail-open. 판정 불능일 때는 통과시킨다. 원인 모를 차단을 만난 사용자가
//      다음에 하는 일은 훅을 끄는 것이고, 꺼진 훅은 없는 훅과 같다.

import fs from 'node:fs'
import os from 'node:os'
import * as d1 from '../lib/rules/d1-rm-rf.mjs'
import * as d3 from '../lib/rules/d3-force-push.mjs'

const RULES = [d1, d3]

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function main() {
  const raw = readStdin()
  if (!raw.trim()) return

  let input
  try {
    input = JSON.parse(raw)
  } catch {
    return
  }

  const ctx = { cwd: input.cwd, home: os.homedir() }

  // 모든 룰을 돌려 결과를 모은다. 먼저 걸린 것에서 return 하면
  // 어느 룰이 이길지가 파일 순서에 좌우된다.
  const results = []
  for (const rule of RULES) {
    try {
      const r = rule.check(input.tool_name, input.tool_input || {}, ctx)
      if (r) results.push(r)
    } catch {
      // 룰 하나가 죽어도 나머지는 계속 돈다
    }
  }

  // 우선순위: deny > ask > 통과
  const verdict =
    results.find((r) => r.decision === 'deny') || results.find((r) => r.decision === 'ask')
  if (!verdict) return

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: verdict.decision,
        permissionDecisionReason: verdict.reason,
      },
    })
  )
}

try {
  main()
} catch (e) {
  // 훅이 죽어도 도구는 실행된다. 원인만 한 줄 남긴다.
  process.stderr.write(`team-guardrails: ${e && e.message}\n`)
}
// process.exit() 를 부르지 않는다 — 파이프로 나가는 stdout 이 잘릴 수 있다.
// 정상 종료의 코드는 0 이고, 그게 이 훅이 내는 유일한 코드다.
