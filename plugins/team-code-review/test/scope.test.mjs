import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildScope, inScope, filterFindings, hunkOf, scopeSummary } from '../engine/scope.mjs'

const file = (overrides = {}) => ({ path: 'A.java', oldPath: 'A.java', status: 'M', added: [3, 4], removed: [7], addedText: [], removedText: [], hunks: [{ oldStart: 6, oldLines: 3, newStart: 2, newLines: 4 }], ...overrides })
const loc = (line, side = 'new', path = 'A.java') => ({ path, side, line })

test('new 쪽 경계와 old 쪽 삭제 줄만 허용한다', () => {
  const scope = buildScope([file()])
  for (const line of [3, 4]) assert.equal(inScope(loc(line), scope), true)
  for (const line of [2, 5, 7]) assert.equal(inScope(loc(line), scope), false)
  assert.equal(inScope(loc(7, 'old'), scope), true)
  assert.equal(inScope(loc(3, 'old'), scope), false)
  assert.equal(inScope(loc(3, 'new', 'Unknown.java'), scope), false)
})

test('삭제 파일은 oldPath 키와 old 쪽만, 바이너리는 어디도 허용하지 않는다', () => {
  const scope = buildScope([file({ path: '/dev/null', oldPath: 'Gone.java', status: 'D', added: [2], removed: [2] }), file({ path: 'image.png', status: 'B', added: [3], removed: [3] })])
  assert.equal(scope.has('Gone.java'), true)
  assert.equal(inScope(loc(2, 'old', 'Gone.java'), scope), true)
  assert.equal(inScope(loc(2, 'new', 'Gone.java'), scope), false)
  for (const side of ['old', 'new']) assert.equal(inScope(loc(3, side, 'image.png'), scope), false)
  assert.equal(scopeSummary(scope), 'Gone.java: old: 2')
})

test('이름 변경은 새 경로와 일치하는 선택적 oldPath 로 판정한다', () => {
  const scope = buildScope([file({ path: 'New.java', oldPath: 'Old.java', status: 'R' })])
  assert.equal(inScope(loc(7, 'old', 'New.java'), scope), true)
  assert.equal(inScope({ ...loc(7, 'old', 'New.java'), oldPath: 'Old.java' }, scope), true)
  assert.equal(inScope(loc(7, 'old', 'Old.java'), scope), false)
  assert.equal(inScope({ ...loc(7, 'old', 'New.java'), oldPath: 'Other.java' }, scope), false)
})

test('잘못된 위치와 새 파일의 old 쪽은 거부한다', () => {
  const scope = buildScope([file(), file({ path: 'Added.java', status: 'A', removed: [7] })])
  for (const bad of [null, undefined, {}, { ...loc(3), side: undefined }, { ...loc(3), side: 'both' }, ...[0, -1, 3.5, '3', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(line => loc(line))]) {
    assert.equal(inScope(bad, scope), false)
    assert.equal(hunkOf(bad, scope), null)
  }
  assert.equal(inScope(loc(7, 'old', 'Added.java'), scope), false)
})

test('filterFindings 는 원본 순서와 객체를 유지하고 범위 밖 개수를 센다', () => {
  const findings = [loc(3), loc(2), loc(7, 'old'), loc(4), loc(7)].map((loc, i) => ({ loc, title: String(i) }))
  const result = filterFindings(findings, buildScope([file()]))
  assert.deepEqual(result, { kept: [findings[0], findings[2], findings[3]], dropped: 2 })
  assert.equal(result.kept[0], findings[0])
})

test('hunkOf 는 해당 쪽 전체 hunk 경계를 반환하되 변경 줄만 허용한다', () => {
  const scope = buildScope([file({ added: [2, 3, 20], hunks: [{ oldStart: 6, oldLines: 3, newStart: 1, newLines: 5 }, { oldStart: 19, oldLines: 0, newStart: 20, newLines: 1 }] })])
  assert.deepEqual(hunkOf(loc(3), scope), { path: 'A.java', side: 'new', start: 1, end: 5 })
  assert.deepEqual(hunkOf(loc(20), scope), { path: 'A.java', side: 'new', start: 20, end: 20 })
  assert.deepEqual(hunkOf(loc(7, 'old'), scope), { path: 'A.java', side: 'old', start: 6, end: 8 })
  assert.equal(hunkOf(loc(1), scope), null)
  assert.equal(hunkOf(loc(3), buildScope([file({ hunks: [] })])), null)
})

test('scopeSummary 는 정렬된 연속 범위와 old 범위를 간결하게 표시한다', () => {
  const scope = buildScope([file({ added: [20, 5, 3, 4, 3], removed: [9, 7, 8] }), file({ path: '한글 파일.java', added: [1], removed: [] })])
  assert.equal(scopeSummary(scope), 'A.java: 3-5, 20 / old: 7-9\n한글 파일.java: 1')
  assert.equal(scopeSummary(buildScope([])), '')
  assert.equal(scopeSummary(buildScope([file({ added: [], removed: [] })])), '')
})
