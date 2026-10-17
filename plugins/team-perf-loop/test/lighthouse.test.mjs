// 원형: FinSight scripts/lighthouse/measure.test.mjs 의 summarizeLhr·aggregate.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { median, summarizeLhr, aggregate, direction, landedElsewhere } from '../measurers/lighthouse.mjs'

const lhr = (perf, extraAudits = {}) => ({
  categories: {
    performance: { score: perf, auditRefs: Object.keys(extraAudits).map((id) => ({ id })) },
    accessibility: { score: 0.95 },
    'best-practices': { score: 1 },
    seo: { score: 0.92 },
  },
  audits: extraAudits,
})

test('점수는 높을수록 좋다', () => assert.equal(direction, 'higher'))

describe('median', () => {
  test('홀수·짝수', () => {
    assert.equal(median([3, 1, 2]), 2)
    assert.equal(median([4, 1, 3, 2]), 2.5)
  })
})

describe('summarizeLhr', () => {
  test('점수를 0~100 정수로 바꾸고 절감 효과가 있는 audit 만 진단으로 뽑는다', () => {
    const s = summarizeLhr(lhr(0.634, {
      'render-blocking-insight': { score: 0, metricSavings: { FCP: 300, LCP: 450 } },
      'unused-javascript': { score: 0.5, metricSavings: { LCP: 200, CLS: 0.1 } },
      'already-good': { score: 1, metricSavings: { LCP: 0 } },
      informative: { score: null, metricSavings: { LCP: 999 } },
    }))
    assert.deepEqual(s, {
      perf: 63, a11y: 95, bp: 100, seo: 92,
      opportunities: [
        { id: 'render-blocking-insight', savings: 750 },
        { id: 'unused-javascript', savings: 200 },
      ],
    })
  })

  test('runtimeError 나 null 점수는 0점이 아니라 오류다', () => {
    assert.throws(() => summarizeLhr({ ...lhr(0.5), runtimeError: { code: 'NO_FCP', message: 'x' } }), /NO_FCP/)
    assert.throws(() => summarizeLhr(lhr(null)), /performance/)
  })
})

describe('aggregate', () => {
  test('페이지별 중앙값, 평균은 소수 둘째 자리, 진단은 페이지를 넘어 합산', () => {
    const run = (perf, ops = []) => ({ perf, a11y: 95, bp: 100, seo: 92, opportunities: ops })
    const result = aggregate([
      { path: '/', runs: [run(70, [{ id: 'x', savings: 100 }]), run(72), run(71)] },
      { path: '/dashboard', runs: [run(50, [{ id: 'x', savings: 300 }]), run(51), run(49, [{ id: 'y', savings: 50 }])] },
    ])
    assert.equal(result.score, 60.5)
    assert.deepEqual(result.units, [
      { id: '/', score: 71, guards: { a11y: 95, bp: 100, seo: 92 } },
      { id: '/dashboard', score: 50, guards: { a11y: 95, bp: 100, seo: 92 } },
    ])
    assert.deepEqual(result.opportunities, [
      { id: 'x', savings: 133, units: ['/', '/dashboard'] },
      { id: 'y', savings: 17, units: ['/dashboard'] },
    ])
  })
})

describe('landedElsewhere — 측정한 페이지가 요청한 페이지인가', () => {
  const at = (requested, final) => ({ requestedUrl: requested, finalDisplayedUrl: final })

  test('같은 경로면 null', () => {
    assert.equal(landedElsewhere(at('http://localhost:3200/dashboard', 'http://localhost:3200/dashboard'), '/dashboard'), null)
  })

  test('로그인으로 리다이렉트됐으면 최종 경로 — 로그인 페이지의 100점을 대시보드 점수로 기록하지 않는다', () => {
    assert.equal(landedElsewhere(at('http://localhost:3200/dashboard', 'http://localhost:3200/login'), '/dashboard'), '/login')
  })

  test('쿼리스트링까지 비교한다', () => {
    assert.equal(landedElsewhere(at('http://h/items?page=2', 'http://h/items?page=2'), '/items?page=2'), null)
    assert.equal(landedElsewhere(at('http://h/items?page=2', 'http://h/items'), '/items?page=2'), '/items')
  })

  test('해시만 다르면 같은 페이지', () => {
    assert.equal(landedElsewhere(at('http://h/a', 'http://h/a#top'), '/a'), null)
  })
})
