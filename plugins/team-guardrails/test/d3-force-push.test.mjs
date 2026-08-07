import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from '../lib/rules/d3-force-push.mjs'

const ctx = { cwd: '/Users/tester/proj', home: '/Users/tester' }

const run = (command) => check('Bash', { command }, ctx)
const denied = (command) => {
  const r = run(command)
  assert.ok(r, `막았어야 한다: ${command}`)
  assert.equal(r.decision, 'deny')
  assert.equal(r.rule, 'D3')
  return r
}
const passed = (command) => {
  assert.equal(run(command), null, `통과했어야 한다: ${command}`)
}

// ─────────────────────────────────────────────────────────────
// 걸려야 하는 것 — `-f` 는 기존 danger-guard.sh 가 놓치던 형태다.
// (`--force` 만 보고 있어서 `git push -f` 가 그대로 나갔다)
// ─────────────────────────────────────────────────────────────

test('D3: --force', () => {
  denied('git push --force')
  denied('git push --force origin main')
})

test('D3: 짧은 플래그 -f', () => {
  denied('git push -f')
  denied('git push -f origin main')
  denied('git push origin main -f')
})

test('D3: 다른 플래그와 묶인 -f', () => {
  denied('git push -fu origin main')
})

test('D3: + refspec 도 force push 다', () => {
  denied('git push origin +main')
  denied('git push origin +refs/heads/main:refs/heads/main')
})

test('D3: git -C <경로> 를 앞에 둬도 잡는다', () => {
  denied('git -C /Users/tester/other push --force')
})

test('D3: 한 줄에 여러 명령이 있어도 각각 본다', () => {
  denied('npm test && git push --force')
})

test('D3: 차단 사유에 무엇에 걸렸는지 들어간다', () => {
  assert.match(denied('git push -f').reason, /\[guardrail D3\]/)
  assert.match(denied('git push origin +main').reason, /\+main/)
})

// ─────────────────────────────────────────────────────────────
// 걸리면 안 되는 것
// ─────────────────────────────────────────────────────────────

test('D3: --force-with-lease 는 예외로 통과한다', () => {
  passed('git push --force-with-lease')
  passed('git push --force-with-lease origin main')
  passed('git push --force-with-lease=main origin main')
  passed('git push --force-if-includes')
})

test('D3: 평범한 push 는 통과한다', () => {
  passed('git push')
  passed('git push origin main')
  passed('git push -u origin feature/x')
  passed('git push --tags')
})

test('D3: push 가 아닌 git 명령은 대상이 아니다', () => {
  passed('git pull --force')
  passed('git checkout -f main')
  passed('git commit -m "force push 관련 문서 수정"')
  passed('git log --oneline')
})

test('D3: git 이 명령어 자리에 없으면 통과한다', () => {
  passed('echo "git push --force"')
  passed('grep -r "git push -f" docs/')
})

test('D3: Bash 가 아닌 도구는 대상이 아니다', () => {
  assert.equal(check('Write', { file_path: 'git push --force' }, ctx), null)
})

// ─────────────────────────────────────────────────────────────
// fail-open
// ─────────────────────────────────────────────────────────────

test('D3: 입력이 이상해도 예외를 던지지 않고 통과시킨다', () => {
  assert.equal(check('Bash', {}, ctx), null)
  assert.equal(check('Bash', { command: null }, ctx), null)
  assert.equal(check('Bash', { command: '' }, ctx), null)
})
