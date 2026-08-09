#!/usr/bin/env node
// TDD Guard — 테스트 없이 구현 코드를 작성·수정하려 하면 차단한다.
//
// PreToolUse 진입점 — stdin 파싱, 판정 호출, 출력. 판정 로직은 여기 두지 않는다.
//
// 판정은 오직 JSON `permissionDecision` 으로 전달한다. 종료 코드로 차단하지 않는다.
// 전 구간 fail-open — 판정 불능이면 통과시킨다.

import fs from 'node:fs'
import { check } from '../lib/tdd-rules.mjs'

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

  const filePath = input.tool_input && input.tool_input.file_path
  if (!filePath) return

  const verdict = check(filePath, {
    exists: (p) => fs.existsSync(p),
    // git 을 부르지 않는다 — 훅 입력이 이미 프로젝트 루트를 알려준다.
    projectRoot: input.cwd,
  })
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
  process.stderr.write(`team-tdd-kit: ${e && e.message}\n`)
}
// process.exit() 를 부르지 않는다 — 파이프로 나가는 stdout 이 잘릴 수 있다.
