import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOOK = join(HERE, '..', 'templates', 'pre-push')
const ZERO = '0'.repeat(40)

function sh(cmd, cwd) {
  return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf8' })
}

/** 커밋 하나가 들어 있는 스크래치 저장소를 만든다. */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'pushgate-'))
  sh('git init -q .', dir)
  sh('git config user.email t@t', dir)
  sh('git config user.name t', dir)
  writeFileSync(join(dir, 'a.js'), 'console.log(1)\n')
  sh('git add -A', dir)
  sh('git commit -q -m base', dir)
  return dir
}

/** 파일 하나를 쓰고 커밋한 뒤 그 sha 를 돌려준다. */
function commit(dir, files, msg) {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
  sh('git add -A', dir)
  sh(`git commit -q -m ${JSON.stringify(msg)}`, dir)
  return sh('git rev-parse HEAD', dir).trim()
}

/**
 * 스텁 claude 를 만든다.
 * 호출되면 calls 파일에 한 줄을 남기므로, 호출 여부를 파일 존재로 판정할 수 있다.
 */
function makeClaude(dir, { stdout = '', code = 0 } = {}) {
  const bin = join(dir, 'fake-claude')
  const calls = join(dir, 'calls.log')
  writeFileSync(
    bin,
    `#!/bin/sh
cat >/dev/null
echo called >> ${JSON.stringify(calls)}
cat <<'STUB_OUT'
${stdout}
STUB_OUT
exit ${code}
`,
  )
  chmodSync(bin, 0o755)
  return { bin, calls }
}

/** 훅을 실제로 실행한다. git 이 주는 것과 같은 stdin·인자를 준다. */
function runHook(dir, { base, head, env = {} }) {
  const r = spawnSync(HOOK, ['origin', 'https://example.invalid/x.git'], {
    cwd: dir,
    input: `refs/heads/main ${head} refs/heads/main ${base}\n`,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}

test('SKIP_AI_REVIEW=1 이면 리뷰 없이 통과한다', () => {
  const dir = makeRepo()
  const base = sh('git rev-parse HEAD', dir).trim()
  const head = commit(dir, { 'b.js': 'x\n' }, 'add b')
  // 스텁은 FAIL 을 내도록 해둔다 — 그럼에도 통과해야 '리뷰를 안 돌렸다'가 증명된다
  const { bin, calls } = makeClaude(dir, { stdout: 'VERDICT: FAIL' })

  const r = runHook(dir, { base, head, env: { SKIP_AI_REVIEW: '1', CLAUDE_BIN: bin } })

  assert.equal(r.code, 0)
  assert.equal(existsSync(calls), false, 'claude 가 호출되면 안 된다')
})

/** 코드 변경 커밋 하나를 얹고 base/head 를 돌려주는 공통 준비. */
function prepared(dir) {
  const base = sh('git rev-parse HEAD', dir).trim()
  const head = commit(dir, { 'b.js': 'x\n' }, 'add b')
  return { base, head }
}

test('VERDICT: PASS 면 통과한다', () => {
  const dir = makeRepo()
  const { base, head } = prepared(dir)
  const { bin } = makeClaude(dir, { stdout: '리뷰 본문\nVERDICT: PASS' })

  const r = runHook(dir, { base, head, env: { CLAUDE_BIN: bin } })

  assert.equal(r.code, 0)
})

test('VERDICT 줄이 없으면 막는다 (fail-closed)', () => {
  const dir = makeRepo()
  const { base, head } = prepared(dir)
  const { bin } = makeClaude(dir, { stdout: '리뷰는 했는데 판정을 안 적었다' })

  const r = runHook(dir, { base, head, env: { CLAUDE_BIN: bin } })

  assert.equal(r.code, 1)
  assert.match(r.out, /판정할 수 없습니다/)
})

test('타임아웃(rc 124)이면 막는다 (fail-closed)', () => {
  const dir = makeRepo()
  const { base, head } = prepared(dir)
  // 종료코드 124 는 timeout(1) 이 시간 초과 때 내는 값이다
  const { bin } = makeClaude(dir, { stdout: 'VERDICT: PASS', code: 124 })

  const r = runHook(dir, { base, head, env: { CLAUDE_BIN: bin } })

  assert.equal(r.code, 1, 'PASS 가 찍혀 있어도 타임아웃이면 막아야 한다')
  assert.match(r.out, /타임아웃/)
})

test('CLAUDE_BIN 이 실행 불가하면 막는다 (fail-closed)', () => {
  const dir = makeRepo()
  const { base, head } = prepared(dir)

  const r = runHook(dir, { base, head, env: { CLAUDE_BIN: join(dir, '없는파일') } })

  assert.equal(r.code, 1)
  assert.match(r.out, /CLAUDE_BIN/)
})

test('VERDICT: FAIL 이면 막는다', () => {
  const dir = makeRepo()
  const { base, head } = prepared(dir)
  const { bin } = makeClaude(dir, { stdout: '심각한 결함\nVERDICT: FAIL' })

  const r = runHook(dir, { base, head, env: { CLAUDE_BIN: bin } })

  assert.equal(r.code, 1)
})

test('VERDICT 가 여러 줄이면 마지막 것을 쓴다', () => {
  const dir = makeRepo()
  const { base, head } = prepared(dir)
  // 본문에서 'VERDICT: FAIL' 을 인용한 뒤 마지막에 PASS 를 내는 경우
  const { bin } = makeClaude(dir, {
    stdout: '예시로 VERDICT: FAIL 을 언급한다\n최종 판정\nVERDICT: PASS',
  })

  const r = runHook(dir, { base, head, env: { CLAUDE_BIN: bin } })

  assert.equal(r.code, 0, '마지막 VERDICT 가 PASS 이므로 통과해야 한다')
})

test('.md 만 바뀌면 리뷰를 건너뛴다 (의도된 동작)', () => {
  const dir = makeRepo()
  const base = sh('git rev-parse HEAD', dir).trim()
  const head = commit(dir, { 'docs/x.md': '# 문서\n' }, 'docs only')
  const { bin, calls } = makeClaude(dir, { stdout: 'VERDICT: FAIL' })

  const r = runHook(dir, { base, head, env: { CLAUDE_BIN: bin } })

  assert.equal(r.code, 0)
  assert.equal(existsSync(calls), false, 'claude 가 호출되면 안 된다')
  assert.match(r.out, /문서\(\.md\)만 변경/)
})

test('코드와 .md 가 섞이면 건너뛰지 않는다', () => {
  const dir = makeRepo()
  const base = sh('git rev-parse HEAD', dir).trim()
  const head = commit(dir, { 'docs/x.md': '# 문서\n', 'b.js': 'x\n' }, 'mixed')
  const { bin, calls } = makeClaude(dir, { stdout: 'VERDICT: PASS' })

  const r = runHook(dir, { base, head, env: { CLAUDE_BIN: bin } })

  assert.equal(r.code, 0)
  assert.equal(existsSync(calls), true, 'claude 가 호출되어야 한다')
})

test('브랜치 삭제 push 는 대상이 아니다', () => {
  const dir = makeRepo()
  const base = sh('git rev-parse HEAD', dir).trim()
  const { bin, calls } = makeClaude(dir, { stdout: 'VERDICT: FAIL' })

  // 브랜치 삭제 때 git 은 local_sha 로 0000… 을 준다
  const r = runHook(dir, { base, head: ZERO, env: { CLAUDE_BIN: bin } })

  assert.equal(r.code, 0)
  assert.equal(existsSync(calls), false)
})

test('새 브랜치 push 는 최초 커밋부터의 범위를 리뷰한다', () => {
  const dir = makeRepo()
  const root = sh('git rev-list --max-parents=0 HEAD', dir).trim()
  const head = commit(dir, { 'b.js': 'x\n' }, 'add b')
  const { bin, calls } = makeClaude(dir, { stdout: 'VERDICT: PASS' })

  // remote_sha 가 0000… = 원격에 없는 새 브랜치
  const r = runHook(dir, { base: ZERO, head, env: { CLAUDE_BIN: bin } })

  assert.equal(r.code, 0)
  assert.equal(existsSync(calls), true)
  assert.match(r.out, new RegExp(`${root}\\.\\.${head}`), '최초 커밋부터의 범위여야 한다')
})
