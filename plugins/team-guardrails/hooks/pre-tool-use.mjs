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

// `ask` 가 사용자에게 도달하지 않는 모드. 이 모드에서 훅이 `ask` 를 내면 프롬프트 없이
// 그대로 실행된다(2026-08-08 실측 — 같은 모드에서 `deny` 는 정상 차단된다).
// 그래서 여기서는 `ask` 를 `deny` 로 올린다. 올리지 않으면 "모르는 래퍼는 되묻는다"가
// 통째로 장식이 되고, 그 사실은 도구 실행 결과만 봐서는 드러나지 않는다.
const ASK_IS_SILENT = new Set(['bypassPermissions'])

// 룰의 reason 은 「첫 줄 = 무엇이 걸렸는가(사실) · 이후 `  · ` 줄 = 안내」 규약을 따른다.
// 승격하면 되묻기 안내가 거짓이 되므로(누를 수 없는 승인 버튼을 안내하게 된다) 사실만 남기고 갈아끼운다.
//
// 단 안내가 한 종류가 아니다. **대안 안내**(D3 의 `--force-with-lease`)는 판정이 deny 로 바뀌어도
// 여전히 유효한데, 통째로 버리면 그 룰이 존재하는 이유와 반대 방향으로 사용자를 민다.
// 그래서 룰이 `alternative` 로 따로 내주고, 여기서는 그것만 도로 끼운다 —
// reason 문자열에서 골라내려 하면 문구가 바뀔 때마다 조용히 어긋난다.
function promoteReason(reason, alternative) {
  const fact = String(reason).split('\n')[0]
  return [
    fact,
    '  · 원래는 되묻는 사안이지만, bypassPermissions 모드에서는 되묻기가 자동 승인되어 무의미하므로 차단했습니다.',
    ...(alternative ? [alternative] : []),
    '  · 의도한 명령이면 터미널에서 직접 실행하십시오.',
  ].join('\n')
}

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

  // 모드는 위험도와 다른 축이다. 룰은 "얼마나 위험한가"만 판단하고,
  // "그 판정이 사용자에게 닿는가"는 여기서 본다.
  const promote = verdict.decision === 'ask' && ASK_IS_SILENT.has(input.permission_mode)

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: promote ? 'deny' : verdict.decision,
        permissionDecisionReason: promote
          ? promoteReason(verdict.reason, verdict.alternative)
          : verdict.reason,
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
