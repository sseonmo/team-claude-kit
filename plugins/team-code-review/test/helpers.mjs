import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const run = (args, cwd) => execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd, encoding: 'utf8' })

// 임시 git 저장소를 만든다. 어느 머신에서든 커밋되도록 로컬 user 를 설정한다.
export function makeRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'cr-repo-'))
  run(['init', '-q', '-b', 'main'], dir)
  run(['config', 'user.name', 'tester'], dir)
  run(['config', 'user.email', 'tester@example.com'], dir)
  run(['config', 'commit.gpgsign', 'false'], dir)
  return dir
}

export function removeRepo(dir) { rmSync(dir, { recursive: true, force: true }) }

// files: { 경로: 내용 | null }. null 은 삭제. 전부 add -A 로 커밋하고 sha 를 돌려준다.
export function commit(dir, files, msg) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    if (content === null) { rmSync(abs, { force: true }); continue }
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  run(['add', '-A'], dir)
  run(['commit', '-q', '-m', msg], dir)
  return run(['rev-parse', 'HEAD'], dir).trim()
}
