import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'pre-tool-use.mjs')

/** 훅을 실제 프로세스로 띄워 stdin JSON 을 먹인다. 인라인 훅이 못 하던 바로 그 검증이다. */
function invoke(payload, { raw } = {}) {
  const input = raw !== undefined ? raw : JSON.stringify(payload)
  const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

const bash = (command, extra = {}) => ({
  session_id: 'test-session',
  cwd: '/Users/tester/proj',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command },
  permission_mode: 'default',
  ...extra,
})

// ─────────────────────────────────────────────────────────────
// 종료 코드 — 이 플러그인이 존재하게 된 버그가 정확히 여기였다.
// 원래 훅은 `exit 1` 로 차단하려 했고, Claude Code 는 그걸 non-blocking error 로
// 취급해 도구를 그대로 실행했다. 판정은 오직 JSON 으로만 전달한다.
// ─────────────────────────────────────────────────────────────

test('진입점: 차단할 때도 종료 코드는 0 이다', () => {
  const r = invoke(bash('rm -rf /'))
  assert.equal(r.status, 0, '차단을 종료 코드로 표현하면 안 된다')
})

test('진입점: 통과할 때도 종료 코드는 0 이다', () => {
  assert.equal(invoke(bash('ls -la')).status, 0)
})

// ─────────────────────────────────────────────────────────────
// 판정 출력
// ─────────────────────────────────────────────────────────────

test('진입점: deny 는 permissionDecision JSON 으로 나온다', () => {
  const r = invoke(bash('rm -rf /'))
  const out = JSON.parse(r.stdout)
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse')
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /\[guardrail D1\]/)
})

test('진입점: D3 도 같은 형식으로 나온다', () => {
  const out = JSON.parse(invoke(bash('git push --force')).stdout)
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /\[guardrail D3\]/)
})

// 모르는 래퍼는 확신이 없어 묻는다. 훅 출력 스키마의 "ask" 가 그 자리다 —
// deny 로 내보내면 목록에 없다는 이유만으로 정상 명령을 막게 된다.
test('진입점: ask 는 permissionDecision "ask" 로 나온다', () => {
  const r = invoke(bash('ionice rm -rf /'))
  assert.equal(r.status, 0)
  const out = JSON.parse(r.stdout)
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse')
  assert.equal(out.hookSpecificOutput.permissionDecision, 'ask')
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /\[guardrail D1\]/)
})

test('진입점: D3 의 ask 도 같은 형식으로 나온다', () => {
  const out = JSON.parse(invoke(bash('ionice git push --force')).stdout)
  assert.equal(out.hookSpecificOutput.permissionDecision, 'ask')
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /\[guardrail D3\]/)
})

test('진입점: 다른 룰이 막으면 ask 보다 deny 가 앞선다', () => {
  const out = JSON.parse(invoke(bash('ionice rm -rf /; git push --force')).stdout)
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /\[guardrail D3\]/)
})

test('진입점: 통과는 아무것도 출력하지 않는다', () => {
  // "allow" 를 돌려주면 같은 자리의 다른 훅(tdd-guard 등) 판정까지 덮어쓴다
  assert.equal(invoke(bash('rm -rf node_modules')).stdout.trim(), '')
  assert.equal(invoke(bash('git push origin main')).stdout.trim(), '')
})

test('진입점: Bash 가 아닌 도구는 통과시킨다', () => {
  const r = invoke({ ...bash('x'), tool_name: 'Write', tool_input: { file_path: 'a.ts' } })
  assert.equal(r.status, 0)
  assert.equal(r.stdout.trim(), '')
})

// ─────────────────────────────────────────────────────────────
// bypassPermissions 승격 — `ask` 가 프롬프트를 띄우지 않는 모드
//
// 2026-08-08 실측: 이 모드에서 훅이 `ask` 를 내도 사용자에게 아무것도 묻지 않고
// 그대로 실행된다(같은 모드에서 `deny` 는 정상 차단된다). 확인 방법은 세션 transcript 의
// `"hookName":"PreToolUse:Bash"` 레코드 — 훅 stdout 이 판정째로 남아 있다.
// 도구 실행 결과만 보면 `ask` 자동승인과 `pass` 가 구별되지 않는다.
//
// 그래서 이 모드에서는 `ask` 를 `deny` 로 올린다. 올리지 않으면 "모르는 래퍼는 되묻는다"는
// 이 플러그인의 핵심 방어가 통째로 장식이 된다.
// ─────────────────────────────────────────────────────────────

const bypass = (command) => bash(command, { permission_mode: 'bypassPermissions' })

test('승격: bypassPermissions 에서 D1 의 ask 는 deny 로 나온다', () => {
  const out = JSON.parse(invoke(bypass('ionice rm -rf /')).stdout)
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /\[guardrail D1\]/)
})

test('승격: bypassPermissions 에서 D3 의 ask 도 deny 로 나온다', () => {
  const out = JSON.parse(invoke(bypass('ionice git push --force')).stdout)
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /\[guardrail D3\]/)
})

// 사유가 그대로면 "승인하십시오"라고 적힌 차단 메시지가 나간다 — 사용자가 할 수 없는 일을 시키는 셈이다.
test('승격: 사유에서 되묻기 안내가 사라지고 승격 이유가 들어간다', () => {
  const reason = JSON.parse(invoke(bypass('ionice rm -rf /')).stdout).hookSpecificOutput
    .permissionDecisionReason
  assert.match(reason, /알 수 없는 래퍼\(ionice\)/, '무엇이 걸렸는지는 그대로 남아야 한다')
  assert.match(reason, /bypassPermissions/, '왜 차단으로 올렸는지 밝혀야 한다')
  assert.doesNotMatch(reason, /승인하고, 아니라면 거절/, '누를 수 없는 버튼을 안내하면 안 된다')
  assert.doesNotMatch(reason, /막지 않고 묻습니다/, 'deny 인데 안 막는다고 적으면 거짓말이다')
})

// 회귀 방지 — 승격이 다른 모드까지 삼키면 목록에 없다는 이유만으로 정상 명령을 막게 된다.
test('승격: default 모드에서는 여전히 ask 다', () => {
  const out = JSON.parse(invoke(bash('ionice rm -rf /')).stdout)
  assert.equal(out.hookSpecificOutput.permissionDecision, 'ask')
})

test('승격: acceptEdits·plan 모드에서도 ask 를 유지한다', () => {
  for (const mode of ['acceptEdits', 'plan']) {
    const out = JSON.parse(invoke(bash('ionice rm -rf /', { permission_mode: mode })).stdout)
    assert.equal(out.hookSpecificOutput.permissionDecision, 'ask', `${mode} 에서 승격되면 안 된다`)
  }
})

test('승격: permission_mode 가 없으면 승격하지 않는다', () => {
  const p = bash('ionice rm -rf /')
  delete p.permission_mode
  const out = JSON.parse(invoke(p).stdout)
  assert.equal(out.hookSpecificOutput.permissionDecision, 'ask')
})

// 승격은 ask 만 건드린다. 통과는 통과여야 한다 — 여기서 오탐이 나면 모드를 끄게 된다.
test('승격: bypassPermissions 라도 안전한 명령은 그대로 통과한다', () => {
  assert.equal(invoke(bypass('rm -rf node_modules')).stdout.trim(), '')
  assert.equal(invoke(bypass('ionice rm -rf node_modules')).stdout.trim(), '')
  assert.equal(invoke(bypass('git push --force-with-lease')).stdout.trim(), '')
})

test('승격: 원래 deny 인 명령의 사유는 손대지 않는다', () => {
  const asked = JSON.parse(invoke(bypass('rm -rf /')).stdout).hookSpecificOutput
  assert.equal(asked.permissionDecision, 'deny')
  assert.doesNotMatch(asked.permissionDecisionReason, /bypassPermissions/, '승격한 적 없는데 승격 문구가 붙었다')
})

// ─────────────────────────────────────────────────────────────
// fail-open — 판정 불능일 때 절대 막지 않는다
// ─────────────────────────────────────────────────────────────

test('진입점: 깨진 JSON 이 들어와도 통과시킨다', () => {
  const r = invoke(null, { raw: '{ this is not json' })
  assert.equal(r.status, 0)
  assert.equal(r.stdout.trim(), '')
})

test('진입점: 빈 stdin 도 통과시킨다', () => {
  const r = invoke(null, { raw: '' })
  assert.equal(r.status, 0)
  assert.equal(r.stdout.trim(), '')
})

test('진입점: cwd 가 없으면 통과시킨다 (판정 근거 없음)', () => {
  const p = bash('rm -rf /')
  delete p.cwd
  const r = invoke(p)
  assert.equal(r.status, 0)
  assert.equal(r.stdout.trim(), '')
})

test('진입점: tool_input 이 없어도 죽지 않는다', () => {
  const p = bash('x')
  delete p.tool_input
  assert.equal(invoke(p).status, 0)
})
