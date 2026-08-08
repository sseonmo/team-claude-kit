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
const asked = (command) => {
  const r = run(command)
  assert.ok(r, `물었어야 한다: ${command}`)
  assert.equal(r.decision, 'ask')
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

test('D3: 명령 앞에 붙는 것들을 벗겨낸다 (D1 과 같은 처리)', () => {
  denied('sudo git push --force')
  denied('{ git push -f; }')
  denied('DEBUG=1 git push -f')
  denied('if true; then git push -f; fi')
})

test('D3: 접두어가 인자로 등장하면 벗기지 않는다', () => {
  passed('echo sudo git push --force')
})

// ─────────────────────────────────────────────────────────────
// 모르는 래퍼 — D1 과 같은 처리다. 이름 목록으로는 닫히지 않으니 모양으로 보고,
// 확신이 없으니 막지 않고 묻는다.
// ─────────────────────────────────────────────────────────────

test('D3: 목록에 없는 래퍼 뒤의 force push 는 막지 않고 묻는다', () => {
  asked('ionice git push --force')
  asked('setsid git push -f')
  asked('stdbuf -o0 git push --force')
  asked('doas git push --force')
  asked('chrt -f 1 git push --force')
  asked('taskset -c 0 git push -f')
  asked('unbuffer git push --force')
})

test('D3: 알려진 래퍼라도 처리하지 못한 옵션 형태면 묻는다', () => {
  asked('env -u PATH git push --force')
  asked('env -C /tmp git push -f')
  asked('timeout -s KILL 30 git push --force')
})

test('D3: 모르는 래퍼 뒤의 + refspec 과 git -C 도 같이 본다', () => {
  asked('ionice git push origin +main')
  asked('ionice git -C /Users/tester/other push --force')
})

test('D3: 모르는 래퍼 뒤라도 --force-with-lease 는 통과한다', () => {
  passed('ionice git push --force-with-lease')
  passed('doas git push --force-with-lease origin main')
})

test('D3: 모르는 래퍼 뒤의 평범한 push 는 통과한다', () => {
  passed('ionice git push')
  passed('ionice git push origin main')
  passed('doas git push -u origin feature/x')
  passed('ionice git pull --force')
})

test('D3: 설명되지 않는 낱말이 둘이면 래퍼로 보지 않는다 — 오탐 방지선', () => {
  passed('echo ionice git push --force')
  passed('grep -r "git push -f" docs/')
})

test('D3: 묻는 사유에 무엇이 걸렸는지 들어간다', () => {
  const r = asked('ionice git push --force')
  assert.match(r.reason, /\[guardrail D3\]/)
  assert.match(r.reason, /ionice/)
})

test('D3: 같은 명령에 막을 것과 물을 것이 섞이면 막는 쪽이 이긴다', () => {
  denied('ionice git push --force && git push -f')
  denied('git push -f && ionice git push --force')
})

test('D3: 서브셸 안도 본다', () => {
  denied('(git push -f)')
})

test('D3: 리다이렉션 대상을 refspec 으로 오인하지 않는다', () => {
  passed('git push origin main > /dev/null 2>&1')
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
