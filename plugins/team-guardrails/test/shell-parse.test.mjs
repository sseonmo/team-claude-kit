import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  splitSegments,
  tokenize,
  classifyArgv,
  stripRedirections,
  stripCommandPrefixes,
  stripUnknownWrapper,
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
// 명령 앞에 붙는 것들 — 이 부류를 룰마다 따로 처리하다 세 번 새어나갔다.
// (D1 은 sudo 를 벗기는데 D3 는 안 벗기고, D1 은 `{` 를 벗기는데 D3 는 안 벗기고…)
// 한 곳에서 처리해 룰 사이 비대칭이 생길 자리를 없앤다.
// ─────────────────────────────────────────────────────────────

test('stripCommandPrefixes: 권한·실행 래퍼를 벗긴다', () => {
  assert.deepEqual(stripCommandPrefixes(['sudo', 'rm', '-rf', '/']), ['rm', '-rf', '/'])
  assert.deepEqual(stripCommandPrefixes(['time', 'rm', '-rf', '/']), ['rm', '-rf', '/'])
  assert.deepEqual(stripCommandPrefixes(['command', 'rm']), ['rm'])
  assert.deepEqual(stripCommandPrefixes(['nohup', 'rm']), ['rm'])
  assert.deepEqual(stripCommandPrefixes(['exec', 'rm']), ['rm'])
  assert.deepEqual(stripCommandPrefixes(['env', 'rm']), ['rm'])
})

test('stripCommandPrefixes: 셸 키워드를 벗긴다', () => {
  assert.deepEqual(stripCommandPrefixes(['then', 'rm', '-rf', '/']), ['rm', '-rf', '/'])
  assert.deepEqual(stripCommandPrefixes(['do', 'rm']), ['rm'])
  assert.deepEqual(stripCommandPrefixes(['else', 'rm']), ['rm'])
  assert.deepEqual(stripCommandPrefixes(['if', 'rm']), ['rm'])
  assert.deepEqual(stripCommandPrefixes(['while', 'rm']), ['rm'])
  assert.deepEqual(stripCommandPrefixes(['!', 'rm']), ['rm'])
  assert.deepEqual(stripCommandPrefixes(['{', 'rm']), ['rm'])
})

test('stripCommandPrefixes: 변수 할당 접두를 벗긴다', () => {
  assert.deepEqual(stripCommandPrefixes(['DEBUG=1', 'rm', '-rf', '/']), ['rm', '-rf', '/'])
  assert.deepEqual(stripCommandPrefixes(['env', 'FOO=1', 'BAR=2', 'rm']), ['rm'])
})

test('stripCommandPrefixes: 여러 겹도 벗긴다', () => {
  assert.deepEqual(stripCommandPrefixes(['{', 'sudo', 'DEBUG=1', 'rm', '/']), ['rm', '/'])
})

test('stripCommandPrefixes: 첫 토큰이 아니면 벗기지 않는다 — 오탐 방지선', () => {
  // `echo sudo rm -rf /` 가 삭제 명령으로 보이면 안 된다
  assert.deepEqual(stripCommandPrefixes(['echo', 'sudo', 'rm']), ['echo', 'sudo', 'rm'])
  assert.deepEqual(stripCommandPrefixes(['rm', '-rf', 'time']), ['rm', '-rf', 'time'])
})

test('stripCommandPrefixes: 전부 접두어면 빈 배열', () => {
  assert.deepEqual(stripCommandPrefixes(['sudo']), [])
  assert.deepEqual(stripCommandPrefixes([]), [])
})

// ── exec 래퍼 — 기본으로는 벗기지 않고, 명시할 때만 벗긴다 ────────────────
// `nice cd /tmp` 는 셸의 위치를 바꾸지 못한다(`cd` 는 빌트인이라 exec 되지 않는다).
// 그래서 이동 판정은 기본 동작을, 명령 이름 판정은 `execWrappers` 를 쓴다.

test('stripCommandPrefixes: exec 래퍼는 기본으로 벗기지 않는다', () => {
  assert.deepEqual(stripCommandPrefixes(['nice', 'cd', '/tmp']), ['nice', 'cd', '/tmp'])
  assert.deepEqual(stripCommandPrefixes(['timeout', '60', 'cd', '/tmp']), ['timeout', '60', 'cd', '/tmp'])
})

test('stripCommandPrefixes: execWrappers 면 래퍼와 그 값을 벗긴다', () => {
  const strip = (t) => stripCommandPrefixes(t, { execWrappers: true })
  assert.deepEqual(strip(['nice', 'rm', '-rf', '/']), ['rm', '-rf', '/'])
  assert.deepEqual(strip(['nice', '-n', '10', 'rm']), ['rm'])
  assert.deepEqual(strip(['nice', '-10', 'rm']), ['rm'])
  assert.deepEqual(strip(['timeout', '60', 'git', 'push']), ['git', 'push'])
  assert.deepEqual(strip(['timeout', '5s', 'git']), ['git'])
  assert.deepEqual(strip(['timeout', '--signal=KILL', '30', 'git']), ['git'])
  // 기존 접두어와 섞여도 같이 벗겨진다
  assert.deepEqual(strip(['sudo', 'nice', '-n', '5', 'rm']), ['rm'])
})

test('stripCommandPrefixes: execWrappers 도 첫 토큰이 아니면 벗기지 않는다', () => {
  const strip = (t) => stripCommandPrefixes(t, { execWrappers: true })
  assert.deepEqual(strip(['echo', 'nice', 'rm']), ['echo', 'nice', 'rm'])
  assert.deepEqual(strip(['rm', '-rf', 'nice']), ['rm', '-rf', 'nice'])
  assert.deepEqual(strip(['rm', '-rf', 'timeout']), ['rm', '-rf', 'timeout'])
})

test('stripCommandPrefixes: 값처럼 보이는 토큰만 건너뛴다 — 명령 이름에서 멈춘다', () => {
  const strip = (t) => stripCommandPrefixes(t, { execWrappers: true })
  // `10s` 는 값이지만 `rm` 은 명령이다. 여기서 멈추지 않으면 삭제 대상까지 먹는다
  assert.deepEqual(strip(['timeout', '10s', 'rm', '-rf', 'dist']), ['rm', '-rf', 'dist'])
  assert.deepEqual(strip(['nice']), [])
})

// ─────────────────────────────────────────────────────────────
// 모르는 래퍼 — 이름 목록은 닫히지 않는다.
// 0.2.1~0.2.3 이 세 릴리스에 걸쳐 알려진 래퍼를 손으로 추가했고 매번 새 래퍼가 나왔다
// (ionice·setsid·stdbuf·doas·chrt·taskset·unbuffer…). POSIX·GNU·BSD·서드파티 래퍼는
// 열린 집합이라 셀 수 없다. 그래서 여기서는 **이름이 아니라 모양**을 본다.
// ─────────────────────────────────────────────────────────────

test('stripUnknownWrapper: 모르는 낱말 하나 뒤의 명령을 찾아낸다', () => {
  assert.deepEqual(stripUnknownWrapper(['ionice', 'rm', '-rf', '/'], 'rm'), ['rm', '-rf', '/'])
  assert.deepEqual(stripUnknownWrapper(['setsid', 'git', 'push'], 'git'), ['git', 'push'])
})

test('stripUnknownWrapper: 래퍼가 받는 플래그·값·숫자를 건너뛴다', () => {
  const s = (t) => stripUnknownWrapper(t, 'rm')
  assert.deepEqual(s(['stdbuf', '-o0', 'rm', '/']), ['rm', '/']) // 붙여 쓴 플래그
  assert.deepEqual(s(['chrt', '-f', '1', 'rm', '/']), ['rm', '/']) // 플래그 + 값
  assert.deepEqual(s(['taskset', '-c', '0', 'rm', '/']), ['rm', '/'])
  assert.deepEqual(s(['-u', 'PATH', 'rm', '/']), ['rm', '/']) // env 를 벗긴 뒤 남은 꼴
  assert.deepEqual(s(['KILL', '30', 'rm', '/']), ['rm', '/']) // timeout -s 를 벗긴 뒤 남은 꼴
})

test('stripUnknownWrapper: 경로로 부른 명령도 이름으로 본다', () => {
  assert.deepEqual(stripUnknownWrapper(['ionice', '/bin/rm', '-rf', '/'], 'rm'), ['/bin/rm', '-rf', '/'])
})

// 여기가 오탐 방지선이다. `echo sudo rm -rf /` 는 래퍼 호출이 아니라 출력이다.
// 값으로 설명되지 않는 낱말이 둘이면 그건 래퍼 모양이 아니다.
test('stripUnknownWrapper: 설명되지 않는 낱말이 둘이면 래퍼가 아니다', () => {
  assert.equal(stripUnknownWrapper(['echo', 'sudo', 'rm', '-rf', '/'], 'rm'), null)
  assert.equal(stripUnknownWrapper(['echo', 'nice', 'rm'], 'rm'), null)
  assert.equal(stripUnknownWrapper(['find', '.', '-name', 'x', '-exec', 'rm', '-rf', '/'], 'rm'), null)
  assert.equal(stripUnknownWrapper(['echo', 'sudo', 'git', 'push'], 'git'), null)
})

test('stripUnknownWrapper: 명령이 없으면 null', () => {
  assert.equal(stripUnknownWrapper(['ionice', 'ls'], 'rm'), null)
  assert.equal(stripUnknownWrapper(['ionice'], 'rm'), null)
  assert.equal(stripUnknownWrapper([], 'rm'), null)
})

test('stripUnknownWrapper: 첫 토큰이 명령 자신이면 null — 호출부의 정상 경로다', () => {
  assert.equal(stripUnknownWrapper(['rm', '-rf', '/'], 'rm'), null)
  assert.equal(stripUnknownWrapper(['git', 'push', '-f'], 'git'), null)
})

test('stripRedirections: 평범한 인자는 건드리지 않는다', () => {
  assert.deepEqual(stripRedirections(['rm', '-rf', 'dist', '2', 'build']), ['rm', '-rf', 'dist', '2', 'build'])
  assert.deepEqual(stripRedirections([]), [])
})
