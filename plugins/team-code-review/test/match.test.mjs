import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { makeRepo, removeRepo, commit } from './helpers.mjs'
import { parseDiff } from '../engine/diff.mjs'
import { buildScope } from '../engine/scope.mjs'
import { applySkip } from '../engine/store.mjs'
import { settleFinding } from '../engine/votes.mjs'
import { makeAnchor, locate, priorCandidates, attachPriors, applyHistory, convergence } from '../engine/match.mjs'

const code = ['function charge(order) {', '  const user = order.user;', '  validate(user);', '  return order.total;', '}', '', 'function receipt(order) {', '  return order.id;', '}']
const loc = (line, side = 'new', file = 'billing.js') => ({ path: file, side, line })
const vote = relation => ({ verdict: 'confirmed', severity: 'major', reason: '확인', fixSafe: true, relation })
const finding = (id = 'R1-1', lines = code, line = 4, extra = {}) => ({
  dimension: 'correctness', severity: 'major', loc: loc(line), title: '합계 검증 누락', tldr: '음수 금액을 청구한다', good: '', fix: '합계를 검증한다',
  assigned: 2, votes: [vote(null), vote(null)], priorId: null, verification: 'confirmed', votesText: '2/2', reasons: [], fixNote: '',
  id, anchor: makeAnchor(lines, line), ...extra,
})
const recordOf = (...findings) => ({ version: 1, rounds: [{ n: 1, baseSha: 'old-base', findings, conflicts: [] }], skips: {} })
const scopeOf = (lines = code, added = lines.map((_, i) => i + 1), hunks = [{ oldStart: 1, oldLines: lines.length, newStart: 1, newLines: lines.length }]) => buildScope([
  { path: 'billing.js', oldPath: 'billing.js', status: 'M', added, removed: added, hunks },
])
const reader = lines => (file, side) => file === 'billing.js' && ['old', 'new'].includes(side) ? lines : []
const current = (extra = {}) => finding('R2-1', code, 4, extra)

test('anchor 는 앞뒤 두 줄을 담고 CR 을 제거한다', () => {
  assert.deepEqual(makeAnchor(code.map(line => line + '\r'), 4), { text: code[3], before: code.slice(1, 3), after: code.slice(4, 6) })
  assert.deepEqual(makeAnchor(code, 1), { text: code[0], before: [], after: code.slice(1, 3) })
})

test('locate 는 삽입된 세 줄을 따라가고 CRLF 를 허용한다', () => {
  const moved = ['// 제목', '// 설명', ''].concat(code).map(line => line + '\r')
  assert.equal(locate(makeAnchor(code, 4), moved), 7)
})

test('locate 는 문맥 최다 일치를 고르고 동점이면 위를 고른다', () => {
  const anchor = makeAnchor(['before', 'target', 'after'], 2)
  assert.equal(locate(anchor, ['bad', 'target', 'bad', 'before', 'target', 'after']), 5)
  assert.equal(locate(anchor, ['before', 'target', 'after', 'before', 'target', 'after']), 2)
})

test('locate 는 원문이 사라지면 문맥이 같아도 null 이다', () => {
  assert.equal(locate(makeAnchor(code, 4), code.with(3, '  return Math.max(0, order.total);')), null)
})

test('같은 hunk 만 priorId 를 붙이고 최신 회차를 먼저 선택한다', () => {
  const lines = Array.from({ length: 35 }, (_, i) => `line ${i + 1}`)
  const scope = scopeOf(lines, [12, 14, 30], [{ oldStart: 10, oldLines: 5, newStart: 10, newLines: 5 }, { oldStart: 30, oldLines: 1, newStart: 30, newLines: 1 }])
  const record = recordOf(finding('R1-1', lines, 12))
  record.rounds.push({ n: 2, findings: [finding('R2-1', lines, 12)] })
  const candidates = priorCandidates(record, scope, reader(lines))
  const raws = [current({ loc: loc(14) }), current({ loc: loc(30) })]
  assert.deepEqual(attachPriors(raws, candidates, scope).map(raw => raw.priorId), ['R2-1', null])
  assert.equal(raws[0].priorId, null)
})

test('실제 git diff 의 수정 줄을 문맥으로 연결하여 왕복을 검증자에게 넘긴다', t => {
  const root = makeRepo()
  t.after(() => removeRepo(root))
  commit(root, { 'billing.js': code.join('\n') + '\n' }, '원본')
  const changed = code.with(3, '  return Math.max(0, order.total);')
  writeFileSync(path.join(root, 'billing.js'), changed.join('\n') + '\n')
  const diff = execFileSync('git', ['-c', 'core.quotePath=false', 'diff'], { cwd: root, encoding: 'utf8' })
  const scope = buildScope(parseDiff(diff))
  const candidates = priorCandidates(recordOf(finding()), scope, reader(changed))
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].loc.line, 4)
  const [attached] = attachPriors([current({ title: '합계 보정 제거', loc: loc(4) })], candidates, scope)
  const settled = settleFinding({ ...attached, votes: [vote('round_trip'), vote('round_trip')] })
  settled.id = 'R2-1'
  const result = applyHistory([settled], recordOf(finding()), candidates, reader(changed))
  assert.deepEqual(result.conflicts, [{ newId: 'R2-1', priorId: 'R1-1' }])
  assert.equal(result.findings[0].folded, undefined)
})

test('문맥 교체는 유일할 때만 허용하고 단순 옛 줄 번호는 사용하지 않는다', () => {
  const record = recordOf(finding())
  const changed = code.with(3, '  return safeTotal(order);')
  assert.equal(priorCandidates(record, scopeOf(changed), reader(changed)).length, 1)
  const duplicated = [...changed, ...changed]
  assert.deepEqual(priorCandidates(record, scopeOf(duplicated), reader(duplicated)), [])
  assert.deepEqual(priorCandidates(record, scopeOf(), reader(['unrelated', 'module', 'at', 'same line'])), [])
  assert.deepEqual(priorCandidates(recordOf(finding('R1-1', ['old'], 1)), scopeOf(['new']), reader(['new'])), [])
})

test('보류는 첫 대응에서 현재 수정 코드를 굳히고 다음 회차까지 유지한다', () => {
  const changed = code.with(3, '  return safeTotal(order);')
  const record = recordOf(finding())
  assert.equal(applySkip(record, 'R1-1', '이미 고쳤음').ok, true)
  const candidates = priorCandidates(record, scopeOf(changed), reader(changed))
  const first = applyHistory([], record, candidates, reader(changed))
  assert.deepEqual(record.skips['R1-1'].snapshot, makeAnchor(changed, 4))
  assert.equal(first.carried[0].folded.byId, 'R1-1')
  assert.equal(first.carried[0].folded.memo, '이미 고쳤음')
  const again = applyHistory([], record, priorCandidates(record, scopeOf(changed), reader(changed)), reader(changed))
  assert.equal(again.carried.length, 1)
  assert.equal(again.carried[0].anchor.text, changed[3])
})

test('굳은 보류 줄이 다시 수정되면 보류를 해제하고 일반 발견으로 낸다', () => {
  const record = recordOf(finding())
  applySkip(record, 'R1-1', null)
  applyHistory([], record, priorCandidates(record, scopeOf(), reader(code)), reader(code))
  const changed = code.with(3, '  return -order.total;')
  const newFinding = current({ loc: loc(4), anchor: makeAnchor(changed, 4), priorId: 'R1-1' })
  const result = applyHistory([newFinding], record, priorCandidates(record, scopeOf(changed), reader(changed)), reader(changed))
  assert.equal(record.skips['R1-1'], undefined)
  assert.equal(result.findings[0].folded, undefined)
  assert.deepEqual(result.carried, [])
})

test('옛 발견 원문이 다른 곳에 남아도 굳은 보류 스냅샷 위치를 우선한다', () => {
  const record = recordOf(finding())
  const changed = code.with(3, '  return safeTotal(order);')
  applySkip(record, 'R1-1', null)
  applyHistory([], record, priorCandidates(record, scopeOf(changed), reader(changed)), reader(changed))
  const withOldText = [...changed, ...code]
  const [candidate] = priorCandidates(record, scopeOf(withOldText), reader(withOldText))
  assert.equal(candidate.loc.line, 4)
})

test('보류가 범위 밖이면 이월하거나 굳히지 않는다', () => {
  const record = recordOf(finding())
  applySkip(record, 'R1-1', null)
  const candidates = priorCandidates(record, scopeOf(code, [8]), reader(code))
  assert.deepEqual(candidates, [])
  assert.deepEqual(applyHistory([], record, candidates, reader(code)).carried, [])
  assert.equal(record.skips['R1-1'].snapshot, null)
})

test('재등장한 동일 보류 발견은 현재 발견과 합치고 새 문제는 숨기지 않는다', () => {
  for (const relation of [null, 'new_problem']) {
    const record = recordOf(finding())
    applySkip(record, 'R1-1', null)
    const result = applyHistory([current({ priorId: 'R1-1', votes: [vote(relation), vote(relation)] })], record, priorCandidates(record, scopeOf(), reader(code)), reader(code))
    if (relation === null) {
      assert.equal(result.findings[0].folded.byId, 'R1-1')
      assert.deepEqual(result.carried, [])
    } else {
      assert.equal(result.findings[0].folded, undefined)
      assert.equal(result.carried.length, 1)
    }
  }
})

test('같은 hunk 의 별개 문제는 보류와 합치지 않는다', () => {
  const record = recordOf(finding())
  applySkip(record, 'R1-1', null)
  const result = applyHistory([current({ priorId: 'R1-1', title: '영수증 id 누락' })], record, priorCandidates(record, scopeOf(), reader(code)), reader(code))
  assert.equal(result.findings[0].folded, undefined)
  assert.equal(result.carried.length, 1)
})

test('채택 판단의 왕복은 기각 이유로 접으며 버린 쪽이 사라져도 유지한다', () => {
  for (const rejectedPresent of [true, false]) {
    const rejected = finding('R1-3', rejectedPresent ? code : ['옛 함수', '사라진 지적', '옛 끝'], rejectedPresent ? 4 : 2)
    const adopted = finding('R2-1', code, 4, { title: '안전한 합계 사용' })
    const record = recordOf(rejected)
    record.rounds.push({ n: 2, findings: [adopted], conflicts: [{ newId: adopted.id, priorId: rejected.id }] })
    applySkip(record, rejected.id, '이번 판단 채택')
    const result = applyHistory([current({ id: 'R3-1', priorId: adopted.id, conflict: { priorId: adopted.id } })], record, priorCandidates(record, scopeOf(), reader(code)), reader(code))
    assert.deepEqual(result.conflicts, [])
    assert.deepEqual(result.findings[0].folded, { byId: 'R1-3', memo: '이번 판단 채택', reason: 'R1-3 기각에 따름' })
  }
})

test('채택된 상대도 범위 밖이면 접거나 이월하지 않는다', () => {
  const record = recordOf(finding('R1-3'), finding('R2-1'))
  record.skips['R1-3'] = { memo: null, at: '', snapshot: null, adopted: 'R2-1' }
  const result = applyHistory([current({ conflict: { priorId: 'R2-1' } })], record, priorCandidates(record, scopeOf(code, [8]), reader(code)), reader(code))
  assert.equal(result.findings[0].folded, undefined)
  assert.deepEqual(result.carried, [])
})

test('기각된 발견의 충돌은 사용하지 않고 새 문제 표가 있으면 접지 않는다', () => {
  const record = recordOf(finding())
  applySkip(record, 'R1-1', null)
  const result = applyHistory([current({ verification: 'refuted', conflict: { priorId: 'R1-1' } }), current({ id: 'R2-2', votes: [vote('new_problem'), vote('round_trip')], conflict: { priorId: 'R1-1' } })], record, priorCandidates(record, scopeOf(), reader(code)), reader(code))
  assert.deepEqual(result.conflicts, [])
  assert.equal(result.findings[1].folded, undefined)
})

test('rebase 로 기준이 바뀌고 줄이 이동해도 대응한다', () => {
  const record = recordOf(finding())
  record.rounds[0].baseSha = 'before-rebase'
  const moved = ['// 기반 변경', ...code]
  assert.equal(priorCandidates(record, scopeOf(moved), reader(moved))[0].loc.line, 5)
})

test('삭제 쪽과 이름 변경 경로는 scope API 의 위치 규칙을 따른다', () => {
  const record = recordOf(finding('R1-1', code, 4, { loc: loc(4, 'old', 'old.js') }))
  const scope = buildScope([{ path: 'new.js', oldPath: 'old.js', status: 'R', added: [], removed: [4], hunks: [{ oldStart: 1, oldLines: 9, newStart: 1, newLines: 9 }] }])
  const candidates = priorCandidates(record, scope, () => code)
  assert.equal(candidates[0].loc.path, 'new.js')
  assert.equal(candidates[0].loc.side, 'old')
})

test('수렴 요약은 해결과 실패 차원의 미확인을 분리한다', () => {
  const record = recordOf(finding(), finding('R1-2', code, 8, { dimension: 'test-coverage', title: '영수증 테스트 누락' }))
  assert.deepEqual(convergence(record, [], ['test-coverage'], priorCandidates(record, scopeOf(), reader(code))), { resolved: 1, fresh: 0, conflicts: 0, skipped: 0, unchecked: 1 })
})

test('수렴 요약은 반복 발견을 새 것으로 세지 않고 보류/충돌/새 문제를 센다', () => {
  const record = recordOf(finding())
  const candidates = priorCandidates(record, scopeOf(), reader(code))
  assert.deepEqual(convergence(record, [current({ priorId: 'R1-1' })], [], candidates), { resolved: 0, fresh: 0, conflicts: 0, skipped: 0, unchecked: 0 })
  assert.deepEqual(convergence(record, [current({ conflict: { priorId: 'R1-1' }, priorId: 'R1-1' }), current({ id: 'R2-2', title: '새 버그', loc: loc(8) })], [], candidates), { resolved: 0, fresh: 1, conflicts: 1, skipped: 0, unchecked: 0 })
  applySkip(record, 'R1-1', null)
  const { findings, carried } = applyHistory([], record, candidates, reader(code))
  assert.deepEqual(convergence(record, [...findings, ...carried], [], candidates), { resolved: 0, fresh: 0, conflicts: 0, skipped: 1, unchecked: 0 })
})

test('새 문제로 검증된 발견은 priorId 가 있어도 새 발견으로 센다', () => {
  const record = recordOf(finding())
  const candidates = priorCandidates(record, scopeOf(), reader(code))
  const next = current({ priorId: 'R1-1', votes: [vote('new_problem'), vote('round_trip')] })
  assert.deepEqual(convergence(record, [next], [], candidates), { resolved: 1, fresh: 1, conflicts: 0, skipped: 0, unchecked: 0 })
})

test('여러 회차에서 이월된 같은 id 는 후보와 보류 표시를 중복하지 않는다', () => {
  const record = recordOf(finding())
  applySkip(record, 'R1-1', null)
  const first = applyHistory([], record, priorCandidates(record, scopeOf(), reader(code)), reader(code))
  record.rounds.push({ n: 2, findings: first.carried })
  const candidates = priorCandidates(record, scopeOf(), reader(code))
  assert.equal(candidates.length, 1)
  const second = applyHistory([], record, candidates, reader(code))
  assert.equal(second.carried.length, 1)
})

test('보류 코드의 줄 이동과 CRLF 변경은 보류 해제 사유가 아니다', () => {
  const record = recordOf(finding())
  applySkip(record, 'R1-1', null)
  applyHistory([], record, priorCandidates(record, scopeOf(), reader(code)), reader(code))
  const moved = ['// 이동', ...code].map(line => line + '\r')
  const result = applyHistory([], record, priorCandidates(record, scopeOf(moved), reader(moved)), reader(moved))
  assert.equal(result.carried[0].loc.line, 5)
  assert.ok(record.skips['R1-1'])
})

test('채택 판단으로 굳은 보류도 그 자리가 다시 바뀌면 왕복을 접지 않는다', () => {
  const rejected = finding('R1-3', ['이전 함수', '이전 지적', '이전 끝'], 2)
  const record = recordOf(rejected, finding('R2-1'))
  record.skips['R1-3'] = { memo: null, at: '', snapshot: null, adopted: 'R2-1' }
  applyHistory([], record, priorCandidates(record, scopeOf(), reader(code)), reader(code))
  const changed = code.with(3, '  return latestTotal(order);')
  const result = applyHistory([current({ id: 'R3-1', conflict: { priorId: 'R2-1' }, anchor: makeAnchor(changed, 4) })], record, priorCandidates(record, scopeOf(changed), reader(changed)), reader(changed))
  assert.equal(record.skips['R1-3'], undefined)
  assert.equal(result.findings[0].folded, undefined)
  assert.deepEqual(result.conflicts, [{ newId: 'R3-1', priorId: 'R2-1' }])
})

test('같은 문제의 여러 보류 id 가 있어도 현재 발견 하나로 합친다', () => {
  const record = recordOf(finding())
  record.rounds.push({ n: 2, findings: [finding('R2-1')], conflicts: [] })
  applySkip(record, 'R1-1', null)
  applySkip(record, 'R2-1', null)
  const result = applyHistory([current({ id: 'R3-1', priorId: 'R2-1' })], record, priorCandidates(record, scopeOf(), reader(code)), reader(code))
  assert.equal(result.findings.length, 1)
  assert.deepEqual(result.carried, [])
})

test('과거의 새 문제 표가 있는 발견도 사용자가 보류한 뒤에는 해결로 세지 않는다', () => {
  const record = recordOf(finding('R1-1', code, 4, { votes: [vote('new_problem'), vote('new_problem')] }))
  applySkip(record, 'R1-1', null)
  const candidates = priorCandidates(record, scopeOf(), reader(code))
  const { carried } = applyHistory([], record, candidates, reader(code))
  assert.deepEqual(convergence(record, carried, [], candidates), { resolved: 0, fresh: 0, conflicts: 0, skipped: 1, unchecked: 0 })
})
