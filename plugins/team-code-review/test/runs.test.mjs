import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { RUNS_HEADER, formatRun, appendRun } from '../engine/runs.mjs'
import { commonDir } from '../engine/git.mjs'
import { makeRepo, removeRepo } from './helpers.mjs'

const row = { at: '2026-10-19', branch: 'main', mode: 'fast', files: 2, lines: 3, seconds: 4, cap_hit: false, unverified: 0, tiebreaks: 1, verdict: 'Approve' }
test('실행 기록 열과 순서는 고정된다', () => {
  assert.equal(RUNS_HEADER, 'at\tbranch\tmode\tfiles\tlines\tseconds\tcap_hit\tunverified\ttiebreaks\tverdict')
  assert.equal(formatRun(row), '2026-10-19\tmain\tfast\t2\t3\t4\tfalse\t0\t1\tApprove')
  assert.equal(formatRun({ ...row, branch: 'a\tb\nc\r' }).split('\t').length, 10)
  assert.equal(formatRun({ ...row, branch: 'a\tb\nc\r' }).includes('\n'), false)
})
test('공용 git 디렉터리에 헤더 한 번과 실행별 한 줄을 쓴다', t => {
  const root = makeRepo()
  t.after(() => removeRepo(root))
  appendRun(root, row)
  appendRun(root, { ...row, verdict: 'Blocked' })
  assert.equal(readFileSync(path.join(commonDir(root), 'deep-review/runs.tsv'), 'utf8'), RUNS_HEADER + '\n' + formatRun(row) + '\n' + formatRun({ ...row, verdict: 'Blocked' }) + '\n')
  assert.equal(existsSync(path.join(root, 'deep-review')), false)
})
