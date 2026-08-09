import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'tdd-guard.mjs')

/** 훅을 실제 프로세스로 띄워 stdin JSON 을 먹인다 — 판정 함수 테스트가 못 덮는 계약 부분이다. */
function invoke(payload, { raw } = {}) {
  const input = raw !== undefined ? raw : JSON.stringify(payload)
  const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

/** 실제 파일이 있어야 하는 검증이라 임시 저장소를 만든다. */
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tdd-guard-'))
  mkdirSync(path.join(root, 'lib'), { recursive: true })
  writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}')
  writeFileSync(path.join(root, 'lib', 'covered.ts'), '')
  writeFileSync(path.join(root, 'lib', 'covered.test.ts'), '')
  writeFileSync(path.join(root, 'lib', 'bare.ts'), '')
  return root
}

const edit = (root, rel) => ({
  session_id: 'test-session',
  cwd: root,
  hook_event_name: 'PreToolUse',
  tool_name: 'Write',
  tool_input: { file_path: path.join(root, rel) },
  permission_mode: 'default',
})

const decision = (stdout) => JSON.parse(stdout).hookSpecificOutput

// ─────────────────────────────────────────────────────────────
// 판정 전달 — 차단은 오직 JSON 으로만 표현한다.
// 종료 코드로 막으려 하면 Claude Code 가 non-blocking error 로 취급해 도구를 그대로 실행한다.
// ─────────────────────────────────────────────────────────────

test('진입점: 차단할 때도 종료 코드는 0 이고 판정은 JSON 으로만 나간다', () => {
  const root = fixture()
  try {
    const r = invoke(edit(root, 'lib/bare.ts'))
    assert.equal(r.status, 0, '차단을 종료 코드로 표현하면 안 된다')
    const d = decision(r.stdout)
    assert.equal(d.hookEventName, 'PreToolUse')
    assert.equal(d.permissionDecision, 'deny')
    assert.match(d.permissionDecisionReason, /bare\.test\.ts/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('진입점: 통과할 때는 아무것도 출력하지 않는다', () => {
  const root = fixture()
  try {
    const r = invoke(edit(root, 'lib/covered.ts'))
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────
// fail-open — 판정 불능이면 통과시킨다. 원인 모를 차단을 만난 사용자는 훅을 끈다.
// ─────────────────────────────────────────────────────────────

test('진입점: 입력이 깨져도 통과시킨다', () => {
  for (const raw of ['', '   ', '{not json', '[]', 'null']) {
    const r = invoke(null, { raw })
    assert.equal(r.status, 0, `종료 코드 0 이어야 한다: ${JSON.stringify(raw)}`)
    assert.equal(r.stdout, '', `통과시켜야 한다: ${JSON.stringify(raw)}`)
  }
})

test('진입점: file_path 가 없으면 통과시킨다', () => {
  const r = invoke({ tool_name: 'Write', tool_input: {} })
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
})

test('진입점: cwd 가 없어도 죽지 않는다', () => {
  const root = fixture()
  try {
    const payload = edit(root, 'lib/bare.ts')
    delete payload.cwd
    const r = invoke(payload)
    assert.equal(r.status, 0)
    assert.equal(decision(r.stdout).permissionDecision, 'deny')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
