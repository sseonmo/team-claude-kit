// 원형: FinSight scripts/lighthouse/judge.test.mjs — 필드 이름만 일반화하고 같은 판정이 나와야 한다.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { guardDrops, decide, pickHypotheses, shouldStop, TSV_HEADER, parseHistory, formatRow, minGuard } from '../engine/judge.mjs'

const T = { minGain: 1, target: 90, stallRounds: 5, maxRounds: 20, candidates: 3 }
const HI = { thresholds: T, direction: 'higher' }
const unit = (id, score, guards = {}) => ({ id, score, guards: { a11y: 95, bp: 100, seo: 92, ...guards } })
const m = (score, units = [unit('/', score)], opportunities = []) => ({ score, units, opportunities })
const best = { commit: 'b0', measurement: m(60) }
const cand = (id, measurement, extra = {}) => ({
  id, hypothesis: 'audit-' + id, branch: 'perf/cand/' + id, description: id + ' 설명', status: 'measured', measurement, ...extra,
})

describe('guardDrops', () => {
  test('가드 중 하나라도 1 떨어지면 잡는다', () => {
    assert.deepEqual(guardDrops(m(60), m(70, [unit('/', 70, { seo: 91 })])), ['/:seo 92→91'])
  })

  test('score 하락은 가드가 아니다', () => {
    assert.deepEqual(guardDrops(m(60, [unit('/', 60)]), m(61, [unit('/', 50)])), [])
  })

  test('기준에 있던 단위가 빠지면 잡는다', () => {
    assert.deepEqual(guardDrops(m(60), m(70, [unit('/x', 70)])), ['/:missing'])
  })

  test('가드가 없는 측정기는 단위 존재만 본다', () => {
    const bare = (s) => ({ score: s, units: [{ id: 'GET /a', score: s, guards: {} }], opportunities: [] })
    assert.deepEqual(guardDrops(bare(100), bare(80)), [])
  })
})

describe('decide', () => {
  test('gate 후보는 측정값 없이 탈락하고, 다른 후보가 keep 돼도 outcompeted 로 바뀌지 않는다', () => {
    const r = decide(best, [
      cand('A', m(70)),
      { id: 'B', hypothesis: 'audit-B', branch: 'perf/cand/B', description: 'B 설명', status: 'gate', reason: 'mobile / 1.20%' },
    ], HI)
    assert.equal(r.winner, 'A')
    const b = r.results.find((x) => x.id === 'B')
    assert.deepEqual([b.status, b.score, b.reason], ['gate', null, 'mobile / 1.20%'])
  })

  test('+1.0 은 keep, +0.9 는 discard', () => {
    const r = decide(best, [cand('A', m(60.9)), cand('B', m(61))], HI)
    assert.equal(r.winner, 'B')
    assert.deepEqual(r.results.map((x) => x.status), ['discard', 'keep'])
    assert.match(r.results[0].reason, /\+0\.9/)
  })

  test('+0.95 는 반올림되어 keep 되지 않는다', () => {
    const r = decide(best, [cand('A', m(60.95))], HI)
    assert.equal(r.winner, null)
    assert.equal(r.results[0].status, 'discard')
    assert.match(r.results[0].reason, /\+0\.95/)
  })

  test('조건을 넘은 후보가 여럿이면 최고만 keep', () => {
    const r = decide(best, [cand('A', m(63)), cand('B', m(65)), cand('C', m(62))], HI)
    assert.equal(r.winner, 'B')
    assert.deepEqual(r.results.map((x) => x.status), ['outcompeted', 'keep', 'outcompeted'])
    assert.match(r.results[0].reason, /B/)
  })

  test('가드가 떨어지면 점수가 높아도 discard', () => {
    const r = decide(best, [cand('A', m(80, [unit('/', 80, { a11y: 94 })]))], HI)
    assert.equal(r.winner, null)
    assert.match(r.results[0].reason, /a11y 95→94/)
  })

  test('crash·scope·nochange 는 측정 없이 그대로 기록한다', () => {
    const r = decide(best, [
      cand('A', undefined, { status: 'crash', reason: 'build 실패' }),
      cand('B', undefined, { status: 'scope', reason: 'src/lib/a.ts' }),
      cand('C', undefined, { status: 'nochange', reason: '변경 없음' }),
    ], HI)
    assert.equal(r.winner, null)
    assert.deepEqual(r.results.map((x) => [x.status, x.score]), [['crash', null], ['scope', null], ['discard', null]])
  })

  test("direction 'lower' — 줄어든 만큼이 gain 이고 가장 낮은 후보가 이긴다", () => {
    const LO = { thresholds: { ...T, minGain: 5 }, direction: 'lower' }
    const b = { commit: 'b0', measurement: m(200) }
    const r = decide(b, [cand('A', m(196)), cand('B', m(180)), cand('C', m(190)), cand('D', m(230))], LO)
    assert.equal(r.winner, 'B')
    assert.deepEqual(r.results.map((x) => x.status), ['discard', 'keep', 'outcompeted', 'discard'])
    assert.match(r.results[0].reason, /\+4 < 5/)
    assert.match(r.results[3].reason, /-30/)
  })
})

describe('pickHypotheses', () => {
  const ops = [
    { id: 'a', savings: 100, units: ['/'] },
    { id: 'b', savings: 900, units: ['/'] },
    { id: 'c', savings: 500, units: ['/'] },
    { id: 'd', savings: 500, units: ['/'] },
  ]
  const row = (hypothesis, status) => ({ run: 1, round: 1, candidate: 'A', hypothesis, score: null, minGuard: null, status, commit: '', description: '' })

  test('gate 도 실패로 센다 — 화면을 두 번 깨뜨린 가설은 다시 고르지 않는다', () => {
    assert.deepEqual(pickHypotheses(ops, [row('b', 'gate'), row('b', 'gate')], 3).map((o) => o.id), ['c', 'd', 'a'])
  })

  test('절감 내림차순, 동률이면 id 순', () => {
    assert.deepEqual(pickHypotheses(ops, [], 3).map((o) => o.id), ['b', 'c', 'd'])
  })

  test('outcompeted 는 실패로 세지 않는다', () => {
    assert.deepEqual(pickHypotheses(ops, [row('b', 'outcompeted'), row('b', 'outcompeted')], 3).map((o) => o.id), ['b', 'c', 'd'])
  })

  test('keep 된 가설은 다시 고를 수 있고, 실패 2회면 제외', () => {
    const picked = pickHypotheses(ops, [row('b', 'keep'), row('c', 'discard'), row('d', 'crash'), row('d', 'scope')], 3)
    assert.deepEqual(picked.map((o) => o.id), ['b', 'c', 'a'])
  })

  test('개수는 인자를 따르고, 모자라면 있는 만큼만', () => {
    assert.deepEqual(pickHypotheses(ops, [], 2).map((o) => o.id), ['b', 'c'])
    assert.deepEqual(pickHypotheses([], [], 3), [])
  })
})

describe('shouldStop', () => {
  const r = (run, round, status) => ({ run, round, candidate: 'A', hypothesis: 'x', score: 1, minGuard: 1, status, commit: '', description: '' })

  test('목표에 닿으면 멈춘다', () => {
    assert.deepEqual(shouldStop(90, [], HI), { stop: true, reason: 'target' })
    assert.equal(shouldStop(89.9, [], HI).stop, false)
  })

  test("direction 'lower' 는 목표 이하에서 멈추고, target null 이면 목표로 멈추지 않는다", () => {
    const LO = { thresholds: { ...T, target: 100 }, direction: 'lower' }
    assert.equal(shouldStop(100, [], LO).reason, 'target')
    assert.equal(shouldStop(101, [], LO).stop, false)
    assert.equal(shouldStop(1e9, [], { thresholds: { ...T, target: null }, direction: 'higher' }).stop, false)
  })

  test('stallRounds 라운드 연속 keep 이 없으면 멈춘다 — 실행을 넘어 이어서 센다', () => {
    const h = [r(1, 0, 'baseline'), r(1, 1, 'keep'), r(1, 2, 'discard'), r(2, 0, 'baseline'), r(2, 1, 'discard'), r(2, 2, 'crash'), r(3, 1, 'discard')]
    assert.equal(shouldStop(60, h, HI).stop, false)
    assert.deepEqual(shouldStop(60, [...h, r(3, 2, 'discard')], HI), { stop: true, reason: 'stall' })
  })

  test('누적 maxRounds 면 멈춘다', () => {
    const h = Array.from({ length: 20 }, (_, i) => r(Math.floor(i / 2) + 1, (i % 2) + 1, 'keep'))
    assert.deepEqual(shouldStop(60, h, HI), { stop: true, reason: 'max-rounds' })
  })
})

describe('minGuard', () => {
  test('모든 단위·가드의 최솟값, 가드가 없으면 null', () => {
    assert.equal(minGuard(m(60, [unit('/', 60, { seo: 80 }), unit('/x', 60)])), 80)
    assert.equal(minGuard({ score: 1, units: [{ id: 'a', score: 1, guards: {} }], opportunities: [] }), null)
  })
})

describe('TSV', () => {
  const row = { run: 2, round: 1, candidate: 'B', hypothesis: 'unused-javascript', score: 63.25, minGuard: 88, status: 'keep', commit: 'abc1234', description: '탭\t과\n개행' }

  test('설명의 탭·개행은 공백으로 바뀌어 한 줄을 지킨다', () => {
    const line = formatRow(row)
    assert.equal(line.split('\t').length, TSV_HEADER.split('\t').length)
    assert.ok(!line.includes('\n'))
  })

  test('format → parse 왕복', () => {
    assert.deepEqual(parseHistory(TSV_HEADER + '\n' + formatRow(row) + '\n'), [{ ...row, description: '탭 과 개행' }])
  })

  test('측정 없는 줄은 score·minGuard 가 null', () => {
    const parsed = parseHistory(TSV_HEADER + '\n' + formatRow({ ...row, score: null, minGuard: null, status: 'crash' }))
    assert.equal(parsed[0].score, null)
    assert.equal(parsed[0].minGuard, null)
  })

  test('헤더는 일반화된 열 이름이다', () => {
    assert.equal(TSV_HEADER, 'run\tround\tcandidate\thypothesis\tscore\tminGuard\tstatus\tcommit\tdescription')
  })
})
