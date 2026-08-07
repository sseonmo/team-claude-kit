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

// ─────────────────────────────────────────────────────────────
// 리다이렉션 — 대상이 삭제 대상으로 오인되면 정상 명령이 막힌다.
// 이 오탐은 pre-push 리뷰가 잡았고, 그 전까지 테스트가 비어 있던 구멍이다.
// ─────────────────────────────────────────────────────────────

test('D1: 리다이렉션 대상은 삭제 대상이 아니다', () => {
  passed('rm -rf dist > /dev/null 2>&1')
  passed('rm -rf node_modules 2> /dev/null')
  passed('rm -rf .next >/dev/null')
  passed('rm -rf build >> /tmp/clean.log')
  passed('rm -rf dist &> /dev/null')
})

test('D1: 리다이렉션이 붙어도 진짜 위험한 대상은 여전히 막는다', () => {
  denied('rm -rf /etc > /dev/null 2>&1')
  denied('rm -rf ~ 2> /dev/null')
})

// ─────────────────────────────────────────────────────────────
// cd 추적 — `cd /tmp && rm -rf junk` 는 상대경로가 프로젝트 기준으로 풀려
// 안쪽으로 보였다. 기존 테스트가 절대경로(`cd /tmp && rm -rf /`)만 다뤄 가려져 있었다.
// ─────────────────────────────────────────────────────────────

test('D1: 앞선 cd 를 반영해 상대경로를 푼다', () => {
  denied('cd /tmp && rm -rf junk')
  denied('cd .. && rm -rf other-project')
  denied('cd ~ && rm -rf Documents')
})

test('D1: 프로젝트 안으로 cd 하면 여전히 통과한다', () => {
  passed('cd packages/web && rm -rf .next')
  passed('cd /Users/tester/proj/apps && rm -rf dist')
})

test('D1: cd 대상을 알 수 없으면 상대경로 판정을 포기한다 (fail-open)', () => {
  passed('cd - && rm -rf junk')
  passed('cd $SOMEWHERE && rm -rf junk')
})

test('D1: cd 대상을 몰라도 절대경로는 여전히 판정한다', () => {
  denied('cd - && rm -rf /etc')
})

test('D1: 서브셸 안도 본다', () => {
  denied('(rm -rf /)')
  denied('{ rm -rf /; }')
})

// ─────────────────────────────────────────────────────────────
// cd 의 유효 범위 — 실제 셸에서 서브셸·파이프·백그라운드 안의 cd 는 밖으로 나오지 않는다.
// 이걸 무시하면 `(cd /tmp && tar xzf a.tgz) && rm -rf dist` 처럼 지극히 정상적인 명령이
// "/tmp/dist 는 프로젝트 밖"으로 차단된다. cd 추적을 넣으면서 생긴 회귀다.
// ─────────────────────────────────────────────────────────────

test('D1: 서브셸 안의 cd 는 밖으로 새지 않는다', () => {
  passed('(cd /tmp && tar xzf a.tgz) && rm -rf dist')
  passed('(cd /tmp && ls); rm -rf build')
})

test('D1: 파이프·백그라운드의 cd 도 밖으로 새지 않는다', () => {
  passed('cd /tmp | cat; rm -rf dist')
  passed('cd /tmp & rm -rf dist')
})

test('D1: 그래도 서브셸 안에서는 그 안의 cd 가 적용된다', () => {
  denied('(cd /tmp && rm -rf junk)')
})

test('D1: cd 뒤에 와도 변수 대상은 판정하지 않는다 (의도된 동작)', () => {
  passed('cd /tmp && rm -rf $BUILD')
  passed('rm -rf /etc/$X')
})

// ─────────────────────────────────────────────────────────────
// 알려진 한계 — 통과가 정상인 동작으로 못 박아 둔다.
// 프로젝트 루트가 곧 홈이면 "프로젝트 밖"이라는 경계 자체가 홈 경계와 같아져
// 홈 하위 보호가 성립하지 않는다. README 의 한계 목록과 짝이다.
// ─────────────────────────────────────────────────────────────

test('D1: cwd 가 홈이면 홈 하위는 통과한다 (경계가 성립하지 않음 — 알려진 한계)', () => {
  const homeCtx = { cwd: HOME, home: HOME }
  assert.equal(check('Bash', { command: 'rm -rf Documents' }, homeCtx), null)
  assert.equal(check('Bash', { command: 'rm -rf ~/.ssh' }, homeCtx), null)
  // 홈 자신과 루트는 이 경우에도 막힌다
  assert.ok(check('Bash', { command: 'rm -rf ~' }, homeCtx))
  assert.ok(check('Bash', { command: 'rm -rf /' }, homeCtx))
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
