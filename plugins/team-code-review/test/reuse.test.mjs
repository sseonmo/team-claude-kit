import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { reuseKey, rulesText } from '../engine/reuse.mjs'
import { VERSION } from '../engine/config.mjs'
import { makeRepo, removeRepo } from './helpers.mjs'

test('재사용 키는 모든 입력과 필드 경계를 반영한다', () => {
  const input = { headSha: 'h', baseSha: 'b', diffText: 'd', untrackedText: 'u', stagedText: 's', mode: 'fast', rulesText: 'r', version: '1', dimensions: ['a', 'b'] }
  assert.match(reuseKey(input), /^[a-f0-9]{64}$/)
  assert.equal(reuseKey(input), reuseKey({ ...input }))
  for (const key of Object.keys(input)) assert.notEqual(reuseKey(input), reuseKey({ ...input, [key]: 'changed' }), key)
  assert.notEqual(reuseKey({ ...input, diffText: 'a\nb', untrackedText: 'c' }), reuseKey({ ...input, diffText: 'a', untrackedText: 'b\nc' }))
  const { version, ...withoutVersion } = input
  assert.notEqual(reuseKey(input), reuseKey({ ...input, dimensions: ['a'] }))
  assert.equal(reuseKey(withoutVersion), reuseKey({ ...input, version: VERSION }))
})

test('규칙은 변경 경로의 상위만 경로순으로 한 번 포함하고 경계를 보존한다', t => {
  const root = makeRepo()
  t.after(() => removeRepo(root))
  for (const [file, text] of Object.entries({ 'CLAUDE.md': 'root', 'src/CLAUDE.md': 'src', 'src/a/AGENTS.md': 'nested', 'other/CLAUDE.md': 'excluded' })) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), text)
  }
  const result = rulesText(root, [{ path: 'src/a/B.java' }, { path: 'src/a/C.java' }])
  const entries = JSON.parse(result)
  assert.deepEqual(entries, [['CLAUDE.md', 'root'], ['src/CLAUDE.md', 'src'], ['src/a/AGENTS.md', 'nested']])
  assert.equal(rulesText(root, []), JSON.stringify([['CLAUDE.md', 'root']]))
})

test('루트 밖 경로와 심볼릭 링크 규칙은 읽지 않는다', t => {
  const root = makeRepo(), outside = makeRepo()
  t.after(() => { removeRepo(root); removeRepo(outside) })
  writeFileSync(path.join(outside, 'CLAUDE.md'), 'secret')
  symlinkSync(outside, path.join(root, 'linked'))
  assert.equal(rulesText(root, [{ path: '../x/file' }, { path: path.join(outside, 'file') }, { path: 'linked/file' }]), '[]')
})
