import { test } from 'node:test'
import assert from 'node:assert/strict'
import { settleSeverity, settleFinding } from '../engine/votes.mjs'

const yes = (overrides = {}) => ({ verdict: 'confirmed', severity: 'major', reason: '결함을 확인했다.', fixSafe: true, relation: null, ...overrides })
const no = () => yes({ verdict: 'refuted', reason: '결함이 아니다.' })
const raw = (overrides = {}) => ({ dimension: 'correctness', severity: 'major', loc: { path: 'a.js', side: 'new', line: 1 }, title: '결함', tldr: '설명', good: '장점', fix: '수정안', assigned: 2, votes: [], priorId: null, ...overrides })

test('과반은 배정 인원 기준이며 동점과 검증자 사망은 미검증이다', () => {
  for (const [assigned, votes, verification, votesText] of [
    [2, [yes(), yes()], 'confirmed', '2/2'],
    [2, [no(), no()], 'refuted', '0/2'],
    [2, [yes(), no()], 'unverified', '1/2'],
    [2, [yes()], 'unverified', '1/2'],
    [2, [no()], 'unverified', '0/2'],
    [3, [yes(), yes(), no()], 'confirmed', '2/3'],
    [3, [yes(), no(), no()], 'refuted', '1/3'],
    [3, [yes(), no(), yes()], 'confirmed', '2/3'],
    [1, [yes()], 'confirmed', '1/1'],
    [1, [], 'unverified', '0/1'],
  ]) {
    const result = settleFinding(raw({ assigned, votes }))
    assert.equal(result.verification, verification)
    assert.equal(result.votesText, votesText)
    assert.equal(result.id, null)
  }
})

test('의도적으로 검증하지 않는 minor/nit 과 상한 때문에 배정 못한 major/critical 을 구분한다', () => {
  for (const severity of ['critical', 'major', 'minor', 'nit']) {
    const result = settleFinding(raw({ severity, assigned: 0 }))
    assert.equal(result.verification, ['minor', 'nit'].includes(severity) ? 'skipped' : 'unverified')
    assert.equal(result.votesText, '0/0')
    assert.equal(result.fixNote, '미검증')
  }
})

test('등급은 하향만 가능하며 두 표는 무거운 값, 세 표는 가운데를 고른다', () => {
  assert.equal(settleSeverity('major', []), 'major')
  assert.equal(settleSeverity('major', [yes({ severity: 'minor' }), yes({ severity: 'nit' })]), 'minor')
  assert.equal(settleSeverity('major', [yes({ severity: 'critical' }), yes({ severity: 'critical' })]), 'major')
  assert.equal(settleSeverity('critical', ['minor', 'critical', 'major'].map(severity => yes({ severity }))), 'major')
  const result = settleFinding(raw({ votes: [yes({ severity: 'minor' }), yes({ severity: 'minor' })] }))
  assert.equal(result.severity, 'minor')
  assert.equal(result.originalSeverity, 'major')
  assert.equal(Object.hasOwn(settleFinding(raw({ votes: [yes(), yes()] })), 'originalSeverity'), false)
})

test('미검증 표의 하향은 적용하지 않고 test-coverage 는 최고 major 로 제한한다', () => {
  assert.equal(settleFinding(raw({ votes: [yes({ severity: 'minor' })] })).severity, 'major')
  for (const votes of [[], [yes({ severity: 'critical' }), yes({ severity: 'critical' })]]) {
    const result = settleFinding(raw({ dimension: 'test-coverage', severity: 'critical', votes }))
    assert.equal(result.severity, 'major')
    assert.equal(result.originalSeverity, 'critical')
  }
})

test('확인 표의 위험한 fix 는 미검증에서도 제거하고 사유 첫 문장을 남긴다', () => {
  const unsafe = yes({ fixSafe: false, reason: '다른 동작을 망가뜨린다. 추가 설명이다.' })
  for (const votes of [[unsafe, yes()], [unsafe]]) {
    const result = settleFinding(raw({ votes }))
    assert.equal(result.fix, null)
    assert.equal(result.fixNote, '다른 동작을 망가뜨린다.')
  }
  const unverified = settleFinding(raw({ votes: [yes()] }))
  assert.equal(unverified.fix, '수정안')
  assert.equal(unverified.fixNote, '미검증')
  assert.equal(settleFinding(raw({ votes: [yes(), yes()] })).fixNote, '')
  assert.equal(settleFinding(raw({ votes: [yes(), no(), no()] })).fix, '수정안')
  assert.equal(settleFinding(raw({ votes: [yes(), yes({ verdict: 'refuted', fixSafe: false })] })).fix, '수정안')
})

test('관계는 확인 표 전부의 round_trip 합의와 priorId 를 요구한다', () => {
  const roundTrip = yes({ relation: 'round_trip' })
  assert.deepEqual(settleFinding(raw({ priorId: 'R1-1', votes: [roundTrip, roundTrip] })).conflict, { priorId: 'R1-1' })
  for (const severity of ['minor', 'nit']) assert.deepEqual(settleFinding(raw({ severity, priorId: 'R1-1', assigned: 0 })).conflict, { priorId: 'R1-1' })
  for (const severity of ['major', 'critical']) assert.equal(settleFinding(raw({ severity, priorId: 'R1-1', assigned: 0 })).conflict, undefined)
  for (const finding of [raw({ votes: [roundTrip, roundTrip] }), raw({ priorId: 'R1-1', votes: [roundTrip, yes({ relation: 'new_problem' })] }), raw({ priorId: 'R1-1', votes: [roundTrip, yes()] }), raw({ priorId: 'R1-1', votes: [no(), no()] })]) {
    assert.equal(Object.hasOwn(settleFinding(finding), 'conflict'), false)
  }
})

test('판정에 해당하는 사유를 보존하며 입력을 변경하지 않는다', () => {
  for (const [votes, reasons] of [[[yes(), yes()], ['결함을 확인했다.', '결함을 확인했다.']], [[no(), no()], ['결함이 아니다.', '결함이 아니다.']], [[yes(), no()], ['결함을 확인했다.', '결함이 아니다.']]]) {
    const finding = raw({ votes })
    const snapshot = structuredClone(finding)
    assert.deepEqual(settleFinding(finding).reasons, reasons)
    assert.deepEqual(finding, snapshot)
  }
})
