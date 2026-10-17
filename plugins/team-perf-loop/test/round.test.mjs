// round 의 순수 헬퍼. git·측정을 실제로 엮는 부분은 FinSight 회귀와 Spring 샘플 E2E 로 확인한다.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyCandidate, encodeCandidates, decodeCandidates, gateReason, missingRef, zonedDate, gateResult, nextRun, dirtyLines,
} from '../engine/round.mjs'

const scope = { allow: ['src/components/**', 'next.config.ts'], deny: [] }

describe('classifyCandidate', () => {
  test('브랜치가 없으면 crash — 후보 에이전트가 커밋하지 못했다', () => {
    assert.deepEqual(classifyCandidate({ exists: false }, scope), { status: 'crash', reason: '브랜치 없음' })
  })

  test('현재 최고 커밋에서 갈라지지 않았으면 scope', () => {
    assert.equal(classifyCandidate({ exists: true, isDescendant: false, changed: ['src/components/A.tsx'] }, scope).status, 'scope')
  })

  test('변경이 없으면 nochange', () => {
    assert.equal(classifyCandidate({ exists: true, isDescendant: true, changed: [] }, scope).status, 'nochange')
  })

  test('허용 밖을 건드리면 scope 와 위반 경로', () => {
    assert.deepEqual(
      classifyCandidate({ exists: true, isDescendant: true, changed: ['src/components/A.tsx', 'src/lib/x.ts'] }, scope),
      { status: 'scope', reason: 'src/lib/x.ts' },
    )
  })

  test('허용 경로만이면 측정한다', () => {
    assert.equal(classifyCandidate({ exists: true, isDescendant: true, changed: ['next.config.ts'] }, scope).status, 'measure')
  })
})

describe('encode/decodeCandidates', () => {
  test('따옴표·괄호·느낌표·한글이 있어도 셸 안전 문자만 남고 왕복된다', () => {
    const list = [{ id: 'A', hypothesis: 'unused-javascript', branch: 'perf/cand/run1-r1-a', description: `"it's" (lazy)! 지연 로딩*` }]
    const enc = encodeCandidates(list)
    assert.match(enc, /^[A-Za-z0-9\-_.~%]+$/)
    assert.deepEqual(decodeCandidates(enc), list)
  })
})

describe('gateReason', () => {
  test('3개 이하면 그대로', () => {
    assert.equal(gateReason(['mobile / 1.00%', 'desktop / 2.00%']), 'gate mobile / 1.00%, desktop / 2.00%')
  })

  test('많으면 앞 3개와 남은 개수만 — results.tsv 한 칸이 수천 자가 되지 않게', () => {
    const diffs = Array.from({ length: 22 }, (_, i) => `s${i} 1.00%`)
    assert.equal(gateReason(diffs), 'gate s0 1.00%, s1 1.00%, s2 1.00% 외 19장')
  })
})

describe('missingRef', () => {
  test('관문이 없으면 기준 이미지를 보지 않는다', () => {
    assert.equal(missingRef({ commit: 'c' }, () => false, false), null)
  })

  test('관문이 있는데 refDir 이 없으면 baseline 부터', () => {
    assert.match(missingRef({ commit: 'c' }, () => true, true), /baseline/)
  })

  test('디렉터리가 지워졌으면 이유를 돌려준다', () => {
    assert.match(missingRef({ refDir: 'x' }, () => false, true), /x/)
  })

  test('있으면 null', () => {
    assert.equal(missingRef({ refDir: 'x' }, () => true, true), null)
  })
})

describe('zonedDate', () => {
  test('서울 — UTC 14:59:59 는 같은 날, 15:00 부터 다음 날', () => {
    assert.equal(zonedDate(new Date('2026-10-11T14:59:59Z'), 'Asia/Seoul'), '2026-10-11')
    assert.equal(zonedDate(new Date('2026-10-11T15:00:00Z'), 'Asia/Seoul'), '2026-10-12')
  })

  test('tz 가 없으면 null — 날짜 고정을 쓰지 않는 앱', () => {
    assert.equal(zonedDate(new Date(), null), null)
  })
})

describe('gateResult', () => {
  test('같으면 null — 측정으로 넘어간다', () => {
    assert.equal(gateResult({ ok: true, diffs: [] }, '2026-10-11', '2026-10-11'), null)
  })

  test('다르고 날짜가 같으면 gate', () => {
    assert.deepEqual(gateResult({ ok: false, diffs: ['mobile / 1.00%'] }, '2026-10-11', '2026-10-11'), { status: 'gate', reason: 'gate mobile / 1.00%' })
  })

  test('날짜 고정을 안 쓰면(null) 날짜를 보지 않는다', () => {
    assert.equal(gateResult({ ok: false, diffs: ['a'] }, null, null).status, 'gate')
  })

  test('촬영 도중 자정을 넘겨 달라졌으면 환경 오류로 던진다', () => {
    assert.throws(() => gateResult({ ok: false, diffs: ['x'] }, '2026-10-11', '2026-10-12'), /날짜/)
  })
})

describe('nextRun', () => {
  test('이력이 없으면 1', () => assert.equal(nextRun([]), 1))
  test('가장 큰 run + 1 — 순서와 무관', () => assert.equal(nextRun([{ run: 2 }, { run: 1 }, { run: 2 }]), 3))
})

describe('dirtyLines — 엔진 로컬 상태는 작업 트리 검사에서 뺀다', () => {
  test('.perf-loop/.local/ 아래 untracked 는 무시하고 나머지는 남긴다', () => {
    const out = '?? .perf-loop/.local/run-next-base.json.log\n M src/a.ts\n?? .perf-loop/results.tsv\n'
    assert.deepEqual(dirtyLines(out), [' M src/a.ts', '?? .perf-loop/results.tsv'])
  })

  test('빈 출력이면 깨끗하다', () => assert.deepEqual(dirtyLines(''), []))
})
