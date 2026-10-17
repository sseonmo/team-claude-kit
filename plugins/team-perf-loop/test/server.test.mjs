// 서버 수명주기는 실제 프로세스로 확인한다 — 작은 node HTTP 서버를 start 명령으로 쓴다.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  MeasureError, preflightStatus, preflightErrorCode, cookieHeader, parseCookies,
  preflight, build, failedCheck, withServer,
} from '../engine/server.mjs'
import { parseConfig } from '../engine/config.mjs'

const PORT = 3197
const HTTP = `node -e "require('http').createServer((q,s)=>{s.statusCode=q.url==='/private'&&!(q.headers.cookie||'').includes('sid=ok')?302:200;s.setHeader('location','/login');s.end('ok')}).listen({port})"`
const cfg = (over = {}) => parseConfig({
  build: 'true',
  server: { start: HTTP, port: PORT, readyTimeoutSec: 10 },
  measurer: { type: 'lighthouse', pages: [{ path: '/', auth: false }] },
  scope: { allow: ['**'] },
  ...over,
}).config
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'perf-loop-'))
const alive = () => fetch(`http://localhost:${PORT}/`).then(() => true, () => false)

describe('순수 헬퍼', () => {
  test('preflightStatus — 200 만 통과', () => {
    assert.equal(preflightStatus(200, null), null)
    assert.match(preflightStatus(307, '/login'), /307.*login/)
  })

  test('preflightErrorCode — 5xx 는 후보 탓(2), 그 밖은 환경(1)', () => {
    assert.equal(preflightErrorCode(500), 2)
    assert.equal(preflightErrorCode(302), 1)
    assert.equal(preflightErrorCode(404), 1)
  })

  test('cookieHeader', () => {
    assert.equal(cookieHeader([{ name: 'a', value: 'x' }, { name: 'b', value: 'y' }]), 'a=x; b=y')
  })

  test('parseCookies — [{name,value}] 만 받는다', () => {
    assert.deepEqual(parseCookies('[{"name":"sid","value":"ok","path":"/"}]'), [{ name: 'sid', value: 'ok' }])
    assert.throws(() => parseCookies('nope'), /JSON/)
    assert.throws(() => parseCookies('[]'), /비었다/)
    assert.throws(() => parseCookies('[{"name":"a"}]'), /name·value/)
  })
})

describe('preflight', () => {
  test('실패한 항목의 이름과 해결 방법을 담아 환경 오류(1)', async () => {
    const c = cfg({ preflight: [{ name: 'ok', cmd: 'true' }, { name: '로컬 DB', cmd: 'false', fix: 'docker start db' }] })
    await assert.rejects(preflight(tmp(), c), (e) => e instanceof MeasureError && e.code === 1 && /로컬 DB.*docker start db/.test(e.message))
  })

  test('사전 점검 명령에서도 {port} 를 바꾼다', async () => {
    await assert.rejects(preflight(tmp(), cfg({ preflight: [{ name: 'p', cmd: 'test {port} = 1' }] })), /p/)
    await preflight(tmp(), cfg({ preflight: [{ name: 'p', cmd: `test {port} = ${PORT}` }] }))
  })

  test('명령은 cwd 에서 돈다', async () => {
    const dir = tmp()
    await preflight(dir, cfg({ preflight: [{ name: 'cwd', cmd: `test "$(pwd -P)" = "$(cd ${dir} && pwd -P)"` }] }))
  })
})

describe('build·failedCheck', () => {
  test('build 실패는 후보 탓(2)', () => {
    assert.throws(() => build(tmp(), cfg({ build: 'exit 3' })), (e) => e.code === 2 && /exit 3/.test(e.message))
  })

  test('failedCheck — 처음 실패한 명령을 돌려주고, 모두 통과면 null', () => {
    assert.equal(failedCheck(tmp(), ['true', 'true']), null)
    assert.equal(failedCheck(tmp(), ['true', 'false', 'exit 9']), 'false')
  })
})

describe('withServer', () => {
  test('서버를 띄워 fn 에 baseUrl 을 주고, 끝나면 포트를 비운다', async () => {
    const r = await withServer(tmp(), cfg(), async ({ baseUrl, cookies }) => {
      assert.equal(baseUrl, `http://localhost:${PORT}`)
      assert.deepEqual(cookies, [])
      return 'done'
    })
    assert.equal(r, 'done')
    assert.equal(await alive(), false)
  })

  test('readyTimeoutSec 안에 안 뜨면 readyFailCode 로 던진다 — 후보 평가에서는 crash(2)', async () => {
    const c = cfg({ server: { start: 'sleep 30', port: PORT, readyTimeoutSec: 1 } })
    await assert.rejects(withServer(tmp(), c, async () => {}, { readyFailCode: 2 }), (e) => e.code === 2 && /1초/.test(e.message))
    await assert.rejects(withServer(tmp(), c, async () => {}), (e) => e.code === 1)
  })

  test('쿠키 명령의 출력으로 auth 페이지 프리플라이트를 통과한다', async () => {
    const c = cfg({
      auth: { cookieCmd: `echo '[{"name":"sid","value":"ok"}]'` },
      measurer: { type: 'lighthouse', pages: [{ path: '/private', auth: true }] },
    })
    const cookies = await withServer(tmp(), c, async (s) => s.cookies)
    assert.deepEqual(cookies, [{ name: 'sid', value: 'ok' }])
  })

  test('쿠키가 안 먹어 리다이렉트되면 환경 오류(1)', async () => {
    const c = cfg({
      auth: { cookieCmd: `echo '[{"name":"sid","value":"expired"}]'` },
      measurer: { type: 'lighthouse', pages: [{ path: '/private', auth: true }] },
    })
    await assert.rejects(withServer(tmp(), c, async () => {}), (e) => e.code === 1 && /\/private.*302/.test(e.message))
    assert.equal(await alive(), false)
  })

  test('쿠키 명령에서도 {port} 를 바꾼다 — 로그인 요청을 보낼 곳', async () => {
    const c = cfg({
      auth: { cookieCmd: `echo '[{"name":"port","value":"{port}"}]'` },
    })
    assert.deepEqual(await withServer(tmp(), c, async (s) => s.cookies), [{ name: 'port', value: String(PORT) }])
  })

  test('쿠키 명령이 실패하면 환경 오류(1)', async () => {
    const c = cfg({ auth: { cookieCmd: 'echo boom >&2; exit 1' } })
    await assert.rejects(withServer(tmp(), c, async () => {}), (e) => e.code === 1 && /boom/.test(e.message))
  })

  test('포트가 이미 쓰이고 있으면 preflight 가 환경 오류(1)', async () => {
    await withServer(tmp(), cfg(), async () => {
      await assert.rejects(preflight(tmp(), cfg()), (e) => e.code === 1 && /3197/.test(e.message))
    })
  })
})
