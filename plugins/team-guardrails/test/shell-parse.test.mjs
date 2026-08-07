import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  splitCommand,
  splitSegments,
  tokenize,
  classifyArgv,
  stripRedirections,
} from '../lib/shell-parse.mjs'

// ─────────────────────────────────────────────────────────────
// splitSegments — 한 줄에 여러 명령이 들어오면 각각 판정해야 한다.
// `cd /tmp && rm -rf /` 를 통째로 보면 `rm` 이 명령어 자리에 없어 룰이 빗나간다.
// ─────────────────────────────────────────────────────────────

test('splitSegments: 단일 명령은 그대로', () => {
  assert.deepEqual(splitSegments('rm -rf /'), ['rm -rf /'])
})

test('splitSegments: && ; || | 로 분해한다', () => {
  assert.deepEqual(splitSegments('cd /tmp && rm -rf x'), ['cd /tmp', 'rm -rf x'])
  assert.deepEqual(splitSegments('a; b'), ['a', 'b'])
  assert.deepEqual(splitSegments('a || b'), ['a', 'b'])
  assert.deepEqual(splitSegments('a | b'), ['a', 'b'])
})

test('splitSegments: 개행도 분리자다', () => {
  assert.deepEqual(splitSegments('echo hi\nrm -rf /'), ['echo hi', 'rm -rf /'])
})

test('splitSegments: 인용부호 안의 분리자는 분리하지 않는다', () => {
  assert.deepEqual(splitSegments('echo "a; b"'), ['echo "a; b"'])
  assert.deepEqual(splitSegments("echo 'a && b'"), ["echo 'a && b'"])
})

test('splitSegments: 이스케이프된 분리자는 분리하지 않는다', () => {
  assert.deepEqual(splitSegments('echo a\\; b'), ['echo a\\; b'])
})

test('splitSegments: 빈 세그먼트는 버린다', () => {
  assert.deepEqual(splitSegments('a ;; b'), ['a', 'b'])
  assert.deepEqual(splitSegments('   '), [])
  assert.deepEqual(splitSegments(''), [])
})

// ─────────────────────────────────────────────────────────────
// tokenize — 인용부호를 벗겨야 경로 판정이 가능하다.
// `rm -rf "my dir"` 의 대상은 `"my` 가 아니라 `my dir` 이다.
// ─────────────────────────────────────────────────────────────

test('tokenize: 공백으로 나눈다', () => {
  assert.deepEqual(tokenize('rm -rf /tmp/x'), ['rm', '-rf', '/tmp/x'])
})

test('tokenize: 큰따옴표·작은따옴표를 벗긴다', () => {
  assert.deepEqual(tokenize('rm -rf "my dir"'), ['rm', '-rf', 'my dir'])
  assert.deepEqual(tokenize("rm -rf 'my dir'"), ['rm', '-rf', 'my dir'])
})

test('tokenize: 따옴표가 토큰 중간에 붙어도 한 토큰이다', () => {
  assert.deepEqual(tokenize('rm -rf /tmp/"my dir"/x'), ['rm', '-rf', '/tmp/my dir/x'])
})

test('tokenize: 백슬래시로 이스케이프한 공백은 붙인다', () => {
  assert.deepEqual(tokenize('rm -rf my\\ dir'), ['rm', '-rf', 'my dir'])
})

test('tokenize: 연속 공백을 접는다', () => {
  assert.deepEqual(tokenize('rm   -rf    x'), ['rm', '-rf', 'x'])
})

test('tokenize: 빈 입력은 빈 배열', () => {
  assert.deepEqual(tokenize(''), [])
  assert.deepEqual(tokenize('   '), [])
})

// ─────────────────────────────────────────────────────────────
// classifyArgv — 기존 danger-guard.sh 가 뚫린 지점이 정확히 여기다.
// `rm\s+-rf` 정규식은 `rm -r -f`, `rm --recursive --force`, `rm -fr` 를 놓쳤다.
// 표기와 순서를 흡수해 "r 과 f 가 각각 있는가" 하나로 만든다.
// ─────────────────────────────────────────────────────────────

test('classifyArgv: 묶인 단문자 플래그를 낱개로 푼다', () => {
  const r = classifyArgv(['rm', '-rf', '~'])
  assert.deepEqual(r.argv, ['rm', '~'])
  assert.ok(r.short.has('r') && r.short.has('f'))
})

test('classifyArgv: 순서·표기가 달라도 같은 결과다', () => {
  const a = classifyArgv(['rm', '-fr', 'x'])
  const b = classifyArgv(['rm', '-r', '-f', 'x'])
  const c = classifyArgv(['rm', '-f', '-r', 'x'])
  for (const r of [a, b, c]) {
    assert.ok(r.short.has('r') && r.short.has('f'))
    assert.deepEqual(r.argv, ['rm', 'x'])
  }
})

test('classifyArgv: 대문자 -R 도 별개 문자로 담는다', () => {
  const r = classifyArgv(['rm', '-Rf', 'x'])
  assert.ok(r.short.has('R') && r.short.has('f'))
})

test('classifyArgv: 롱플래그는 long 에 담는다', () => {
  const r = classifyArgv(['rm', '--recursive', '--force', '..'])
  assert.ok(r.long.has('recursive') && r.long.has('force'))
  assert.deepEqual(r.argv, ['rm', '..'])
})

test('classifyArgv: --force-with-lease 는 --force 와 다른 이름이다', () => {
  const r = classifyArgv(['git', 'push', '--force-with-lease'])
  assert.ok(r.long.has('force-with-lease'))
  assert.ok(!r.long.has('force'), '접두사 매칭으로 --force 를 만들어내면 안 된다')
})

test('classifyArgv: --flag=value 는 이름만 담는다', () => {
  const r = classifyArgv(['git', 'push', '--force-with-lease=main'])
  assert.ok(r.long.has('force-with-lease'))
})

test('classifyArgv: -- 이후는 전부 operand 다', () => {
  const r = classifyArgv(['rm', '-f', '-r', '--', '-weird-file'])
  assert.deepEqual(r.argv, ['rm', '-weird-file'])
  assert.ok(r.short.has('f') && r.short.has('r'))
})

test('classifyArgv: - 하나는 플래그가 아니라 operand 다', () => {
  const r = classifyArgv(['cat', '-'])
  assert.deepEqual(r.argv, ['cat', '-'])
  assert.equal(r.short.size, 0)
})

test('classifyArgv: + 로 시작하는 토큰은 operand 다 (git refspec)', () => {
  const r = classifyArgv(['git', 'push', 'origin', '+main'])
  assert.deepEqual(r.argv, ['git', 'push', 'origin', '+main'])
})

test('classifyArgv: 빈 입력', () => {
  const r = classifyArgv([])
  assert.deepEqual(r.argv, [])
  assert.equal(r.short.size, 0)
  assert.equal(r.long.size, 0)
})

// ─────────────────────────────────────────────────────────────
// 리다이렉션 — `2>&1` 의 `&` 를 명령 경계로 잘라내면 세그먼트가 깨지고,
// `> /dev/null` 의 대상이 operand 로 남으면 삭제 대상으로 오인된다.
// `rm -rf dist > /dev/null 2>&1` 은 에이전트가 하루에도 여러 번 쓰는 형태다.
// ─────────────────────────────────────────────────────────────

test('splitSegments: 2>&1 의 & 는 명령 경계가 아니다', () => {
  assert.deepEqual(splitSegments('rm -rf dist > /dev/null 2>&1'), ['rm -rf dist > /dev/null 2>&1'])
})

test('splitSegments: &> 도 명령 경계가 아니다', () => {
  assert.deepEqual(splitSegments('npm run build &> log.txt'), ['npm run build &> log.txt'])
})

test('splitSegments: 진짜 백그라운드 & 는 여전히 경계다', () => {
  assert.deepEqual(splitSegments('npm run dev & npm test'), ['npm run dev', 'npm test'])
})

test('splitSegments: 서브셸 괄호는 명령 경계다', () => {
  assert.deepEqual(splitSegments('(rm -rf /)'), ['rm -rf /'])
  assert.deepEqual(splitSegments('(cd /tmp && ls)'), ['cd /tmp', 'ls'])
})

test('stripRedirections: 연산자와 대상을 함께 걷어낸다', () => {
  assert.deepEqual(stripRedirections(['rm', '-rf', 'dist', '>', '/dev/null']), ['rm', '-rf', 'dist'])
  assert.deepEqual(stripRedirections(['rm', '-rf', 'x', '2>', '/dev/null']), ['rm', '-rf', 'x'])
  assert.deepEqual(stripRedirections(['rm', '-rf', 'x', '>>', 'log.txt']), ['rm', '-rf', 'x'])
  assert.deepEqual(stripRedirections(['sort', '<', 'in.txt']), ['sort'])
})

test('stripRedirections: 대상이 붙어 있는 형태도 걷어낸다', () => {
  assert.deepEqual(stripRedirections(['rm', '-rf', 'x', '>/dev/null']), ['rm', '-rf', 'x'])
  assert.deepEqual(stripRedirections(['rm', '-rf', 'x', '2>&1']), ['rm', '-rf', 'x'])
  assert.deepEqual(stripRedirections(['rm', '-rf', 'x', '&>', 'log']), ['rm', '-rf', 'x'])
})

// ─────────────────────────────────────────────────────────────
// splitCommand — 세그먼트의 "위치"를 알려준다.
// 문자열만 돌려주면 `(cd /tmp && ls); rm -rf dist` 에서 cd 가 괄호 안이었다는 사실이
// 사라져, 밖의 rm 까지 /tmp 기준으로 판정된다.
// ─────────────────────────────────────────────────────────────

test('splitCommand: 구분자 종류를 함께 돌려준다', () => {
  assert.deepEqual(
    splitCommand('a && b; c | d').map((s) => [s.text, s.sepAfter]),
    [
      ['a', '&&'],
      ['b', ';'],
      ['c', '|'],
      ['d', null],
    ]
  )
})

test('splitCommand: 서브셸 안은 별도 스코프다', () => {
  assert.deepEqual(
    splitCommand('(cd /tmp && ls); rm -rf x').map((s) => [s.text, s.scopeId, s.parentScope]),
    [
      ['cd /tmp', 1, 0],
      ['ls', 1, 0],
      ['rm -rf x', 0, 0],
    ]
  )
})

test('splitCommand: 형제 서브셸은 서로 다른 스코프다', () => {
  // 깊이만 보면 둘 다 1 이라 구분되지 않는다 — 이게 0.1.2 의 오탐 원인이었다
  const segs = splitCommand('(cd sub && npm ci) && (rm -rf dist)')
  const [a, , b] = segs
  assert.equal(a.text, 'cd sub')
  assert.equal(b.text, 'rm -rf dist')
  assert.notEqual(a.scopeId, b.scopeId, '형제 서브셸이 같은 스코프로 보이면 안 된다')
  assert.equal(a.parentScope, 0)
  assert.equal(b.parentScope, 0)
})

test('splitCommand: 중첩 서브셸은 부모를 가리킨다', () => {
  const inner = splitCommand('(a && (rm -rf x))').at(-1)
  assert.equal(inner.text, 'rm -rf x')
  assert.notEqual(inner.scopeId, 0)
  assert.notEqual(inner.parentScope, 0)
})

test('splitCommand: 백그라운드 & 와 && 를 구분한다', () => {
  assert.deepEqual(
    splitCommand('a & b && c').map((s) => s.sepAfter),
    ['&', '&&', null]
  )
})

test('splitSegments 는 splitCommand 의 텍스트만 뽑은 것이다', () => {
  const c = '(cd /tmp && ls); rm -rf x'
  assert.deepEqual(splitSegments(c), splitCommand(c).map((s) => s.text))
})

test('stripRedirections: 평범한 인자는 건드리지 않는다', () => {
  assert.deepEqual(stripRedirections(['rm', '-rf', 'dist', '2', 'build']), ['rm', '-rf', 'dist', '2', 'build'])
  assert.deepEqual(stripRedirections([]), [])
})
