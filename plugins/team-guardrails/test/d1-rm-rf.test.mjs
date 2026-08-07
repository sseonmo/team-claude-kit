import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from '../lib/rules/d1-rm-rf.mjs'

const HOME = '/Users/tester'
const CWD = '/Users/tester/proj'
const ctx = { cwd: CWD, home: HOME }

const run = (command) => check('Bash', { command }, ctx)
const denied = (command) => {
  const r = run(command)
  assert.ok(r, `막았어야 한다: ${command}`)
  assert.equal(r.decision, 'deny')
  assert.equal(r.rule, 'D1')
  return r
}
const passed = (command) => {
  assert.equal(run(command), null, `통과했어야 한다: ${command}`)
}

// ─────────────────────────────────────────────────────────────
// 걸려야 하는 것
// ─────────────────────────────────────────────────────────────

test('D1: 루트와 홈', () => {
  denied('rm -rf /')
  denied('rm -rf ~')
  denied('rm -rf $HOME')
  denied('rm -rf ${HOME}')
  denied('rm -rf "$HOME"')
  denied('rm -rf ~/Documents')
})

test('D1: 플래그 표기가 달라도 같은 판정 — 기존 훅이 뚫린 지점', () => {
  denied('rm -rf /')
  denied('rm -fr /')
  denied('rm -Rf /')
  denied('rm -r -f /')
  denied('rm -f -r /')
  denied('rm --recursive --force /')
  denied('rm --force --recursive /')
})

test('D1: 프로젝트 밖 경로', () => {
  denied('rm -rf ../other')
  denied('rm -rf /Users/tester/other-project')
  denied('rm -rf /etc')
  denied('rm -rf packages/../../escaped')
})

test('D1: 프로젝트 루트 자체도 막는다 (.git 까지 날아간다)', () => {
  denied('rm -rf .')
  denied('rm -rf /Users/tester/proj')
})

test('D1: 여러 명령이 한 줄에 있어도 각각 본다', () => {
  denied('cd /tmp && rm -rf /')
  denied('npm run build; rm -rf ~')
  denied('echo start | rm -rf /')
})

test('D1: sudo 를 앞에 붙여도 잡는다', () => {
  denied('sudo rm -rf /')
})

test('D1: 인자 여러 개 중 하나만 위험해도 막는다', () => {
  denied('rm -rf dist /etc')
})

test('D1: 차단 사유에 정규화된 경로가 들어간다', () => {
  const r = denied('rm -rf ../other')
  assert.match(r.reason, /\[guardrail D1\]/)
  assert.match(r.reason, /\/Users\/tester\/other/)
})

// ─────────────────────────────────────────────────────────────
// 걸리면 안 되는 것 — 판단 기준은 오탐이다.
// 오탐이 잦은 훅은 사용자가 끄고, 꺼진 훅은 없는 훅과 같다.
// ─────────────────────────────────────────────────────────────

test('D1: 프로젝트 안은 통과한다', () => {
  passed('rm -rf node_modules')
  passed('rm -rf dist')
  passed('rm -rf ./build')
  passed('rm -rf packages/a/../b/tmp')
  passed('rm -rf /Users/tester/proj/tmp')
  passed('rm -rf src/generated .next')
})

test('D1: 재귀+강제가 아니면 대상이다 아니다', () => {
  passed('rm file.txt')
  passed('rm -f /etc/hosts')
  passed('rm -r /etc')
})

test('D1: rm 이 명령어 자리에 없으면 통과한다 — 정규식 훅의 대표적 오탐', () => {
  passed('echo "rm -rf /"')
  passed('git commit -m "remove rm -rf from docs"')
  passed('grep -r "rm -rf" .')
})

test('D1: Bash 가 아닌 도구는 대상이 아니다', () => {
  assert.equal(check('Write', { file_path: 'rm -rf /' }, ctx), null)
  assert.equal(check('Read', { file_path: '/etc/passwd' }, ctx), null)
})

test('D1: 인자가 없으면 통과한다', () => {
  passed('rm -rf')
  passed('rm')
})

// ─────────────────────────────────────────────────────────────
// 통과가 정상인 우회 — 설계 의도를 테스트에 박아둔다.
// 나중에 누군가 "이것도 막자"며 변수 해석을 넣으려 할 때 이 테스트가 막는다.
// ─────────────────────────────────────────────────────────────

test('D1: 변수 치환은 통과한다 (정적 판정의 한계 — 의도된 동작)', () => {
  passed('P=~; rm -rf $P')
  passed('rm -rf $TARGET')
})

test('D1: 스크립트·인터프리터 경유는 통과한다 (의도된 동작)', () => {
  passed('bash cleanup.sh')
  passed('python3 -c "import shutil; shutil.rmtree(\'/\')"')
})

// ─────────────────────────────────────────────────────────────
// fail-open — 판정 불능일 때 절대 막지 않는다
// ─────────────────────────────────────────────────────────────

test('D1: 입력이 이상해도 예외를 던지지 않고 통과시킨다', () => {
  assert.equal(check('Bash', {}, ctx), null)
  assert.equal(check('Bash', { command: null }, ctx), null)
  assert.equal(check('Bash', { command: '' }, ctx), null)
  assert.equal(check('Bash', { command: 'rm -rf /' }, {}), null)
})
