import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeVerdict } from '../engine/verdict.mjs'

const finding = (severity, overrides = {}) => ({ severity, verification: 'confirmed', ...overrides })
const compute = (findings = [], overrides = {}) => computeVerdict({ findings, failedDims: [], indexOnly: [], ...overrides })

test('등급별 개수와 가장 무거운 발견으로 판정한다', () => {
  for (const [findings, verdict, counts] of [
    [[], 'Approve', { critical: 0, major: 0, minor: 0, nit: 0 }],
    [[finding('critical')], 'Blocked', { critical: 1, major: 0, minor: 0, nit: 0 }],
    [[finding('major')], 'Changes Requested', { critical: 0, major: 1, minor: 0, nit: 0 }],
    [[finding('minor'), finding('nit', { verification: 'skipped' })], 'Approve', { critical: 0, major: 0, minor: 1, nit: 1 }],
    [['critical', 'major', 'major', 'minor', 'nit'].map(severity => finding(severity)), 'Blocked', { critical: 1, major: 2, minor: 1, nit: 1 }],
  ]) assert.deepEqual(compute(findings), { verdict, counts, notes: [] })
})

test('미검증은 포함하고 보류·충돌·반박된 발견은 세지 않는다', () => {
  assert.equal(compute([finding('major', { verification: 'unverified' })]).verdict, 'Changes Requested')
  const result = compute([
    finding('major', { folded: { byId: 'R1-1', memo: '나중에', reason: '보류' } }),
    finding('major', { conflict: { priorId: 'R1-2' } }),
    finding('critical', { verification: 'refuted' }),
  ])
  assert.deepEqual(result, { verdict: 'Approve', counts: { critical: 0, major: 0, minor: 0, nit: 0 }, notes: [] })
})

test('실패 차원과 index 전용 변경은 승인만 Incomplete 로 바꾸고 경고를 남긴다', () => {
  const failedDims = ['security', 'correctness']
  const indexOnly = ['Auth.java', '한글 파일.java']
  const notes = [
    '⚠ security 차원은 실행되지 않았다',
    '⚠ correctness 차원은 실행되지 않았다',
    '⚠ 커밋될 내용(index)이 리뷰한 내용(작업 트리)과 다르다: Auth.java',
    '⚠ 커밋될 내용(index)이 리뷰한 내용(작업 트리)과 다르다: 한글 파일.java',
  ]
  assert.equal(compute([], { failedDims: ['security'] }).verdict, 'Incomplete')
  assert.equal(compute([], { indexOnly: ['Auth.java'] }).verdict, 'Incomplete')
  for (const [severity, verdict] of [['minor', 'Incomplete'], ['major', 'Changes Requested'], ['critical', 'Blocked']]) {
    const result = compute([finding(severity)], { failedDims, indexOnly })
    assert.equal(result.verdict, verdict)
    assert.deepEqual(result.notes, notes)
  }
})

test('입력은 변경하지 않는다', () => {
  const input = { findings: [finding('major'), finding('minor', { folded: { byId: 'R1-1' } })], failedDims: ['security'], indexOnly: ['Auth.java'] }
  const before = structuredClone(input)
  computeVerdict(input)
  assert.deepEqual(input, before)
})
