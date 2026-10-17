// 루프의 한 단계를 결정론적으로 수행한다. 벤치 worktree 를 cwd 로 실행한다.
//
//   node <플러그인>/engine/round.mjs baseline [--run N] --out .perf-loop/.local/run-next-base.json
//   node <플러그인>/engine/round.mjs evaluate --run N --round R --candidates <encoded> --out ...
//   node <플러그인>/engine/round.mjs wait --out ... [--max 540]
//   node <플러그인>/engine/round.mjs preview <dir>        # 기준 화면 미리보기 (사람 확인용)
//   node <플러그인>/engine/round.mjs measure              # 현재 체크아웃 단독 실측 (기록·커밋 없음)
//
// 측정 하나가 10분을 넘을 수 있어 에이전트는 nohup 으로 띄우고 wait 로 기다린다.
// 결과는 --out 에 원자적으로(임시 파일 → rename) 쓴다.

import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadConfig } from './config.mjs'
import { decide, formatRow, minGuard, parseHistory, pickHypotheses, shouldStop, TSV_HEADER } from './judge.mjs'
import { checkPaths } from './scope.mjs'
import { build, failedCheck, MeasureError, preflight, withServer } from './server.mjs'

const STATE = '.perf-loop'
const LOCAL = path.join(STATE, '.local')
const TSV = path.join(STATE, 'results.tsv')
const IGNORE = path.join(STATE, '.gitignore')
const BEST = path.join(LOCAL, 'best.json')
const VERSION = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version

export function classifyCandidate({ exists, isDescendant, changed }, scope) {
  if (!exists) return { status: 'crash', reason: '브랜치 없음' }
  if (!isDescendant) return { status: 'scope', reason: '현재 최고 커밋에서 갈라지지 않음' }
  if (changed.length === 0) return { status: 'nochange', reason: '변경 없음' }
  const { ok, violations } = checkPaths(changed, scope)
  if (!ok) return { status: 'scope', reason: violations.join(', ') }
  return { status: 'measure', reason: '' }
}

export function encodeCandidates(list) {
  return encodeURIComponent(JSON.stringify(list)).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

export function decodeCandidates(s) {
  return JSON.parse(decodeURIComponent(s))
}

// 사람이 회차를 기억하지 않게 이력에서 다음 번호를 정한다.
export function nextRun(history) {
  return Math.max(0, ...history.map((h) => h.run)) + 1
}

export function gateReason(diffs) {
  const head = diffs.slice(0, 3).join(', ')
  return `gate ${head}${diffs.length > 3 ? ` 외 ${diffs.length - 3}장` : ''}`
}

// 기준 이미지 없이 evaluate 하면 관문이 비교할 대상이 없다. 건너뛰지 말고 멈춘다.
export function missingRef(best, exists, gateOn) {
  if (!gateOn) return null
  if (!best.refDir) return 'best.json 에 refDir 이 없다 — 이번 run 의 baseline 부터 다시 돌려라'
  if (!exists(best.refDir)) return `기준 이미지 디렉터리가 없다: ${best.refDir}`
  return null
}

// 화면에 서버 날짜가 찍히는 앱(gate.freezeDateTz)은 기준선과 날짜가 달라지면 후보 탓이 아니라
// 환경 변화다. 브라우저 시계를 고정해도 서버가 계산하므로 소용없다.
export function zonedDate(now, tz) {
  if (!tz) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now)
}

// 관문이 다르다고 하면 날짜를 다시 본다. 촬영 직전 확인을 통과한 뒤 재촬영 사이에 자정을
// 넘기면 화면이 바뀌어 다르게 나오는데, 그건 후보 탓이 아니다.
export function gateResult(v, refDate, today) {
  if (v.ok) return null
  if (today !== refDate) throw new Error(`날짜가 기준선(${refDate})과 다르다(${today}) — 화면의 일자가 바뀌므로 새 run 으로 다시 시작하라`)
  return { status: 'gate', reason: gateReason(v.diffs) }
}

// 측정 로그(.perf-loop/.local/)는 첫 실행에서 .gitignore 보다 먼저 생기므로 직접 뺀다.
export function dirtyLines(porcelain) {
  return porcelain.split('\n').filter((l) => l.trim() !== '' && !l.slice(3).startsWith(`${LOCAL}/`))
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const gitOk = (...args) => {
  try {
    execFileSync('git', args, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const log = (msg) => process.stderr.write(`[round] ${msg}\n`)

function assertCleanLoopBranch(config) {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  if (branch !== config.loopBranch) throw new Error(`브랜치가 ${config.loopBranch} 가 아니다: ${branch}`)
  const dirty = dirtyLines(git('status', '--porcelain', '--untracked-files=all'))
  if (dirty.length) throw new Error(`작업 트리가 깨끗하지 않다: ${dirty.slice(0, 3).join(', ')}`)
}

function readHistory() {
  return existsSync(TSV) ? parseHistory(readFileSync(TSV, 'utf8')) : []
}

function commitState(message) {
  if (!existsSync(IGNORE)) writeFileSync(IGNORE, '/.local/\n')
  git('add', TSV, IGNORE)
  git('commit', '-q', '-m', message)
  return git('rev-parse', 'HEAD')
}

async function plugins(config) {
  const measurer = await import(new URL(`../measurers/${config.measurer.type}.mjs`, import.meta.url))
  const gate = config.gate ? await import(new URL(`../gates/${config.gate.type}.mjs`, import.meta.url)) : null
  return { measurer, gate }
}

function nextState(best, config, direction) {
  const history = readHistory()
  return {
    ok: true,
    bestCommit: best.commit,
    bestScore: best.measurement.score,
    stop: shouldStop(best.measurement.score, history, { thresholds: config.thresholds, direction }),
    hypotheses: pickHypotheses(best.measurement.opportunities, history, config.thresholds.candidates),
  }
}

const shotsDir = (runNo, sub) => path.join(LOCAL, 'shots', `run${runNo}`, sub)

async function baseline(requested) {
  const cwd = process.cwd()
  const config = loadConfig(cwd)
  const { measurer, gate } = await plugins(config)
  assertCleanLoopBranch(config)
  const runNo = requested ?? nextRun(readHistory())
  // 같은 번호면 후보 브랜치 이름이 겹쳐 라운드 전체가 scope 로 탈락한다
  if (readHistory().some((h) => h.run === runNo)) throw new Error(`run ${runNo} 은 이미 있다 — 다음 번호를 써라`)
  const refDir = gate ? shotsDir(runNo, 'ref') : null
  const refDate = zonedDate(new Date(), config.gate?.freezeDateTz)
  await preflight(cwd, config)
  build(cwd, config)
  // 촬영을 먼저 한다 — 기준이 안정되지 않으면 측정할 이유가 없다
  const measurement = await withServer(cwd, config, async (server) => {
    if (gate) await gate.captureRef(server, config, refDir)
    return measurer.measure({ ...server, config, log })
  })
  if (!existsSync(TSV)) writeFileSync(TSV, TSV_HEADER + '\n')
  appendFileSync(TSV, formatRow({
    run: runNo, round: 0, candidate: 'base', hypothesis: '-', score: measurement.score,
    minGuard: minGuard(measurement), status: 'baseline', commit: git('rev-parse', '--short', 'HEAD'),
    description: `run ${runNo} 기준선 (team-perf-loop ${VERSION})`,
  }) + '\n')
  const commit = commitState(`chore(perf): run ${runNo} 기준선 ${measurement.score}`)
  const best = { commit, measurement, refDir, refDate }
  writeFileSync(BEST, JSON.stringify(best))
  return { run: runNo, ...nextState(best, config, measurer.direction) }
}

// 순서: preflight → beforeBuild → build → afterBuild → 서버{ 관문 → 측정 }.
// 서버가 안 뜨면 crash 다 — 바로 앞의 preflight 가 환경이 살아 있음을 확인했다.
async function inspect(config, measurer, gate, best, dir) {
  const cwd = process.cwd()
  try {
    await preflight(cwd, config)
    const before = failedCheck(cwd, config.checks.beforeBuild)
    if (before) return { status: 'crash', reason: `${before} 실패` }
    build(cwd, config)
    const after = failedCheck(cwd, config.checks.afterBuild)
    if (after) return { status: 'crash', reason: `${after} 실패` }
    return await withServer(cwd, config, async (server) => {
      if (gate) {
        const tz = config.gate.freezeDateTz
        const today = zonedDate(new Date(), tz)
        if (today !== best.refDate) throw new Error(`날짜가 기준선(${best.refDate})과 다르다(${today}) — 화면의 일자가 바뀌므로 새 run 으로 다시 시작하라`)
        const v = await gate.check(server, config, best.refDir, dir)
        const rejected = gateResult(v, best.refDate, zonedDate(new Date(), tz))
        if (rejected) return rejected // 화면이 바뀌면 측정하지 않는다
      }
      return { status: 'measured', measurement: await measurer.measure({ ...server, config, log }) }
    }, { readyFailCode: 2 })
  } catch (e) {
    if (e instanceof MeasureError && e.code === 2) return { status: 'crash', reason: e.message }
    throw e // 환경 오류는 후보 탓이 아니다 — 라운드 전체를 멈춘다
  }
}

async function evaluate(runNo, roundNo, candidates) {
  const config = loadConfig(process.cwd())
  const { measurer, gate } = await plugins(config)
  assertCleanLoopBranch(config)
  const best = JSON.parse(readFileSync(BEST, 'utf8'))
  if (git('rev-parse', 'HEAD') !== best.commit) throw new Error('HEAD 가 best.json 의 커밋과 다르다')
  const noRef = missingRef(best, existsSync, !!gate)
  if (noRef) throw new Error(noRef)

  const judged = []
  try {
    for (const c of candidates) {
      const exists = gitOk('rev-parse', '--verify', '--quiet', `${c.branch}^{commit}`)
      const isDescendant = exists && gitOk('merge-base', '--is-ancestor', best.commit, c.branch)
      const changed = isDescendant ? git('diff', '--name-only', '--no-renames', best.commit, c.branch).split('\n').filter(Boolean) : []
      const cls = classifyCandidate({ exists, isDescendant, changed }, config.scope)
      if (cls.status !== 'measure') {
        judged.push({ ...c, ...cls })
        continue
      }

      log(`${c.id} ${c.hypothesis} — 검사·관문·측정`)
      git('checkout', '-q', '--detach', c.branch)
      judged.push({ ...c, ...(await inspect(config, measurer, gate, best, shotsDir(runNo, `r${roundNo}-${c.id}`))) })
      git('checkout', '-q', config.loopBranch)
    }
  } finally {
    git('checkout', '-q', config.loopBranch)
  }

  const decision = decide(best, judged, { thresholds: config.thresholds, direction: measurer.direction })
  let next = best
  if (decision.winner) {
    const w = judged.find((c) => c.id === decision.winner)
    git('merge', '-q', '--ff-only', w.branch)
    next = { ...best, commit: git('rev-parse', 'HEAD'), measurement: w.measurement }
  }

  for (const r of decision.results) {
    const c = judged.find((x) => x.id === r.id)
    appendFileSync(TSV, formatRow({
      run: runNo, round: roundNo, candidate: r.id, hypothesis: r.hypothesis, score: r.score,
      minGuard: c.measurement ? minGuard(c.measurement) : null, status: r.status,
      commit: gitOk('rev-parse', '--verify', '--quiet', r.branch) ? git('rev-parse', '--short', r.branch) : '',
      description: `${r.description} — ${r.reason}`,
    }) + '\n')
  }
  const head = commitState(`chore(perf): run ${runNo} round ${roundNo} — ${decision.winner ? `keep ${decision.winner} ${next.measurement.score}` : 'keep 없음'}`)
  next = { ...next, commit: head }
  writeFileSync(BEST, JSON.stringify(next))
  return { ...nextState(next, config, measurer.direction), winner: decision.winner, results: decision.results }
}

// 기준 화면을 사람이 미리 본다. 관문이 없으면 build·기동·페이지 200 까지만 확인한다.
async function preview(dir) {
  const cwd = process.cwd()
  const config = loadConfig(cwd)
  const { gate } = await plugins(config)
  await preflight(cwd, config)
  build(cwd, config)
  await withServer(cwd, config, async (server) => {
    if (gate) await gate.captureRef(server, config, dir)
  })
  return { ok: true, dir: gate ? dir : null }
}

// 루프 밖 단독 실측. keep 커밋을 옮기기 전 확인이나 엔진 회귀 비교에 쓴다. 작업 트리를 검사하지 않는다.
async function measureOnce() {
  const cwd = process.cwd()
  const config = loadConfig(cwd)
  const { measurer } = await plugins(config)
  await preflight(cwd, config)
  build(cwd, config)
  return { ok: true, ...(await withServer(cwd, config, (server) => measurer.measure({ ...server, config, log }))) }
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

function writeOut(out, state) {
  const tmp = out + '.tmp'
  writeFileSync(tmp, JSON.stringify(state) + '\n')
  renameSync(tmp, out)
}

async function waitFor(out, maxSec) {
  for (let i = 0; i < maxSec; i++) {
    if (existsSync(out)) return readFileSync(out, 'utf8')
    await new Promise((r) => setTimeout(r, 1000))
  }
  return JSON.stringify({ pending: true }) + '\n'
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2]
  if (cmd === 'preview' || cmd === 'measure') {
    try {
      const r = cmd === 'preview' ? await preview(process.argv[3] ?? path.join(LOCAL, 'shots', 'preview')) : await measureOnce()
      process.stdout.write(JSON.stringify(r) + '\n')
    } catch (e) {
      log(e.message)
      process.stdout.write(JSON.stringify({ ok: false, error: e.message }) + '\n')
      process.exitCode = 1
    }
  } else {
    const out = arg('out')
    if (!out) {
      log('--out 이 필요하다')
      process.exit(64)
    }
    if (cmd === 'wait') {
      process.stdout.write(await waitFor(out, Number(arg('max', '540'))))
    } else {
      mkdirSync(LOCAL, { recursive: true })
      try {
        const runNo = arg('run') === undefined ? undefined : Number(arg('run'))
        const state =
          cmd === 'baseline' ? await baseline(runNo)
          : cmd === 'evaluate' ? await evaluate(runNo, Number(arg('round')), decodeCandidates(arg('candidates')))
          : (() => { throw new Error(`알 수 없는 명령: ${cmd}`) })()
        writeOut(out, state)
      } catch (e) {
        log(e.stack ?? e.message)
        writeOut(out, { ok: false, error: e.message })
        process.exitCode = 1
      }
    }
  }
}
