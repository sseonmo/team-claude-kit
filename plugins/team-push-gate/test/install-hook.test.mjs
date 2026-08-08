import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const INSTALL = join(HERE, '..', 'scripts', 'install-hook.sh')
const SRC = join(HERE, '..', 'templates', 'pre-push')
const MARKER = '# managed by team-push-gate'

function sh(cmd, cwd) {
  return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf8' })
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'installgate-'))
  sh('git init -q .', dir)
  return dir
}

function run(dir, args = []) {
  const r = spawnSync(INSTALL, args, { cwd: dir, encoding: 'utf8' })
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}

const DEST = (dir) => join(dir, '.git', 'hooks', 'pre-push')

test('대상이 없으면 설치하고 실행권한을 붙인다', () => {
  const dir = makeRepo()

  const r = run(dir)

  assert.equal(r.code, 0)
  assert.equal(readFileSync(DEST(dir), 'utf8'), readFileSync(SRC, 'utf8'))
  assert.ok(statSync(DEST(dir)).mode & 0o111, '실행권한이 있어야 한다')
})

test('마커 없는 기존 훅은 덮지 않는다', () => {
  const dir = makeRepo()
  const mine = '#!/bin/sh\necho 내 훅\n'
  writeFileSync(DEST(dir), mine)

  const r = run(dir)

  assert.equal(r.code, 1)
  assert.equal(readFileSync(DEST(dir), 'utf8'), mine, '남의 훅이 그대로 있어야 한다')
})

test('이미 같은 내용이면 아무것도 하지 않는다', () => {
  const dir = makeRepo()
  run(dir)
  const before = statSync(DEST(dir)).mtimeMs

  const r = run(dir)

  assert.equal(r.code, 0)
  assert.match(r.out, /이미 최신/)
  assert.equal(statSync(DEST(dir)).mtimeMs, before, '파일을 다시 쓰면 안 된다')
})

test('내용이 다르면 --force 없이는 덮지 않는다', () => {
  const dir = makeRepo()
  run(dir)
  const stale = `${MARKER}\n#!/bin/sh\necho 옛날 버전\n`
  writeFileSync(DEST(dir), stale)

  const r = run(dir)

  assert.equal(r.code, 2)
  assert.equal(readFileSync(DEST(dir), 'utf8'), stale, '덮이면 안 된다')
})

test('--force 면 덮는다', () => {
  const dir = makeRepo()
  run(dir)
  writeFileSync(DEST(dir), `${MARKER}\n#!/bin/sh\necho 옛날 버전\n`)

  const r = run(dir, ['--force'])

  assert.equal(r.code, 0)
  assert.equal(readFileSync(DEST(dir), 'utf8'), readFileSync(SRC, 'utf8'))
})

test('core.hooksPath 가 설정돼 있으면 경고한다', () => {
  const dir = makeRepo()
  sh('git config core.hooksPath .husky/_', dir)

  const r = run(dir)

  assert.equal(r.code, 0, '설치 자체는 된다')
  assert.match(r.out, /core\.hooksPath/)
  assert.match(r.out, /실행되지 않습니다/)
})

test('git 저장소가 아니면 중단한다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'notrepo-'))

  const r = run(dir)

  assert.equal(r.code, 1)
  assert.equal(existsSync(join(dir, '.git')), false)
})

test('worktree 에서는 공통 hooks 디렉토리에 설치한다', () => {
  // git 은 worktree 안에서도 훅을 공통 디렉토리(.git/hooks)에서 찾는다.
  // --git-dir 은 .git/worktrees/<name> 을 가리키므로, 거기 설치하면 아무도 부르지 않는다.
  const main = makeRepo()
  sh('git config user.email t@t', main)
  sh('git config user.name t', main)
  writeFileSync(join(main, 'f.txt'), 'x\n')
  sh('git add -A', main)
  sh('git commit -q -m base', main)
  const wt = join(main, '..', `wt-${Date.now()}`)
  sh(`git worktree add -q ${JSON.stringify(wt)} -b wtb`, main)

  const r = run(wt)

  assert.equal(r.code, 0)
  assert.ok(existsSync(join(main, '.git', 'hooks', 'pre-push')), '공통 자리에 있어야 한다')
  assert.equal(
    existsSync(join(main, '.git', 'worktrees', 'wtb', 'hooks', 'pre-push')),
    false,
    'worktree 전용 자리에 설치하면 git 이 부르지 않는다',
  )
})
