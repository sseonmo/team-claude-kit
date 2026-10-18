import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { makeRepo, removeRepo, commit } from './helpers.mjs'
import { encodeBranch, recordPath, loadRecord, saveRecord, applySkip } from '../engine/store.mjs'

const empty = () => ({ version: 1, rounds: [], skips: {} })
const finding = id => ({ id, title: `제목 ${id}`, verification: 'confirmed', loc: { path: 'a', side: 'new', line: 1 } })
const record = () => ({ version: 1, rounds: [{ n: 1, at: '2026-10-19', mode: 'fast', headSha: 'a', baseSha: 'b', reuseKey: 'key', findings: [finding('R1-1'), finding('R1-2')], conflicts: [], result: 'Approve' }], skips: {} })
function repo(t) { const root = makeRepo(); t.after(() => removeRepo(root)); return root }

test('브랜치 인코딩은 경로와 인코딩 표기의 충돌을 피한다', () => {
  assert.equal(encodeBranch('feature/x'), 'feature_2Fx')
  assert.equal(encodeBranch('main'), 'main')
  assert.equal(encodeBranch('feature_2Fx'), 'feature_5F2Fx')
  assert.notEqual(encodeBranch('feature/x'), encodeBranch('feature_2Fx'))
  assert.ok(!encodeBranch('한 글/../x').includes('/'))
})
test('빈 저장소의 브랜치 기록 경로와 없는 기록', t => {
  const root = repo(t)
  assert.equal(recordPath(root), path.join(root, '.git/deep-review/main.json'))
  assert.deepEqual(loadRecord(root), { record: empty(), notice: null })
  assert.equal(existsSync(path.join(root, '.git/deep-review')), false)
})
test('기록 저장은 왕복되고 임시 파일을 남기지 않는다', t => {
  const root = repo(t); const value = record()
  saveRecord(root, value)
  assert.deepEqual(loadRecord(root), { record: value, notice: null })
  saveRecord(root, empty())
  assert.deepEqual(JSON.parse(readFileSync(recordPath(root), 'utf8')), empty())
  assert.deepEqual(readdirSync(path.dirname(recordPath(root))), ['main.json'])
})
for (const damaged of ['{', 'null', '{}', '{"version":1,"rounds":[],"skips":[]}', '{"version":1,"rounds":[{}],"skips":{}}']) {
  test(`손상된 기록을 격리한다: ${damaged}`, t => {
    const root = repo(t); const file = recordPath(root)
    mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, damaged)
    const loaded = loadRecord(root)
    assert.deepEqual(loaded.record, empty()); assert.ok(loaded.notice)
    const files = readdirSync(path.dirname(file))
    assert.equal(files.length, 1); assert.ok(files[0].startsWith('main.json.corrupt-'))
    assert.equal(readFileSync(path.join(path.dirname(file), files[0]), 'utf8'), damaged)
  })
}
test('파일 시스템 오류는 손상으로 삼키지 않는다', t => {
  const root = repo(t); mkdirSync(recordPath(root), { recursive: true })
  assert.throws(() => loadRecord(root), { code: 'EISDIR' })
})
test('detached HEAD 에서는 읽기와 쓰기를 하지 않는다', t => {
  const root = repo(t); commit(root, { a: 'a' }, '첫 커밋'); saveRecord(root, record())
  execFileSync('git', ['checkout', '--detach', '-q'], { cwd: root })
  assert.equal(recordPath(root), null)
  assert.deepEqual(loadRecord(root), { record: empty(), notice: null })
  saveRecord(root, empty())
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, '.git/deep-review/main.json'), 'utf8')), record())
})
test('없는 id 와 이미 보류한 id 는 실패하고 기록을 바꾸지 않는다', () => {
  const value = record(); const before = structuredClone(value)
  assert.deepEqual(applySkip(value, 'R9-1', null), { ok: false, validIds: ['R1-1', 'R1-2'] })
  assert.deepEqual(value, before)
  applySkip(value, 'R1-1', null); const skipped = structuredClone(value)
  assert.deepEqual(applySkip(value, 'R1-1', null), { ok: false, validIds: ['R1-2'] })
  assert.deepEqual(value, skipped)
})
test('메모와 빈 snapshot 을 기록하고 제목을 반환한다', () => {
  const value = record()
  assert.deepEqual(applySkip(value, 'R1-2', '이미 위에서 막혀 있음'), { ok: true, title: '제목 R1-2' })
  assert.equal(value.skips['R1-2'].memo, '이미 위에서 막혀 있음')
  assert.equal(value.skips['R1-2'].snapshot, null)
  assert.equal(value.skips['R1-2'].adopted, null)
  assert.ok(Number.isFinite(Date.parse(value.skips['R1-2'].at)))
})
for (const [id, adopted] of [['R1-3', 'R2-1'], ['R2-1', 'R1-3']]) {
  test(`충돌 ${id} 를 보류하면 상대를 채택한다`, () => {
    const value = record(); value.rounds[0].findings.push(finding('R1-3'))
    value.rounds.push({ ...value.rounds[0], n: 2, findings: [finding('R2-1')], conflicts: [{ newId: 'R2-1', priorId: 'R1-3' }] })
    assert.equal(applySkip(value, id, null).ok, true)
    assert.equal(value.skips[id].adopted, adopted)
  })
}
test('worktree 기록은 공용 git 디렉터리에만 저장한다', t => {
  const root = repo(t); commit(root, { a: 'a' }, '첫 커밋')
  const worktree = path.join(root, 'linked')
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'feature/x', worktree], { cwd: root })
  assert.equal(recordPath(worktree), path.join(realpathSync(root), '.git/deep-review/feature_2Fx.json'))
  saveRecord(worktree, record())
  assert.deepEqual(loadRecord(worktree).record, record())
  assert.equal(existsSync(path.join(worktree, 'deep-review')), false)
})

test('unborn HEAD 와 구조화된 result 를 보존한다', t => {
  const root = repo(t); const value = record()
  value.rounds[0].headSha = null; value.rounds[0].result = { verdict: 'Approve', findings: [] }
  saveRecord(root, value)
  assert.deepEqual(loadRecord(root), { record: value, notice: null })
})
