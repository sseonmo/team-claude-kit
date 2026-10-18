import test from 'node:test'
import assert from 'node:assert/strict'
import { renderTerminal, buildPayload } from '../engine/render.mjs'

const finding = (id, extra = {}) => ({ id, severity: 'major', verification: 'confirmed', loc: { path: '한 글.js', side: 'new', line: 4 }, title: '소유권 확인', tldr: '다른 사용자 접근', good: '서명 확인', fix: 'checkOwner()', fixNote: '', reasons: [], ...extra })
const input = extra => ({ verdict: { verdict: 'Changes Requested', notes: [] }, findings: [finding('R2-1')], carried: [], conflicts: [], convergence: null, dropped: 0, notices: [], walkthrough: ['접근 경로 변경'], praise: ['작은 함수'], reusedFrom: null, ...extra })

test('터미널은 위치와 네 줄 코멘트, 등급 변경과 미검증 수정안을 보존한다', () => {
  const text = renderTerminal(input({ findings: [finding('R2-1'), finding('R2-2', { severity: 'minor', originalSeverity: 'major', fix: null, fixNote: '위험' }), finding('R2-3', { verification: 'unverified', fixNote: '미검증', loc: { path: '삭제.js', side: 'old', line: 2 } })] }))
  for (const part of ['한 글.js:4\n[major] R2-1 소유권 확인\nTL;DR   다른 사용자 접근\n✓ Good  서명 확인\n→ Fix   checkOwner()', '[minor ← major] R2-2', '[major · 미검증] R2-3', '삭제.js:2 (삭제된 줄)', '→ Fix (미검증)', '→ Fix   제안 없음 — 위험', '## walkthrough\n접근 경로 변경', '## 잘된 점\n작은 함수']) assert.ok(text.includes(part), part)
})

test('수렴, 재사용, 제외 수는 조건에 따라 표시한다', () => {
  const text = renderTerminal(input({ convergence: { resolved: 1, fresh: 2, conflicts: 1, skipped: 1, unchecked: 0 }, dropped: 3, reusedFrom: 3 }))
  assert.ok(text.startsWith('변경 없음 — R3 결과를 다시 보여줍니다'))
  assert.ok(text.includes('이전 회차 대비: 해결 1 · 새 문제 2 · 충돌 1 · 보류 1'))
  assert.ok(text.includes('범위 밖 3건 제외'))
  assert.ok(!text.includes('미확인'))
  const first = renderTerminal(input())
  assert.ok(!first.includes('이전 회차 대비:'))
  assert.ok(!first.includes('범위 밖'))
  assert.ok(renderTerminal(input({ convergence: { resolved: 0, fresh: 0, conflicts: 0, skipped: 0, unchecked: 2 } })).includes('미확인 2'))
})

test('충돌 비교, 보류 메모, 기각 근거는 요약 전용이며 수정안은 새지 않는다', () => {
  const data = input({ findings: [finding('R2-1', { conflict: { priorId: 'R1-3' } }), finding('R2-2', { folded: { byId: 'R1-2', memo: '다음 배포', reason: '보류' } }), finding('R2-3', { verification: 'refuted', fix: 'SECRET_FIX', reasons: ['이미 확인됨'] })], carried: [finding('R1-4', { folded: { byId: 'R1-4', memo: '유지' } })], conflicts: [{ newId: 'R2-1', priorId: 'R1-3', prior: finding('R1-3', { title: '이전 판단' }) }] })
  const text = renderTerminal(data)
  for (const part of ['## 판단 충돌', 'R1-3 (1회차)', '이전 판단', 'R2-1 (이번)', '--skip', '<details><summary>보류 2건</summary>', '[보류됨 · R1-2] 소유권 확인 — 다음 배포', '기각 근거: 이미 확인됨']) assert.ok(text.includes(part), part)
  assert.ok(!text.includes('SECRET_FIX'))
  assert.equal(buildPayload({ ...data, headRefOid: 'sha', inlineAllowed: true }).primary.comments.length, 0)
})

test('payload는 고정 커밋 COMMENT와 양쪽 위치를 쓰고 fallback은 모든 수정안을 담는다', () => {
  const data = input({ findings: [finding('R2-1'), finding('R2-2', { severity: 'minor', loc: { path: 'old.js', side: 'old', line: 8 }, fix: 'minorFix()' }), finding('R2-3', { severity: 'nit', in_diff: false, fix: 'nitFix()' })] })
  const { primary, fallback } = buildPayload({ ...data, headRefOid: 'abc', inlineAllowed: true })
  assert.equal(primary.event, 'COMMENT'); assert.equal(primary.commit_id, 'abc')
  assert.deepEqual(primary.comments.map(c => c.side), ['RIGHT', 'LEFT'])
  assert.ok(primary.body.includes('nitFix()'))
  assert.deepEqual(fallback.comments, [])
  for (const text of ['## 인라인 생략된 발견', 'checkOwner()', 'minorFix()', 'nitFix()']) assert.ok(fallback.body.includes(text))
  const disabled = buildPayload({ ...data, headRefOid: 'abc', inlineAllowed: false }).primary
  assert.deepEqual(disabled.comments, [])
  assert.ok(disabled.body.includes('⚠ 로컬과 PR head 가 달라 인라인을 생략했다'))
  assert.ok(disabled.body.includes('[minor] R2-2'))
})
