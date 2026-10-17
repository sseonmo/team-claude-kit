// 프로젝트 설정(.claude/perf-loop.json) 로드·검증·기본값.
// 틀린 설정은 baseline 전에 환경 오류로 멈춘다 — 측정 도중에 발견하면 그 회차가 통째로 버려진다.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const CONFIG_PATH = '.claude/perf-loop.json'
export const MEASURERS = ['lighthouse']
export const GATES = ['screenshots']

const DEFAULT_THRESHOLDS = { minGain: 1, target: 90, stallRounds: 5, maxRounds: 20, candidates: 3 }

const get = (o, key) => key.split('.').reduce((v, k) => (v == null ? undefined : v[k]), o)

export function parseConfig(raw) {
  const errors = []
  const need = (key) => {
    const v = get(raw, key)
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) errors.push(`${key} 가 필요하다`)
  }
  for (const k of ['build', 'server.start', 'server.port', 'measurer.type', 'measurer.pages', 'scope.allow']) need(k)

  const mType = get(raw, 'measurer.type')
  if (mType && !MEASURERS.includes(mType)) errors.push(`measurer.type 은 ${MEASURERS.join('·')} 중 하나 (${mType})`)
  if (raw.gate) {
    if (!GATES.includes(raw.gate.type)) errors.push(`gate.type 은 ${GATES.join('·')} 중 하나 (${raw.gate.type})`)
    else if (raw.gate.type === 'screenshots') need('gate.screens')
  }
  if (raw.auth) need('auth.cookieCmd')
  ;(raw.preflight ?? []).forEach((p, i) => {
    if (!p.name) errors.push(`preflight[${i}].name 가 필요하다`)
    if (!p.cmd) errors.push(`preflight[${i}].cmd 가 필요하다`)
  })

  const config = {
    loopBranch: raw.loopBranch ?? 'perf/loop',
    copyFiles: raw.copyFiles ?? [],
    setup: raw.setup ?? [],
    preflight: raw.preflight ?? [],
    checks: { beforeBuild: raw.checks?.beforeBuild ?? [], afterBuild: raw.checks?.afterBuild ?? [] },
    build: raw.build,
    server: { readyPath: '/', readyTimeoutSec: 60, ...raw.server },
    auth: raw.auth ?? null,
    measurer: { runs: 3, ...raw.measurer },
    gate: raw.gate ?? null,
    scope: { allow: raw.scope?.allow ?? [], deny: raw.scope?.deny ?? [] },
    thresholds: { ...DEFAULT_THRESHOLDS, ...raw.thresholds },
    guide: raw.guide ?? '.claude/perf-loop/guide.md',
  }
  return { config, errors }
}

export function loadConfig(cwd) {
  const file = path.join(cwd, CONFIG_PATH)
  let raw
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    throw new Error(`${CONFIG_PATH} 를 읽지 못했다: ${e.message}`)
  }
  const { config, errors } = parseConfig(raw)
  if (errors.length) throw new Error(`${CONFIG_PATH} 오류: ${errors.join(', ')}`)
  return config
}

export function fill(cmd, { port }) {
  return cmd.replaceAll('{port}', String(port))
}

export function benchDir(repoRoot, home = os.homedir()) {
  const hash = createHash('sha1').update(path.resolve(repoRoot)).digest('hex').slice(0, 6)
  return path.join(home, '.cache', 'perf-loop', `${path.basename(repoRoot)}-${hash}`, 'bench')
}
