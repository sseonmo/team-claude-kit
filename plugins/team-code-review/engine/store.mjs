import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { git, commonDir } from './git.mjs'

const emptyRecord = () => ({ version: 1, rounds: [], skips: {} })
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const nullableString = value => value === null || typeof value === 'string'

// _ 자체를 먼저 이스케이프해야 feature/x 와 feature_2Fx 가 같은 파일을 덮어쓰지 않는다.
export function encodeBranch(name) {
  return encodeURIComponent(name).replaceAll('_', '%5F').replaceAll('%', '_')
}

export function recordPath(root) {
  const branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], root, { okCodes: [1] }).trim()
  return branch ? path.join(commonDir(root), 'deep-review', `${encodeBranch(branch)}.json`) : null
}

function validRecord(value) {
  return object(value) && value.version === 1 && Array.isArray(value.rounds) && object(value.skips)
    && value.rounds.every(round => object(round) && Number.isInteger(round.n) && round.n > 0
      && ['at', 'mode', 'baseSha', 'reuseKey'].every(key => typeof round[key] === 'string')
      && nullableString(round.headSha) && (typeof round.result === 'string' || object(round.result))
      && Array.isArray(round.findings) && round.findings.every(finding => object(finding)
        && typeof finding.id === 'string' && typeof finding.title === 'string')
      && Array.isArray(round.conflicts) && round.conflicts.every(pair => object(pair)
        && typeof pair.newId === 'string' && typeof pair.priorId === 'string'))
    && Object.values(value.skips).every(skip => object(skip) && nullableString(skip.memo)
      && typeof skip.at === 'string' && (skip.snapshot === null || object(skip.snapshot))
      && nullableString(skip.adopted))
}

export function loadRecord(root) {
  const file = recordPath(root)
  if (file === null) return { record: emptyRecord(), notice: null }
  let source
  try { source = readFileSync(file, 'utf8') } catch (error) {
    if (error.code === 'ENOENT') return { record: emptyRecord(), notice: null }
    throw error
  }
  let record
  try { record = JSON.parse(source) } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
  }
  if (validRecord(record)) return { record, notice: null }
  const corrupt = `${file}.corrupt-${new Date().toISOString()}`
  renameSync(file, corrupt)
  return { record: emptyRecord(), notice: `손상된 회차 기록을 ${corrupt} 로 옮겼습니다.` }
}

export function saveRecord(root, record) {
  const file = recordPath(root)
  if (file === null) return
  const source = JSON.stringify(record, null, 2) + '\n'
  mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${randomUUID()}`
  try {
    writeFileSync(temporary, source, { flag: 'wx' })
    renameSync(temporary, file)
  } catch (error) {
    try { unlinkSync(temporary) } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') throw cleanupError
    }
    throw error
  }
}

// 성공한 skip 만 메모리에 반영한다. 파일 입출력은 호출자가 담당한다.
export function applySkip(record, id, memo) {
  const findings = new Map(record.rounds.flatMap(round => round.findings).map(finding => [finding.id, finding]))
  const validIds = [...findings.keys()].filter(key => !Object.hasOwn(record.skips, key))
  if (!validIds.includes(id)) return { ok: false, validIds }
  const pair = record.rounds.at(-1)?.conflicts.find(pair => pair.newId === id || pair.priorId === id)
  const adopted = pair ? (pair.newId === id ? pair.priorId : pair.newId) : null
  record.skips[id] = { memo, at: new Date().toISOString(), snapshot: null, adopted }
  return { ok: true, title: findings.get(id).title }
}
