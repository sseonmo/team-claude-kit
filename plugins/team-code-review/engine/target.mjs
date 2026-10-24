import { git, gitOk } from './git.mjs'
import { parseDiff, untrackedDiff, isLockfile, isTestPath } from './diff.mjs'
import { LARGE_DIFF_LINES } from './config.mjs'

// 커밋이 하나도 없는 저장소의 기준 — 빈 트리 (git hash-object -t tree /dev/null)
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

const verifies = (root, ref) => gitOk(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], root)

// 기본 브랜치 이름. origin/HEAD → main → master 순으로 찾고 없으면 null. (main 을 박지 않는다)
export function defaultBranch(root) {
  const head = git(['symbolic-ref', 'refs/remotes/origin/HEAD'], root, { allowFail: true })
  if (head) return head.trim().replace(/^refs\/remotes\/origin\//, '')
  for (const name of ['main', 'master']) {
    if (verifies(root, name) || verifies(root, `origin/${name}`)) return name
  }
  return null
}

// 순수 함수 — 표(설계 §1)대로 대상과 모드를 정한다.
// 표에 없는 상태(깨끗한데 upstream 도 기본 브랜치도 없음)는 'none'.
export function selectTarget({ dirty, upstream, ahead, defaultBase, prBaseOid, flags = {} }) {
  const pick = (kind, baseRef, defMode) => ({ kind, baseRef, mode: flags.deep ? 'deep' : flags.fast ? 'fast' : defMode })
  if (flags.pr || flags.comment) return pick('pr', prBaseOid ?? null, 'deep')
  if (dirty) return pick('uncommitted', null, 'fast')
  if (upstream) return ahead > 0 ? pick('push', upstream, 'fast') : pick('none', null, 'fast')
  if (defaultBase) return pick('branch', defaultBase, 'fast')
  return pick('none', null, 'fast')
}

// staged added 와 unstaged removed 는 index 좌표, staged removed 와
// HEAD→worktree removed 는 HEAD 좌표다. 파일 전체의 같은 텍스트는 취소 근거가 아니다.
export function indexOnlyChanges(stagedDiff, unstagedDiff, headWorktreeDiff) {
  const unstaged = new Map(unstagedDiff.map(file => [file.oldPath, file]))
  const working = new Map(headWorktreeDiff.map(file => [file.oldPath, file]))
  return stagedDiff.filter(staged => {
    const removedFromIndex = new Set(unstaged.get(staged.path)?.removed ?? [])
    const removedFromHead = new Set(working.get(staged.oldPath)?.removed ?? [])
    return staged.added.some(line => removedFromIndex.has(line))
      || staged.removed.some(line => !removedFromHead.has(line))
  }).map(file => file.path)
}

// 대상을 모아 기준 커밋·diff·변경 줄 수·경고를 돌려준다. gh·fetch 는 부르지 않는다 (prBaseOid 는 호출자가 준다).
export function collectTarget(root, flags = {}, paths = []) {
  const spec = paths.length ? ['--', ...paths] : []
  const headSha = git(['rev-parse', '--verify', '--quiet', 'HEAD'], root, { allowFail: true })?.trim() || null
  const upstream = git(['rev-parse', '--abbrev-ref', '@{upstream}'], root, { allowFail: true })?.trim() || null
  const ahead = upstream ? Number(git(['rev-list', '--count', '@{upstream}..HEAD'], root).trim()) : 0
  const def = defaultBranch(root)
  const defaultBase = def ? (verifies(root, `origin/${def}`) ? `origin/${def}` : verifies(root, def) ? def : null) : null
  const dirty = git(['status', '--porcelain'], root).trim() !== ''

  const { kind, mode, baseRef } = selectTarget({ dirty, upstream, ahead, defaultBase, prBaseOid: flags.prBaseOid ?? null, flags })

  let baseSha
  if (kind === 'uncommitted') baseSha = headSha ?? EMPTY_TREE
  else if (kind === 'push' || kind === 'branch') baseSha = git(['merge-base', baseRef, 'HEAD'], root).trim()
  else if (kind === 'pr') {
    if (!baseRef) throw new Error('PR base 를 알 수 없다 — gh pr view --json baseRefOid 결과를 prBaseOid 로 넘겨라')
    if (!verifies(root, baseRef)) throw new Error(`PR base ${baseRef} 가 로컬에 없다 — git fetch origin <base> 후 다시 실행`)
    baseSha = headSha ? git(['merge-base', baseRef, 'HEAD'], root).trim() : baseRef
  } else baseSha = headSha ?? EMPTY_TREE

  if (kind === 'none') {
    return { kind, mode, baseSha, headSha, files: [], diffText: '', untrackedText: '', stagedText: '', changedLines: 0, sourceLines: 0, sourceFiles: 0, indexOnly: [], warnings: [] }
  }

  const diffText = git(['diff', baseSha, ...spec], root)
  const stagedText = git(['diff', '--cached', ...spec], root)
  const untrackedPaths = git(['ls-files', '-z', '--others', '--exclude-standard', ...spec], root).split('\0').filter(Boolean)
  const untrackedText = untrackedPaths
    .map(p => git(['diff', '--no-index', '--', '/dev/null', p], root, { okCodes: [1] }) ?? '')
    .join('')

  // 바이너리는 리뷰 범위에서 뺀다
  const files = [...parseDiff(diffText), ...untrackedDiff(root, untrackedPaths)].filter(f => f.status !== 'B')
  // PR/push base 와 무관하게 staged 삭제의 HEAD 좌표를 비교한다.
  const headWorktreeText = baseSha === (headSha ?? EMPTY_TREE) ? diffText : git(['diff', headSha ?? EMPTY_TREE, ...spec], root)
  const indexOnly = indexOnlyChanges(parseDiff(stagedText), parseDiff(git(['diff', ...spec], root)), parseDiff(headWorktreeText))

  // lockfile 은 줄 수 집계에서 뺀다 — 매번 경고가 뜨면 경고가 무시된다
  const changedLines = files.filter(f => !isLockfile(f.path)).reduce((n, f) => n + f.added.length + f.removed.length, 0)
  // 작은 변경 판정용: lockfile 에 더해 테스트 파일도 뺀 줄·파일 수
  const sources = files.filter(f => !isLockfile(f.path) && !isTestPath(f.path))
  const sourceLines = sources.reduce((n, f) => n + f.added.length + f.removed.length, 0)
  const warnings = changedLines > LARGE_DIFF_LINES
    ? [`변경 ${changedLines}줄 — 5분 안에 끝나지 않을 수 있다. 경로 인수로 나눠 리뷰하라(예: /deep-review src/order/)`]
    : []

  return { kind, mode, baseSha, headSha, files, diffText, untrackedText, stagedText, changedLines, sourceLines, sourceFiles: sources.length, indexOnly, warnings }
}
