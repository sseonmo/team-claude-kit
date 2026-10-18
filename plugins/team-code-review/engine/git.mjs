import { execFileSync } from 'node:child_process'
import path from 'node:path'

// 모든 git 호출은 quotePath 를 꺼서 한글·공백 경로를 그대로 받는다.
// allowFail 이면 실패 시 null, 아니면 예외를 던진다.
// okCodes 에 든 종료 코드는 성공으로 보고 stdout 을 돌려준다 (예: git diff --no-index 는 차이가 있으면 1).
export function git(args, cwd, opts = {}) {
  try {
    return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      input: opts.input,
      stdio: ['pipe', 'pipe', opts.allowFail ? 'ignore' : 'pipe'],
    })
  } catch (e) {
    if (opts.okCodes?.includes(e.status)) return e.stdout
    if (opts.allowFail) return null
    throw e
  }
}

export function gitOk(args, cwd) {
  return git(args, cwd, { allowFail: true }) !== null
}

export function repoRoot(cwd) {
  return git(['rev-parse', '--show-toplevel'], cwd).trim()
}

// --git-common-dir 은 상대 경로로 나올 수 있어 루트 기준 절대 경로로 바꾼다 (worktree 에서도 공용 .git)
export function commonDir(root) {
  return path.resolve(root, git(['rev-parse', '--git-common-dir'], root).trim())
}
