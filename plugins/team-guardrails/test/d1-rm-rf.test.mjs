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

test('D1: 서브셸·브레이스 그룹 안도 본다', () => {
  denied('(rm -rf /)')
  denied('(a && (rm -rf /))')
  denied('{ rm -rf /; }')
})

test('D1: 명령 앞에 붙는 것들을 벗겨낸다', () => {
  denied('sudo rm -rf /')
  denied('{ sudo rm -rf /; }')
  denied('! rm -rf /')
  denied('time rm -rf /')
  denied('command rm -rf /')
  denied('nohup rm -rf /')
  denied('exec rm -rf /')
  denied('env FOO=1 rm -rf /')
  denied('DEBUG=1 rm -rf /')
})

test('D1: 셸 키워드 뒤의 명령도 본다 (여러 줄 포함)', () => {
  denied('if [ -d dist ]; then rm -rf /; fi')
  denied('for f in a b; do rm -rf /; done')
  denied('while true; do rm -rf /; done')
  denied('if [ -d x ]; then\n  rm -rf /\nfi')
  denied('for d in a; do\n  rm -rf ~\ndone')
})

test('D1: 인자 여러 개 중 하나만 위험해도 막는다', () => {
  denied('rm -rf dist /etc')
})

test('D1: 리다이렉션이 붙어도 진짜 위험한 대상은 막는다', () => {
  denied('rm -rf /etc > /dev/null 2>&1')
  denied('rm -rf ~ 2> /dev/null')
  denied('rm -rf > /dev/null /etc')
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

test('D1: 재귀+강제가 아니면 대상이 아니다', () => {
  passed('rm file.txt')
  passed('rm -f /etc/hosts')
  passed('rm -r /etc')
})

test('D1: rm 이 명령어 자리에 없으면 통과한다 — 정규식 훅의 대표적 오탐', () => {
  passed('echo "rm -rf /"')
  passed('git commit -m "remove rm -rf from docs"')
  passed('grep -r "rm -rf" .')
  passed('echo sudo rm -rf /')
  passed('rm -rf time')
})

test('D1: 리다이렉션 대상은 삭제 대상이 아니다', () => {
  passed('rm -rf dist > /dev/null 2>&1')
  passed('rm -rf node_modules 2> /dev/null')
  passed('rm -rf .next >/dev/null')
  passed('rm -rf build >> /tmp/clean.log')
  passed('rm -rf dist &> /dev/null')
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
// 나중에 누군가 "이것도 막자"며 해석을 더 넣으려 할 때 이 테스트가 막는다.
// ─────────────────────────────────────────────────────────────

test('D1: 변수 치환은 통과한다 (정적 판정의 한계 — 의도된 동작)', () => {
  passed('P=~; rm -rf $P')
  passed('rm -rf $TARGET')
  passed('rm -rf /etc/$X')
  passed('rm -rf $(cat list.txt)')
})

test('D1: 스크립트·인터프리터 경유는 통과한다 (의도된 동작)', () => {
  passed('bash cleanup.sh')
  passed('python3 -c "import shutil; shutil.rmtree(\'/\')"')
  passed('find . -name x | xargs rm -rf')
})

// ─────────────────────────────────────────────────────────────
// `cd` 는 따라가지 않는다 — 상대경로는 언제나 프로젝트 루트 기준이다.
//
// v0.1.1~0.1.7 이 `cd` 를 추적했고 릴리스마다 오탐을 냈다. 서브셸·형제 서브셸·파이프·
// 조건문·반복문·여러 줄 스크립트·브레이스 그룹·함수 정의가 전부 "그 cd 가 실제로
// 실행되는가"에 다르게 답하는데, 문자열만 보고는 알 수 없다.
// `deploy() { cd /tmp; }` 와 `{ cd /tmp; }` 는 글자가 거의 같지만 답이 반대다.
//
// 아래는 전부 **통과가 정상**이다. 되살리려 한다면 이 목록 전체를 감당해야 한다.
// ─────────────────────────────────────────────────────────────

test('D1: cd 뒤의 상대경로는 판정하지 않는다 (알려진 미탐)', () => {
  passed('cd /tmp && rm -rf junk')
  passed('cd .. && rm -rf other-project')
  passed('cd ~ && rm -rf Documents')
  passed('cd - && rm -rf junk')
  passed('cd $SOMEWHERE && rm -rf junk')
  // `.` 과 `..` 도 상대경로다 — cd 뒤에서는 어디를 가리키는지 모른다
  passed('cd /tmp && rm -rf ..')
  passed('cd sub && rm -rf ../..')
})

// 디렉토리를 옮기는 건 cd 뿐이 아니다. 하나만 세면 나머지에서 오탐이 난다 —
// `pushd packages/app && rm -rf ../shared` 의 대상은 프로젝트 안인데
// 프로젝트 루트 기준으로 풀면 밖으로 나간다.
test('D1: pushd·popd 도 디렉토리를 옮긴 것으로 센다', () => {
  passed('pushd packages/app && rm -rf ../shared')
  passed('pushd /tmp; rm -rf ../etc')
  passed('popd && rm -rf ../other')
})

test('D1: 서브셸·파이프·백그라운드의 cd 도 마찬가지다', () => {
  passed('(cd /tmp && rm -rf junk)')
  passed('(cd /tmp && ls); rm -rf build')
  passed('(cd ../other && npm i) && (rm -rf dist)')
  passed('cd /tmp | cat; rm -rf dist')
  passed('cd /tmp & rm -rf dist')
  passed('cd /tmp; ( (rm -rf junk) )')
})

test('D1: 조건문·반복문·함수 정의 안의 cd 도 마찬가지다', () => {
  passed('if false; then cd /tmp; fi; rm -rf dist')
  passed('for d in a; do cd /tmp; done; rm -rf dist')
  passed('if [ -d /tmp/c ]; then\n  cd /tmp\nfi\nrm -rf node_modules')
  passed('if [ -d packages/app ]; then\n  cd packages/app\n  rm -rf ../shared/node_modules\nfi')
  passed('cleanup() { cd /tmp; }\nrm -rf node_modules')
  passed('deploy() {\n  cd /opt\n}\nrm -rf dist')
  passed('function deploy {\n  cd ../sibling\n}\nrm -rf node_modules')
  passed('{ cd /tmp; }; rm -rf junk')
  passed('time cd /tmp && rm -rf junk')
})

test('D1: 디렉토리를 옮겨도 절대경로 대상은 그대로 판정한다', () => {
  denied('cd /tmp && rm -rf /etc')
  denied('cd - && rm -rf /etc')
  denied('pushd /tmp && rm -rf ~')
  denied('if [ -d x ]; then\n  cd sub\n  rm -rf ~\nfi')
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

// ─────────────────────────────────────────────────────────────
// 알려진 한계 — 통과가 정상인 동작으로 못 박아 둔다.
// 프로젝트 루트가 곧 홈이면 "프로젝트 밖"이라는 경계가 홈 경계와 같아져
// 홈 하위 보호가 성립하지 않는다. README 의 한계 목록과 짝이다.
// ─────────────────────────────────────────────────────────────

test('D1: cwd 가 홈이면 홈 하위는 통과한다 (경계가 성립하지 않음)', () => {
  const homeCtx = { cwd: HOME, home: HOME }
  assert.equal(check('Bash', { command: 'rm -rf Documents' }, homeCtx), null)
  assert.equal(check('Bash', { command: 'rm -rf ~/.ssh' }, homeCtx), null)
  // 홈 자신과 루트는 이 경우에도 막힌다
  assert.ok(check('Bash', { command: 'rm -rf ~' }, homeCtx))
  assert.ok(check('Bash', { command: 'rm -rf /' }, homeCtx))
})
