import { settleFinding } from '../engine/votes.mjs'
import { computeVerdict } from '../engine/verdict.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const sourcePath = new URL('../workflows/deep-review.js', import.meta.url)
const finding = (severity = 'major', line = 13) => ({ severity, loc: { path: 'a.js', side: 'new', line }, title: `문제 ${line}`, tldr: '조건에서 실패', good: '', fix: '고침' })
const vote = (verdict = 'confirmed') => ({ verdict, severity: 'major', reason: 'a.js:13 확인', fixSafe: true, relation: null })
const empty = () => ({ findings: [], walkthrough: '요약', praise: '' })
async function run({ findings = [], options = {}, responder, afterStart, clear = true } = {}) {
  const source = await readFile(sourcePath, 'utf8')
  const calls = [], logs = [], timers = []
  let clock = 0
  const context = {
    args: { root: '/target', base: 'abc123', files: [{ path: 'a.js', status: 'M', added: [13, 30], removed: [12], hunks: [] }], scopeText: 'a.js:13,30', priors: [], votes: { critical: 2, major: 2, minor: 0, nit: 0 }, verifyCap: 10, capSec: 300, tiebreakMinSec: 27, ...options },
    agent: async (prompt, config) => { calls.push({ prompt, ...config }); if (responder) return responder(prompt, config, calls); return config.label === 'review:correctness' ? { ...empty(), findings } : config.label.startsWith('review:') ? empty() : vote() },
    parallel: (jobs) => Promise.all(jobs.map(job => job())),
    pipeline: (items, review, verify) => Promise.all(items.map(async item => verify(await review(item), item))),
    log: text => logs.push(text), phase: () => {},
    setTimeout: (callback, delay) => { const timer = { callback, at: clock + delay, active: true }; timers.push(timer); return timer },
  }
  if (clear) context.clearTimeout = timer => { timer.active = false }
  const pending = vm.runInNewContext(`(async function(){${source.replace('export const meta', 'const meta')}\n})()`, context)
  const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve() }
  const advance = async ms => { clock += ms; for (const timer of timers.filter(t => t.active && t.at <= clock).sort((a,b) => a.at-b.at)) { timer.active = false; timer.callback() } await flush() }
  await flush()
  if (afterStart) await afterStart({ advance, calls })
  const result = JSON.parse(JSON.stringify(await pending))
  return { result, calls, logs, timers, source }
}

test('4개 차원과 plain meta, 위치 스키마, 범용 읽기 전용 프롬프트', async () => {
  const { result, calls, source, timers } = await run()
  assert.deepEqual(calls.map(c => c.label).sort(), ['review:architecture', 'review:correctness', 'review:security', 'review:test-coverage'])
  assert.equal(result.dimensions.length, 4)
  assert.match(source, /^export const meta = \{/)
  assert.doesNotMatch(source, /FinSight|RLS|Supabase|\bimport\b|\bprocess\b|\bDate\b/)
  for (const call of calls) {
    for (const text of ['/target', 'abc123', 'a.js:13,30', 'CLAUDE.md', 'AGENTS.md', '빌드·테스트를 실행하지 마라', '파일을 수정하지 마라', '원인', '변경 줄', 'untracked']) assert.ok(call.prompt.includes(text), text)
    const item = call.schema.properties.findings.items
    assert.ok(item.required.includes('loc'))
    assert.equal(item.properties.in_diff, undefined)
    assert.deepEqual(Array.from(item.properties.loc.properties.side.enum), ['new', 'old'])
  }
  const coverage = calls.find(c => c.label === 'review:test-coverage').prompt
  for (const text of ['src/main', 'src/test', 'test_x.py', 'tests/', '*.test.*', '__tests__/']) assert.ok(coverage.includes(text))
  assert.equal(timers.filter(t => t.active).length, 0)
})

test('빠른 모드 raw 표와 서로 다른 두 검증 관점', async () => {
  const { result, calls } = await run({ findings: [finding(), finding('minor', 30)] })
  const found = result.dimensions[0].findings
  assert.deepEqual(found.map(f => [f.assigned, f.votes.length]), [[2, 2], [0, 0]])
  assert.equal(found[0].severity, 'major')
  assert.equal(found[0].verification, undefined)
  const verifiers = calls.filter(c => c.label.startsWith('verify:'))
  assert.equal(verifiers.length, 2)
  assert.match(verifiers[0].prompt, /도달 가능성/)
  assert.match(verifiers[1].prompt, /이미 막혀 있는가/)
  for (const c of verifiers) {
    assert.match(c.prompt, /심각도 과장/)
    assert.match(c.prompt, /빌드·테스트를 실행하지 마라/)
    assert.match(c.prompt, /파일을 수정하지 마라/)
    assert.ok(c.schema.required.includes('fixSafe'))
  }
})

test('동점에만 세 번째 검증, 시간 부족이면 두 표 보존', async () => {
  for (const enough of [true, false]) {
    let resolveSecond
    const { result } = await run({ findings: [finding()], responder: (p, c) => c.label.startsWith('review:') ? c.label === 'review:correctness' ? { ...empty(), findings: [finding()] } : empty() : c.label.endsWith('.1') ? new Promise(resolve => { resolveSecond = resolve }) : vote(), afterStart: async ({ advance }) => { if (!enough) await advance(274000); resolveSecond(vote('refuted')) } })
    assert.equal(result.dimensions[0].findings[0].assigned, enough ? 3 : 2)
    assert.equal(result.tiebreaks, enough ? 1 : 0)
  }
})

test('검증 상한은 발견 수 기준이며 완료한 차원 안에서 심각도 순으로 할당', async () => {
  const { result, logs, calls } = await run({ findings: [finding('major', 30), finding('critical', 13), finding('major', 14)], options: { verifyCap: 2 } })
  assert.deepEqual(result.dimensions[0].findings.map(f => [f.severity, f.assigned]), [['critical', 2], ['major', 2], ['major', 0]])
  assert.equal(calls.filter(c => c.label.startsWith('verify:')).length, 4)
  assert.ok(logs.some(s => s.includes('검증 상한으로 1건 미검증')))
})

test('null 또는 예외 차원 실패를 반환', async () => {
  const { result } = await run({ responder: (p,c) => { if (c.label === 'review:correctness') return null; if(c.label === 'review:security') throw Error('실패'); return empty() } })
  assert.deepEqual(result.dimensions.map(d => d.failed), [true, true, false, false])
})

test('prior hunk 양쪽 범위와 relation required, 범위 밖 null', async () => {
  const prior = { id: 'R1-1', dimension: 'correctness', title: '이전', tldr: '이전 판단', hunk: { path: 'a.js', side: 'old', start: 12, end: 14, paired: { path: 'a.js', side: 'new', start: 12, end: 14 } } }
  const { result, calls } = await run({ findings: [finding(), finding('major', 30)], options: { priors: [prior] } })
  assert.deepEqual(result.dimensions[0].findings.map(f => f.priorId), ['R1-1', null])
  const verifiers = calls.filter(c => c.label.startsWith('verify:'))
  assert.match(verifiers[0].prompt, /이전 회차 판단: R1-1/)
  assert.ok(verifiers[0].schema.required.includes('relation'))
  assert.ok(!verifiers[2].schema.required.includes('relation'))
})

test('시간 상한은 미완료 reviewer 실패와 완료 발견 및 일부 표를 보존', async () => {
  const { result } = await run({ clear: false, responder: (p,c) => {
    if (c.label === 'review:correctness') return { ...empty(), findings: [finding()] }
    if (c.label === 'review:security' || c.label.endsWith('.1')) return new Promise(() => {})
    return c.label.startsWith('review:') ? empty() : vote()
  }, afterStart: async ({ advance }) => advance(300000) })
  assert.equal(result.cutoff, true)
  assert.equal(result.dimensions[1].failed, true)
  assert.equal(result.dimensions[0].failed, false)
  assert.equal(result.dimensions[0].findings[0].assigned, 2)
  assert.equal(result.dimensions[0].findings[0].votes.length, 1)
})

test('정밀 모드는 3/3/1/0, 전역 상한은 먼저 완료된 차원을 우선', async () => {
  const { result } = await run({ options: { votes: { critical: 3, major: 3, minor: 1, nit: 0 }, verifyCap: 2 }, responder: (p,c) => c.label.startsWith('review:') ? { ...empty(), findings: c.label === 'review:correctness' ? [finding('minor'), finding('nit', 30)] : c.label === 'review:security' ? [finding('major')] : c.label === 'review:architecture' ? [finding('critical')] : [] } : vote() })
  assert.deepEqual(result.dimensions.map(d => d.findings.map(f => f.assigned)), [[1,0],[3],[0],[]])
})

test('actual Workflow cap leaves major/critical active in verdict despite prior', async () => {
  for (const severity of ['major', 'critical']) {
    const prior = { id: 'R1-1', hunk: { path: 'a.js', side: 'new', start: 13, end: 30 } }
    const { result } = await run({ findings: [finding(severity, 13), finding(severity, 30)], options: { verifyCap: 1, priors: [prior] },
      responder: (p, c) => c.label.startsWith('review:') ? { ...empty(), findings: c.label === 'review:correctness' ? [finding(severity, 13), finding(severity, 30)] : [] } : vote('refuted') })
    const findings = result.dimensions.flatMap(d => d.findings).map(settleFinding)
    assert.equal(findings[1].verification, 'unverified')
    assert.equal(findings[1].conflict, undefined)
    assert.equal(computeVerdict({ findings, failedDims: [], indexOnly: [] }).verdict, severity === 'critical' ? 'Blocked' : 'Changes Requested')
  }
})

test('Workflow uses supplied valid prior and otherwise prepared order', async () => {
  const hunk = { path: 'a.js', side: 'new', start: 13, end: 30 }
  const priors = [{ id: 'adopted', hunk }, { id: 'older-valid', hunk }, { id: 'folded', hunk, authoritative: false }]
  const { result } = await run({ findings: [finding(), { ...finding('major', 30), priorId: 'older-valid' }], options: { priors } })
  assert.deepEqual(result.dimensions[0].findings.map(f => f.priorId), ['adopted', 'older-valid'])
})
