import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MODES, VERSION, SEVERITY_RANK } from '../engine/config.mjs'
import { git } from '../engine/git.mjs'

test('모드 값은 설계와 같다', () => {
  assert.deepEqual(MODES.fast, { capSec: 300, votes: { critical: 2, major: 2, minor: 0, nit: 0 } })
  assert.deepEqual(MODES.deep, { capSec: 480, votes: { critical: 3, major: 3, minor: 1, nit: 0 } })
})
test('VERSION 은 plugin.json 과 같다', () => assert.equal(VERSION, '0.1.0'))
test('SEVERITY_RANK 순서', () => assert.deepEqual(SEVERITY_RANK, { critical: 0, major: 1, minor: 2, nit: 3 }))
test('git 은 quotePath 를 끈다', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cr-git-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir })
    writeFileSync(path.join(dir, '한글.txt'), 'x\n')
    assert.equal(git(['ls-files', '--others'], dir).trim(), '한글.txt')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
test('allowFail 이면 실패 시 null, 아니면 던진다', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cr-git-'))
  try {
    assert.equal(git(['rev-parse', '--git-dir'], dir, { allowFail: true }), null)
    assert.throws(() => git(['rev-parse', '--git-dir'], dir))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
test('okCodes 에 든 종료 코드는 stdout 을 돌려준다', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cr-git-'))
  try {
    writeFileSync(path.join(dir, 'a.txt'), 'x\n')
    const args = ['diff', '--no-index', '--', '/dev/null', 'a.txt']
    assert.throws(() => git(args, dir))
    assert.equal(git(args, dir, { allowFail: true }), null)
    assert.match(git(args, dir, { okCodes: [1] }), /^diff --git a\/a\.txt b\/a\.txt/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
