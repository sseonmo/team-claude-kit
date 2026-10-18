import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { git } from '../engine/git.mjs'
import { selectTarget, defaultBranch, collectTarget } from '../engine/target.mjs'
import { makeRepo, commit, removeRepo } from './helpers.mjs'

const withRepo = fn => () => { const dir = makeRepo(); try { fn(dir) } finally { removeRepo(dir) } }
const lines = (n, f = i => `l${i}`) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n'
const write = (dir, rel, c) => { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), c) }
const S = (o = {}) => ({ dirty: false, upstream: null, ahead: 0, defaultBase: 'origin/main', prBaseOid: null, flags: {}, ...o })

test('selectTarget 표', () => {
  assert.deepEqual(selectTarget(S({ dirty: true })), { kind: 'uncommitted', baseRef: null, mode: 'fast' })
  assert.deepEqual(selectTarget(S({ dirty: true, upstream: 'origin/x', ahead: 2 })).kind, 'uncommitted')
  assert.deepEqual(selectTarget(S({ upstream: 'origin/x', ahead: 2 })), { kind: 'push', baseRef: 'origin/x', mode: 'fast' })
  assert.deepEqual(selectTarget(S()), { kind: 'branch', baseRef: 'origin/main', mode: 'fast' })
  assert.deepEqual(selectTarget(S({ upstream: 'origin/x', ahead: 0 })).kind, 'none')
  assert.deepEqual(selectTarget(S({ flags: { pr: true }, prBaseOid: 'abc' })), { kind: 'pr', baseRef: 'abc', mode: 'deep' })
  assert.equal(selectTarget(S({ flags: { comment: true }, dirty: true })).kind, 'pr')
  assert.equal(selectTarget(S({ defaultBase: null })).kind, 'none') // 표에 없는 상태
})

test('--deep/--fast 는 모드만 바꾼다', () => {
  assert.deepEqual(selectTarget(S({ dirty: true, flags: { deep: true } })), { kind: 'uncommitted', baseRef: null, mode: 'deep' })
  assert.equal(selectTarget(S({ flags: { pr: true, fast: true }, prBaseOid: 'a' })).mode, 'fast')
})

test('defaultBranch: master 만 있으면 master, 없으면 null', withRepo(dir => {
  assert.equal(defaultBranch(dir), null)
  commit(dir, { 'a.txt': 'a\n' }, 'init')
  git(['branch', '-m', 'main', 'master'], dir)
  assert.equal(defaultBranch(dir), 'master')
  git(['checkout', '-q', '-b', 'feat'], dir)
  git(['branch', '-D', 'master'], dir)
  assert.equal(defaultBranch(dir), null)
}))

test('uncommitted: staged + unstaged + untracked', withRepo(dir => {
  const base = commit(dir, { 'a.js': lines(3), 'b.js': lines(3) }, 'init')
  write(dir, 'a.js', lines(3, i => (i === 2 ? 'x' : `l${i}`)))
  write(dir, 'b.js', lines(4))
  git(['add', 'b.js'], dir)
  write(dir, 'new.js', 'n\n')
  const t = collectTarget(dir, {}, [])
  assert.equal(t.kind, 'uncommitted')
  assert.equal(t.baseSha, base)
  assert.deepEqual(t.files.map(f => f.path).sort(), ['a.js', 'b.js', 'new.js'])
  assert.match(t.untrackedText, /new\.js/)
  assert.match(t.stagedText, /b\.js/)
  assert.deepEqual(t.indexOnly, [])
}))

test('push: upstream 이후 커밋', withRepo(dir => {
  const base = commit(dir, { 'a.js': lines(3) }, 'init')
  git(['checkout', '-q', '-b', 'feat'], dir)
  git(['branch', '--set-upstream-to=main'], dir) // 원격 없이 로컬 브랜치를 upstream 으로 쓴다
  commit(dir, { 'b.js': 'b\n' }, 'second')
  const t = collectTarget(dir, {}, [])
  assert.equal(t.kind, 'push')
  assert.equal(t.baseSha, base)
  assert.deepEqual(t.files.map(f => f.path), ['b.js'])
}))

test('branch: 기본 브랜치와의 merge-base', withRepo(dir => {
  const base = commit(dir, { 'a.js': lines(3) }, 'init')
  git(['checkout', '-q', '-b', 'feat'], dir)
  commit(dir, { 'b.js': 'b\n' }, 'second')
  const t = collectTarget(dir, {}, [])
  assert.equal(t.kind, 'branch')
  assert.equal(t.baseSha, base)
  assert.deepEqual(t.files.map(f => f.path), ['b.js'])
}))

test('깨끗하게 기본 브랜치 위에 있으면 diff 가 비어 있다', withRepo(dir => {
  commit(dir, { 'a.js': 'a\n' }, 'init')
  const t = collectTarget(dir, {}, [])
  assert.equal(t.kind, 'branch') // main 위에서는 upstream 이 없어 branch 로 잡히지만 diff 는 비어 있다
  assert.deepEqual(t.files, [])
}))

test('PR base: 로컬에 없으면 멈춘다', withRepo(dir => {
  commit(dir, { 'a.js': 'a\n' }, 'init')
  const sha = 'a'.repeat(40)
  assert.throws(() => collectTarget(dir, { pr: true, prBaseOid: sha }, []),
    { message: `PR base ${sha} 가 로컬에 없다 — git fetch origin <base> 후 다시 실행` })
}))

test('PR: base 와 HEAD 의 merge-base 부터', withRepo(dir => {
  const base = commit(dir, { 'a.js': 'a\n' }, 'init')
  git(['checkout', '-q', '-b', 'feat'], dir)
  commit(dir, { 'b.js': 'b\n' }, 'pr work')
  git(['checkout', '-q', 'main'], dir)
  const newer = commit(dir, { 'c.js': 'c\n' }, 'main moved')
  git(['checkout', '-q', 'feat'], dir)
  const t = collectTarget(dir, { pr: true, prBaseOid: newer }, [])
  assert.equal(t.kind, 'pr')
  assert.equal(t.mode, 'deep')
  assert.equal(t.baseSha, base)
  assert.deepEqual(t.files.map(f => f.path), ['b.js'])
}))

test('index 전용 변경 (Codex 재현)', withRepo(dir => {
  const body = 'class Auth {\n  void run() {\n    checkPermission();\n    work();\n  }\n}\n'
  commit(dir, { 'Auth.java': body }, 'init')
  write(dir, 'Auth.java', body.replace('    checkPermission();\n', ''))
  git(['add', 'Auth.java'], dir)
  write(dir, 'Auth.java', body)
  const t = collectTarget(dir, {}, [])
  assert.deepEqual(t.indexOnly, ['Auth.java'])
  assert.equal(t.diffText, '')
}))

test('부분 stage 는 index 전용이 아니다', withRepo(dir => {
  commit(dir, { 'a.js': lines(10) }, 'init')
  write(dir, 'a.js', lines(10).replace('l1\n', 'l1\nstaged\n'))
  git(['add', 'a.js'], dir)
  write(dir, 'a.js', lines(10).replace('l1\n', 'l1\nstaged\n').replace('l5\n', 'l5\nunstaged\n'))
  assert.deepEqual(collectTarget(dir, {}, []).indexOnly, [])
}))

test('빈 저장소 — 빈 트리 기준', withRepo(dir => {
  write(dir, 'a.js', 'a\n')
  const t = collectTarget(dir, {}, [])
  assert.equal(t.kind, 'uncommitted')
  assert.equal(t.baseSha, '4b825dc642cb6eb9a060e54bf8d69288fbee4904')
  assert.equal(t.headSha, null)
  assert.deepEqual(t.files.map(f => f.path), ['a.js'])
}))

test('경로 토큰은 tracked 와 untracked 모두 거른다', withRepo(dir => {
  commit(dir, { 'src/a/x.js': 'x\n', 'src/b/y.js': 'y\n' }, 'init')
  write(dir, 'src/a/x.js', 'x2\n')
  write(dir, 'src/b/y.js', 'y2\n')
  write(dir, 'src/a/n.js', 'n\n')
  write(dir, 'src/b/m.js', 'm\n')
  const t = collectTarget(dir, {}, ['src/a'])
  assert.deepEqual(t.files.map(f => f.path).sort(), ['src/a/n.js', 'src/a/x.js'])
}))

test('changedLines: lockfile 은 세지 않고 큰 diff 면 경고', withRepo(dir => {
  commit(dir, { 'a.js': 'a\n' }, 'init')
  write(dir, 'package-lock.json', lines(5000))
  write(dir, 'a.js', lines(10))
  let t = collectTarget(dir, {}, [])
  assert.equal(t.changedLines, 11) // a.js: +10 -1
  assert.deepEqual(t.warnings, [])
  write(dir, 'big.js', lines(2700))
  t = collectTarget(dir, {}, [])
  assert.equal(t.changedLines, 2711)
  assert.deepEqual(t.warnings, ['변경 2711줄 — 5분 안에 끝나지 않을 수 있다. 경로 인수로 나눠 리뷰하라(예: /deep-review src/order/)'])
}))

test('바이너리는 범위에서 뺀다', withRepo(dir => {
  commit(dir, { 'a.js': 'a\n' }, 'init')
  writeFileSync(path.join(dir, 'img.png'), Buffer.from([0, 1, 2, 0, 255, 0]))
  assert.deepEqual(collectTarget(dir, {}, []).files, [])
}))

for (const driver of ['external', 'textconv']) {
  test(`설정된 ${driver} 실행 없이 원본 diff 수집`, withRepo(dir => {
    commit(dir, { '.gitattributes': '*.js diff=unsafe\n', 'a.js': 'check();\nwork();\n' }, 'init')
    // 실행되면 표식을 남기고 diff 결과를 숨기는 드라이버.
    write(dir, 'driver.sh', '#!/bin/sh\necho ran > driver-ran\nprintf "hidden\\n"\n')
    const command = 'sh ./driver.sh'
    git(['config', driver === 'external' ? 'diff.external' : 'diff.unsafe.textconv', command], dir)
    write(dir, 'a.js', 'work();\n')
    git(['add', 'a.js'], dir)
    write(dir, 'a.js', 'check();\nwork();\n')
    write(dir, 'new.js', 'new();\n')
    const t = collectTarget(dir, {}, ['a.js', 'new.js'])
    assert.deepEqual(t.indexOnly, ['a.js'])
    assert.deepEqual(t.files.map(f => f.path), ['new.js'])
    assert.equal(t.changedLines, 1)
    assert.match(t.stagedText, /-check\(\);/)
    assert.match(t.untrackedText, /\+new\(\);/)
    assert.equal(existsSync(path.join(dir, 'driver-ran')), false)
    write(dir, 'a.js', 'changed();\nwork();\n')
    const changed = collectTarget(dir, {}, ['a.js', 'new.js'])
    assert.deepEqual(changed.files.map(f => f.path), ['a.js', 'new.js'])
    assert.equal(changed.changedLines, 3)
    assert.equal(existsSync(path.join(dir, 'driver-ran')), false)
  }))
}
