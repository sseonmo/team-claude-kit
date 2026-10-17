import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { parseConfig, fill, benchDir } from '../engine/config.mjs'

const minimal = {
  build: './gradlew bootJar',
  server: { start: 'java -jar app.jar --server.port={port}', port: 3100 },
  measurer: { type: 'lighthouse', pages: [{ path: '/', auth: false }] },
  scope: { allow: ['src/main/resources/templates/**'] },
}

describe('parseConfig', () => {
  test('최소 설정에 기본값을 채운다', () => {
    const { config, errors } = parseConfig(minimal)
    assert.deepEqual(errors, [])
    assert.equal(config.loopBranch, 'perf/loop')
    assert.deepEqual(config.copyFiles, [])
    assert.deepEqual(config.setup, [])
    assert.deepEqual(config.preflight, [])
    assert.deepEqual(config.checks, { beforeBuild: [], afterBuild: [] })
    assert.equal(config.server.readyPath, '/')
    assert.equal(config.server.readyTimeoutSec, 60)
    assert.equal(config.auth, null)
    assert.equal(config.gate, null)
    assert.equal(config.measurer.runs, 3)
    assert.deepEqual(config.scope.deny, [])
    assert.deepEqual(config.thresholds, { minGain: 1, target: 90, stallRounds: 5, maxRounds: 20, candidates: 3 })
    assert.equal(config.guide, '.claude/perf-loop/guide.md')
  })

  test('지정한 값은 기본값보다 우선하고, thresholds 는 키 단위로 합친다', () => {
    const { config } = parseConfig({ ...minimal, thresholds: { minGain: 2 }, server: { ...minimal.server, readyTimeoutSec: 120 } })
    assert.equal(config.thresholds.minGain, 2)
    assert.equal(config.thresholds.target, 90)
    assert.equal(config.server.readyTimeoutSec, 120)
  })

  test('필수 키가 빠지면 전부 모아서 알려준다', () => {
    const { errors } = parseConfig({})
    assert.deepEqual(errors, ['build', 'server.start', 'server.port', 'measurer.type', 'measurer.pages', 'scope.allow'].map((k) => `${k} 가 필요하다`))
  })

  test('모르는 측정기·관문 종류는 오류', () => {
    const { errors } = parseConfig({ ...minimal, measurer: { ...minimal.measurer, type: 'k6' }, gate: { type: 'pixels', screens: [] } })
    assert.deepEqual(errors, ['measurer.type 은 lighthouse 중 하나 (k6)', 'gate.type 은 screenshots 중 하나 (pixels)'])
  })

  test('screenshots 관문은 screens 가 필요하다', () => {
    const { errors } = parseConfig({ ...minimal, gate: { type: 'screenshots' } })
    assert.deepEqual(errors, ['gate.screens 가 필요하다'])
  })

  test('auth 가 있으면 cookieCmd 가 필요하다', () => {
    assert.deepEqual(parseConfig({ ...minimal, auth: {} }).errors, ['auth.cookieCmd 가 필요하다'])
  })

  test('preflight 항목은 name·cmd 가 필요하다', () => {
    assert.deepEqual(parseConfig({ ...minimal, preflight: [{ name: 'db' }] }).errors, ['preflight[0].cmd 가 필요하다'])
  })
})

describe('fill', () => {
  test('{port} 를 모두 바꾼다', () => {
    assert.equal(fill('a {port} b {port}', { port: 3100 }), 'a 3100 b 3100')
  })
})

describe('benchDir', () => {
  test('저장소 이름 + 경로 해시 6자 — 같은 이름의 다른 저장소가 벤치를 공유하지 않는다', () => {
    const a = benchDir('/x/app', '/home/u')
    const b = benchDir('/y/app', '/home/u')
    assert.match(a, /^\/home\/u\/\.cache\/perf-loop\/app-[0-9a-f]{6}\/bench$/)
    assert.notEqual(a, b)
    assert.equal(benchDir('/x/app', '/home/u'), a)
  })
})
