import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, lstatSync, readlinkSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { git, repoRoot, commonDir } from './git.mjs'
import { MODES, VERIFY_CAP, TIEBREAK_MIN_SEC, SEVERITY_RANK } from './config.mjs'
import { collectTarget } from './target.mjs'
import { buildScope, scopeSummary, filterFindings } from './scope.mjs'
import { settleFinding } from './votes.mjs'
import { loadRecord, saveRecord, applySkip, recordPath } from './store.mjs'
import { makeAnchor, priorCandidates, attachPriors, applyHistory, convergence } from './match.mjs'
import { computeVerdict } from './verdict.mjs'
import { reuseKey, rulesText } from './reuse.mjs'
import { appendRun } from './runs.mjs'
import { renderTerminal, buildPayload } from './render.mjs'

const branchOf = root => git(['symbolic-ref', '--quiet', '--short', 'HEAD'], root, { okCodes: [1] }).trim() || null
const headOf = root => git(['rev-parse', '--verify', '--quiet', 'HEAD'], root, { allowFail: true })?.trim() || null
const directoryOf = root => path.join(commonDir(root), 'deep-review')
const pendingOf = root => path.join(directoryOf(root), '.pending.json')
const digest = value => createHash('sha256').update(value).digest('hex')
const TREE_CHANGED_NOTICE = '⚠ 리뷰 중 작업 트리가 바뀌었다 — 결과를 기록하지 않습니다.'

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${randomUUID()}`
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
    renameSync(temporary, file)
  } finally {
    try { unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

// status 이름이 그대로여도 untracked 내용과 index 내용이 달라질 수 있다.
function treeHash(root) {
  const untracked = git(['ls-files', '-z', '--others', '--exclude-standard'], root).split('\0').filter(Boolean)
    .map(name => {
      const file = path.join(root, name)
      return [name, digest(lstatSync(file).isSymbolicLink() ? readlinkSync(file) : readFileSync(file))]
    })
  const head = headOf(root)
  return digest(JSON.stringify([head, branchOf(root), git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], root),
    git(['diff', '--binary', ...(head ? [head] : [])], root), git(['diff', '--cached', '--binary'], root), untracked]))
}

function parse(args) {
  const [command, ...rest] = args
  const flags = {}, paths = []
  let positional = false
  for (let index = 0; index < rest.length; index++) {
    const token = rest[index]
    if (token === '--') { positional = true; continue }
    if (!positional && ['--fast', '--deep', '--pr', '--comment', '--fresh'].includes(token)) flags[token.slice(2)] = true
    else if (!positional && ['--result', '--head-ref-oid'].includes(token)) {
      const value = rest[++index]
      if (!value || value.startsWith('--')) throw new Error(`${token} 값이 필요합니다.`)
      flags[token.slice(2)] = value
    } else if (!positional && token.startsWith('--')) {
      if (token === '--skip' && command === 'prepare') return { command: 'skip', paths: rest.slice(index + 1), flags: {} }
      throw new Error(`알 수 없는 인수: ${token}`)
    } else paths.push(token)
  }
  if (!['prepare', 'settle', 'skip'].includes(command)) throw new Error('명령은 prepare, settle, skip 중 하나여야 합니다.')
  if (flags.fast && flags.deep) throw new Error('--fast 와 --deep 은 함께 사용할 수 없습니다.')
  return { command, flags, paths }
}

function prInfo(root, flags) {
  if (!flags.pr && !flags.comment) return { pr: null, notices: [] }
  try {
    const pr = JSON.parse(execFileSync('gh', ['pr', 'view', '--json', 'number,baseRefOid,headRefOid'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
    if (!pr.baseRefOid || !pr.headRefOid) throw new Error('PR 정보 없음')
    return { pr, notices: [] }
  } catch {
    return { pr: null, notices: ['연결된 PR 이 없거나 조회할 수 없어 로컬 리뷰 결과만 표시합니다.'] }
  }
}

function normalizePaths(root, cwd, tokens) {
  return tokens.map(token => {
    const relative = path.relative(root, path.resolve(cwd, token))
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`저장소 밖 경로는 리뷰할 수 없습니다: ${token}`)
    return relative.split(path.sep).join('/') || '.'
  })
}

// rename 은 scope 의 canonical 새 경로를 base 의 이전 경로로 바꾸어 읽는다.
function lineReader(root, target) {
  return (name, side) => {
    let source
    if (side === 'old') {
      const file = target.files.find(file => (file.status === 'D' ? file.oldPath : file.path) === name)
      source = git(['show', `${target.baseSha}:${file?.oldPath ?? name}`], root, { allowFail: true }) ?? ''
    } else {
      try { source = readFileSync(path.join(root, name), 'utf8') } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
        source = ''
      }
    }
    return source.split('\n')
  }
}

function renderReview(root, record, target, data, findings, candidates, readLines, notices, reusedFrom = null, treeChanged = false) {
  const history = applyHistory(structuredClone(findings), record, candidates, readLines)
  const all = [...history.findings, ...history.carried]
  const verdict = computeVerdict({ findings: all, failedDims: data.failedDims, indexOnly: target.indexOnly })
  const previous = new Map(record.rounds.flatMap(round => round.findings).map(finding => [finding.id, finding]))
  const conflicts = history.conflicts.map(pair => ({ ...pair, prior: previous.get(pair.priorId) }))
  const input = { verdict, findings: history.findings, carried: history.carried, conflicts,
    convergence: record.rounds.length ? convergence(record, all, data.failedDims, candidates) : null,
    dropped: data.dropped, walkthrough: data.walkthrough, praise: data.praise,
    notices: treeChanged ? [TREE_CHANGED_NOTICE, ...notices] : notices, reusedFrom, treeChanged }
  // 터미널은 경고를 맨 위로 올리고 payload 는 같은 경고를 본문 안내로 보존한다.
  const rendered = treeChanged ? `${TREE_CHANGED_NOTICE}\n${renderTerminal({ ...input, notices })}` : renderTerminal(input)
  return { history, verdict, input, rendered }
}

function payloadFiles(root, flags, pr, input, headRefOid) {
  if (!flags.comment || !pr) return {}
  const oid = headRefOid ?? pr.headRefOid
  const inlineAllowed = !input.treeChanged && oid === headOf(root) && git(['status', '--porcelain'], root).trim() === ''
  const payload = buildPayload({ ...input, headRefOid: oid, inlineAllowed })
  const payloadPath = path.join(directoryOf(root), 'payload.json')
  const fallbackPath = path.join(directoryOf(root), 'payload-fallback.json')
  writeJson(payloadPath, payload.primary)
  writeJson(fallbackPath, payload.fallback)
  return { payloadPath, fallbackPath }
}

function prepare(root, cwd, flags, tokens) {
  const paths = normalizePaths(root, cwd, tokens)
  const { pr, notices } = prInfo(root, flags)
  const target = collectTarget(root, { ...flags, pr: Boolean(pr), comment: Boolean(pr && flags.comment), prBaseOid: pr?.baseRefOid }, paths)
  const pendingPath = pendingOf(root)
  if (!target.files.length && !target.indexOnly.length) return { status: 'none', message: [...notices, '리뷰할 변경이 없습니다.'].join('\n'), pendingPath }
  const { record, notice } = loadRecord(root)
  notices.push(...target.warnings, ...(notice ? [notice] : []))
  const key = reuseKey({ ...target, mode: target.mode, rulesText: rulesText(root, target.files) })
  const scope = buildScope(target.files)
  const readLines = lineReader(root, target)
  const candidates = priorCandidates(record, scope, readLines)
  const previous = record.rounds.at(-1)
  if (!flags.fresh && previous?.reuseKey === key && Array.isArray(previous.result?.findings)) {
    const review = renderReview(root, record, target, previous.result, previous.result.findings, candidates, readLines, notices, previous.n)
    // skip snapshot 의 초기화·해제만 기록한다. 회차와 runs 는 추가하지 않는다.
    saveRecord(root, record)
    return { status: 'reuse', message: `R${previous.n} 결과를 재사용합니다.`, pendingPath,
      reuse: { rendered: review.rendered, ...payloadFiles(root, flags, pr, review.input) } }
  }
  const workflowArgs = { root, mode: target.mode, base: target.baseSha, files: target.files, scopeText: scopeSummary(scope),
    priors: candidates.filter(candidate => candidate.authoritative !== false).map(({ prior, loc, hunk }) => ({ id: prior.id, dimension: prior.dimension, title: prior.title, tldr: prior.tldr, loc, hunk })),
    votes: MODES[target.mode].votes, verifyCap: VERIFY_CAP[target.mode], tiebreakMinSec: TIEBREAK_MIN_SEC, capSec: MODES[target.mode].capSec }
  writeJson(pendingPath, { root, branch: branchOf(root), startedAt: new Date().toISOString(), treeHash: treeHash(root), target, paths, flags, pr, notices, reuseKey: key })
  return { status: 'run', message: [...notices, `${target.files.length}개 파일 리뷰를 시작합니다.`].join('\n'), workflowArgs, pendingPath }
}

function mergeDuplicates(findings) {
  const groups = new Map()
  for (const finding of findings) {
    const { path, side, line } = finding.loc
    const key = JSON.stringify([path, side, line, finding.title])
    const group = groups.get(key) ?? []
    group.push(finding)
    groups.set(key, group)
  }
  return [...groups.values()].map(group => {
    const best = [...group].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0]
    const dimensions = [...new Set(group.map(finding => finding.dimension))]
    return { ...best, title: dimensions.length > 1 ? `${best.title} (${dimensions.join(' · ')})` : best.title }
  }).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || a.loc.path.localeCompare(b.loc.path) || a.loc.line - b.loc.line || a.title.localeCompare(b.title))
}

function settle(root, flags) {
  if (!flags.result) throw new Error('settle 에는 --result <WorkflowResult.json> 이 필요합니다.')
  let pending
  try { pending = JSON.parse(readFileSync(pendingOf(root), 'utf8')) } catch (error) {
    if (error.code === 'ENOENT') throw new Error('prepare 실행 기록이 없습니다. 먼저 prepare 를 실행하십시오.')
    throw error
  }
  if (pending.root !== root) throw new Error('prepare 를 실행한 저장소와 현재 저장소가 다릅니다.')
  const treeChanged = pending.treeHash !== treeHash(root)
  const result = JSON.parse(readFileSync(path.resolve(flags.result), 'utf8'))
  if (!Array.isArray(result.dimensions) || result.dimensions.some(dimension => typeof dimension.key !== 'string' || !Array.isArray(dimension.findings))) throw new Error('WorkflowResult dimensions 형식이 올바르지 않습니다.')
  const { target } = pending
  const scope = buildScope(target.files)
  const readLines = lineReader(root, target)
  const { record, notice } = loadRecord(root)
  const candidates = priorCandidates(record, scope, readLines)
  const raws = result.dimensions.flatMap(dimension => dimension.failed ? [] : dimension.findings)
  const { kept, dropped } = filterFindings(raws, scope)
  // workflow 의 priorId 도 현재 후보 hunk 로 다시 검증하여 외부 id 를 신뢰하지 않는다.
  const attached = attachPriors(kept, candidates, scope)
  const n = (record.rounds.at(-1)?.n ?? 0) + 1
  const findings = mergeDuplicates(attached.map(settleFinding)).map((finding, index) => {
    const lines = readLines(finding.loc.path, finding.loc.side)
    // 리뷰 중 삭제된 줄은 기록하지 않는 결과에서만 anchor 를 비워 둔다.
    const anchor = treeChanged && typeof lines[finding.loc.line - 1] !== 'string' ? null : makeAnchor(lines, finding.loc.line)
    return { ...finding, id: `R${n}-${index + 1}`, anchor }
  })
  const data = { findings, failedDims: result.dimensions.filter(dimension => dimension.failed).map(dimension => dimension.key),
    dropped, walkthrough: result.dimensions.map(dimension => dimension.walkthrough).filter(Boolean), praise: result.dimensions.map(dimension => dimension.praise).filter(Boolean),
    tiebreaks: result.tiebreaks ?? 0, cutoff: Boolean(result.cutoff) }
  const notices = [...pending.notices, ...(notice ? [notice] : [])]
  const detached = recordPath(root) === null
  if (detached) notices.push('detached HEAD 이므로 회차 기록과 실행 기록을 저장하지 않습니다.')
  const review = renderReview(root, record, target, data, findings, candidates, readLines, notices, null, treeChanged)
  const rendered = review.rendered
  const paths = payloadFiles(root, pending.flags, pending.pr, review.input, flags['head-ref-oid'])
  if (!treeChanged && !detached) {
    record.rounds.push({ n, at: new Date().toISOString(), mode: target.mode, baseSha: target.baseSha, headSha: target.headSha,
      reuseKey: pending.reuseKey, result: data, findings: [...review.history.findings, ...review.history.carried], conflicts: review.history.conflicts })
    saveRecord(root, record)
    appendRun(root, { at: new Date().toISOString(), branch: pending.branch, mode: target.mode, files: target.files.length, lines: target.changedLines,
      seconds: Math.max(0, Math.round((Date.now() - Date.parse(pending.startedAt)) / 1000)), cap_hit: result.cutoff ? 1 : 0,
      unverified: [...review.history.findings, ...review.history.carried].filter(finding => finding.verification === 'unverified').length,
      tiebreaks: result.tiebreaks ?? 0, verdict: review.verdict.verdict })
  }
  unlinkSync(pendingOf(root))
  return { rendered, verdict: review.verdict.verdict, ...paths, treeChanged }
}

function skip(root, args) {
  if (!args[0]) throw new Error('skip 할 발견 id 가 필요합니다.')
  const { record, notice } = loadRecord(root)
  const result = applySkip(record, args[0], args.length > 1 ? args.slice(1).join(' ') : null)
  if (result.ok) saveRecord(root, record)
  return { ok: result.ok, message: [notice, result.ok ? `${args[0]} ${result.title} 을 보류했습니다.` : `유효한 id: ${result.validIds.join(', ') || '없음'}`].filter(Boolean).join('\n') }
}

try {
  const { command, flags, paths } = parse(process.argv.slice(2))
  const cwd = process.cwd()
  const root = repoRoot(cwd)
  const result = command === 'prepare' ? prepare(root, cwd, flags, paths) : command === 'settle' ? settle(root, flags) : skip(root, paths)
  process.stdout.write(JSON.stringify(result) + '\n')
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, message: `리뷰 명령 실패: ${error.message}` }) + '\n')
  process.exitCode = 1
}
