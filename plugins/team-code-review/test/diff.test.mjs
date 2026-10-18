import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { git } from '../engine/git.mjs'
import { parseDiff, untrackedDiff, isLockfile } from '../engine/diff.mjs'
import { makeRepo, commit, removeRepo } from './helpers.mjs'

const lines = (n, f = i => `l${i}`) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n'
const one = (dir, base = 'HEAD') => {
  const r = parseDiff(git(['diff', base], dir))
  assert.equal(r.length, 1)
  return r[0]
}
const withRepo = fn => () => { const dir = makeRepo(); try { fn(dir) } finally { removeRepo(dir) } }

test('수정', withRepo(dir => {
  commit(dir, { 'a.js': lines(5) }, 'init')
  writeFileSync(path.join(dir, 'a.js'), lines(5, i => (i === 3 ? 'changed' : `l${i}`)))
  const d = one(dir)
  assert.equal(d.status, 'M')
  assert.deepEqual(d.added, [3])
  assert.deepEqual(d.removed, [3])
  assert.deepEqual(d.addedText, ['changed'])
  assert.deepEqual(d.removedText, ['l3'])
}))

test('hunk 여러 개', withRepo(dir => {
  commit(dir, { 'a.js': lines(30) }, 'init')
  writeFileSync(path.join(dir, 'a.js'), lines(30, i => (i === 2 || i === 20 ? 'x' : `l${i}`)))
  const d = one(dir)
  assert.deepEqual(d.added, [2, 20])
  assert.equal(d.hunks.length, 2)
}))

test('새 파일', withRepo(dir => {
  commit(dir, { 'keep.txt': 'k\n' }, 'init')
  commit(dir, { 'n.js': lines(3) }, 'add')
  const d = one(dir, 'HEAD~1')
  assert.equal(d.status, 'A')
  assert.deepEqual(d.added, [1, 2, 3])
  assert.deepEqual(d.removed, [])
}))

test('파일 전체 삭제', withRepo(dir => {
  commit(dir, { 'd.js': lines(3), 'keep.txt': 'k\n' }, 'init')
  commit(dir, { 'd.js': null }, 'del')
  const d = one(dir, 'HEAD~1')
  assert.equal(d.status, 'D')
  assert.equal(d.path, 'd.js')
  assert.deepEqual(d.added, [])
  assert.deepEqual(d.removed, [1, 2, 3])
}))

test('이름 변경', withRepo(dir => {
  commit(dir, { 'a.js': lines(10) }, 'init')
  git(['mv', 'a.js', 'b.js'], dir)
  writeFileSync(path.join(dir, 'b.js'), lines(10, i => (i === 1 ? 'first' : `l${i}`)))
  git(['add', '-A'], dir)
  const d = one(dir)
  assert.equal(d.status, 'R')
  assert.equal(d.path, 'b.js')
  assert.equal(d.oldPath, 'a.js')
  assert.deepEqual(d.added, [1])
}))

test('바이너리', withRepo(dir => {
  commit(dir, { 'keep.txt': 'k\n' }, 'init')
  commit(dir, { 'img.png': '\x89PNG\x00\x01\x02binary\x00' }, 'png')
  const d = one(dir, 'HEAD~1')
  assert.equal(d.status, 'B')
  assert.equal(d.path, 'img.png')
  assert.deepEqual(d.added, [])
  assert.deepEqual(d.removed, [])
}))

test('좌표계 (Codex 재현): 커밋 이후 미커밋 삽입이 있어도 new 쪽 줄 번호', withRepo(dir => {
  commit(dir, { 'a.js': lines(8) }, 'init')
  commit(dir, { 'a.js': lines(8, i => (i === 5 ? 'committed' : `l${i}`)) }, 'change5')
  const cur = lines(8, i => (i === 5 ? 'committed' : `l${i}`))
  writeFileSync(path.join(dir, 'a.js'), 'ins1\nins2\n' + cur)
  // 기준은 5행 변경 커밋 직전
  const before = git(['rev-parse', 'HEAD~1'], dir).trim()
  const d = one(dir, before)
  assert.deepEqual(d.added, [1, 2, 7])
}))

test('한글·공백 경로', withRepo(dir => {
  commit(dir, { '한 글.java': lines(3) }, 'init')
  writeFileSync(path.join(dir, '한 글.java'), lines(3, i => (i === 2 ? 'x' : `l${i}`)))
  const d = one(dir)
  assert.equal(d.path, '한 글.java')
  assert.deepEqual(d.added, [2])
}))

test('따옴표 경로 (quotePath 기본값) 도 풀어서 읽는다', withRepo(dir => {
  commit(dir, { '한글.java': lines(3) }, 'init')
  writeFileSync(path.join(dir, '한글.java'), lines(3, i => (i === 2 ? 'x' : `l${i}`)))
  const text = git(['-c', 'core.quotePath=true', 'diff'], dir)
  assert.match(text, /\\355/)
  assert.equal(parseDiff(text)[0].path, '한글.java')
}))

test('\\ No newline at end of file 은 무시한다', withRepo(dir => {
  commit(dir, { 'a.txt': 'a\nb' }, 'init')
  writeFileSync(path.join(dir, 'a.txt'), 'a\nc')
  const d = one(dir)
  assert.deepEqual(d.added, [2])
  assert.deepEqual(d.addedText, ['c'])
  assert.deepEqual(d.removed, [2])
}))

test('"-- " 로 시작하는 삭제 줄이 헤더로 오인되지 않는다', withRepo(dir => {
  commit(dir, { 'q.sql': '-- comment\nselect 1;\n' }, 'init')
  writeFileSync(path.join(dir, 'q.sql'), 'select 1;\n')
  const d = one(dir)
  assert.deepEqual(d.removed, [1])
  assert.deepEqual(d.removedText, ['-- comment'])
}))

test('untracked', withRepo(dir => {
  commit(dir, { 'keep.txt': 'k\n' }, 'init')
  writeFileSync(path.join(dir, 'new.java'), lines(3))
  const [d] = untrackedDiff(dir, ['new.java'])
  assert.equal(d.status, 'A')
  assert.equal(d.path, 'new.java')
  assert.deepEqual(d.added, [1, 2, 3])
  assert.deepEqual(untrackedDiff(dir, []), [])
}))

test('isLockfile', () => {
  assert.equal(isLockfile('package-lock.json'), true)
  assert.equal(isLockfile('sub/yarn.lock'), true)
  assert.equal(isLockfile('pnpm-lock.yaml'), true)
  assert.equal(isLockfile('gradle.lockfile'), true)
  assert.equal(isLockfile('lock.java'), false)
  assert.equal(isLockfile('src/mypackage-lock.json.js'), false)
})

for (const [key, label] of [['diff.mnemonicPrefix', 'mnemonicPrefix'], ['diff.noprefix', 'noprefix']]) {
  test(`${label} 설정이 켜져 있어도 경로를 바로 읽는다`, withRepo(dir => {
    commit(dir, { 'f.txt': 'a\nb\n' }, 'init')
    git(['config', key, 'true'], dir)
    writeFileSync(path.join(dir, 'f.txt'), 'a\nc\n')
    const d = one(dir)
    assert.equal(d.path, 'f.txt')
    assert.equal(d.oldPath, 'f.txt')
    assert.deepEqual(d.added, [2])
  }))
}

test('사용자 설정(srcPrefix·color=always)에도 경로를 바르게 읽는다', withRepo(dir => {
  commit(dir, { 'a.js': lines(3) }, 'init')
  git(['config', 'diff.srcPrefix', 'src/'], dir)
  git(['config', 'color.ui', 'always'], dir)
  writeFileSync(path.join(dir, 'a.js'), lines(3, i => (i === 2 ? 'x' : `l${i}`)))
  const d = one(dir)
  assert.equal(d.path, 'a.js')
  assert.deepEqual(d.added, [2])
}))
