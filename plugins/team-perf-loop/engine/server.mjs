// 체크아웃 하나의 빌드·서버 수명주기. 명령은 전부 프로젝트 설정에서 오고 cwd(벤치)에서 sh 로 돈다.
//
// MeasureError.code
//   1 = 환경 오류(사전 점검 실패·쿠키 만료·리다이렉트). 루프를 멈춰야 한다 —
//       후보 실패로 기록하면 이력이 오염되어 멀쩡한 가설이 영구히 빠진다.
//   2 = 후보 탓(빌드 실패·5xx·후보 평가 중 서버 미기동). crash 로 기록하고 넘어간다.

import { spawn, spawnSync } from 'node:child_process'

import { fill } from './config.mjs'

export class MeasureError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

export function preflightStatus(status, location) {
  if (status === 200) return null
  return `HTTP ${status}${location ? ` → ${location}` : ''}`
}

// 5xx 는 후보가 페이지를 런타임에 깨뜨린 것이라 crash(2). 리다이렉트·401·404 는 환경 문제(1).
export function preflightErrorCode(status) {
  return status >= 500 ? 2 : 1
}

export function cookieHeader(list) {
  return list.map(({ name, value }) => `${name}=${value}`).join('; ')
}

export function parseCookies(text) {
  let list
  try {
    list = JSON.parse(text)
  } catch {
    throw new Error(`쿠키 명령 출력이 JSON 이 아니다: ${String(text).slice(0, 100)}`)
  }
  if (!Array.isArray(list) || list.length === 0) throw new Error('쿠키 목록이 비었다')
  if (!list.every((c) => typeof c?.name === 'string' && typeof c?.value === 'string')) throw new Error('쿠키마다 name·value 문자열이 필요하다')
  return list.map(({ name, value }) => ({ name, value }))
}

const baseUrl = (config) => `http://localhost:${config.server.port}`

const sh = (cwd, cmd, opts = {}) => spawnSync('sh', ['-c', cmd], { cwd, encoding: 'utf8', ...opts })

function log(msg) {
  process.stderr.write(`[server] ${msg}\n`)
}

async function alive(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'manual' })
    return true
  } catch {
    return false
  }
}

export async function preflight(cwd, config) {
  for (const p of config.preflight) {
    const r = sh(cwd, fill(p.cmd, config.server), { stdio: ['ignore', 'ignore', 'pipe'] })
    if (r.status !== 0) {
      const detail = (r.stderr ?? '').trim().split('\n').pop()
      throw new MeasureError(1, `사전 점검 실패: ${p.name}${detail ? ` (${detail})` : ''}${p.fix ? ` — 해결: ${p.fix}` : ''}`)
    }
  }
  if (await alive(`${baseUrl(config)}/`)) throw new MeasureError(1, `포트 ${config.server.port} 이 이미 쓰이고 있다`)
}

export function build(cwd, config) {
  log(config.build)
  const r = sh(cwd, config.build, { stdio: ['ignore', 2, 2] })
  if (r.status !== 0) throw new MeasureError(2, `build 실패 (exit ${r.status})`)
}

// 처음 실패한 명령. 전부 통과하면 null.
export function failedCheck(cwd, cmds) {
  for (const cmd of cmds) {
    log(cmd)
    if (sh(cwd, cmd, { stdio: ['ignore', 2, 2] }).status !== 0) return cmd
  }
  return null
}

function cookiesFor(cwd, config) {
  if (!config.auth) return []
  const r = sh(cwd, fill(config.auth.cookieCmd, config.server), { stdio: ['ignore', 'pipe', 'pipe'] })
  if (r.status !== 0) throw new MeasureError(1, `세션 쿠키 발급 실패: ${(r.stderr || r.stdout).trim()}`)
  try {
    return parseCookies(r.stdout)
  } catch (e) {
    throw new MeasureError(1, `세션 쿠키 발급 실패: ${e.message}`)
  }
}

// 서버 한 번으로 촬영과 측정을 함께 하려고 수명주기를 떼어 둔다. 끝나면 항상 서버를 끈다 —
// 프로세스 그룹 kill 이라 sh 아래의 java·next-server 까지 잡힌다.
//
// readyFailCode: 기준선(1)에서는 같은 커밋이 늘 뜨던 것이므로 환경 문제다. 후보 평가(2)에서는
// 직전 preflight 가 통과했으므로 후보가 앱을 깨뜨린 것이다(설계 "상태 분류").
export async function withServer(cwd, config, fn, { readyFailCode = 1 } = {}) {
  const base = baseUrl(config)
  const start = fill(config.server.start, config.server)
  log(start)
  const server = spawn('sh', ['-c', start], { cwd, detached: true, stdio: ['ignore', 'ignore', 'inherit'] })
  const ready = `${base}${config.server.readyPath}`
  try {
    const deadline = Date.now() + config.server.readyTimeoutSec * 1000
    while (!(await alive(ready)) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500))
    if (!(await alive(ready))) throw new MeasureError(readyFailCode, `서버가 ${config.server.readyTimeoutSec}초 안에 뜨지 않았다: ${start}`)

    const cookies = cookiesFor(cwd, config)
    const cookie = cookieHeader(cookies)
    for (const p of config.measurer.pages) {
      const res = await fetch(`${base}${p.path}`, { redirect: 'manual', headers: p.auth ? { cookie } : {} })
      const err = preflightStatus(res.status, res.headers.get('location'))
      if (err) throw new MeasureError(preflightErrorCode(res.status), `${p.path} 프리플라이트 실패: ${err}`)
    }
    return await fn({ baseUrl: base, cookies })
  } finally {
    try {
      process.kill(-server.pid, 'SIGTERM')
    } catch {
      // 이미 내려갔다
    }
    // 다음 후보의 preflight 가 내려가는 중인 서버를 "포트 사용 중" 으로 오인해 라운드를 멈추지 않게 한다
    for (let i = 0; i < 20 && (await alive(`${base}/`)); i++) await new Promise((r) => setTimeout(r, 500))
  }
}
