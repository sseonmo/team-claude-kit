// 측정 도구(lighthouse·chrome-launcher·puppeteer-core·sharp)는 머신 공용 디렉터리에 한 번 설치한다.
// 플러그인 캐시는 재클론되어 node_modules 가 사라지고, Java 프로젝트에는 package.json 이 없다.
//
// ESM 은 NODE_PATH 를 보지 않으므로 도구 디렉터리 안의 load.mjs 가 대신 import 한다 —
// 그 파일 기준으로 node_modules 가 풀린다.

import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { MeasureError } from './server.mjs'

export const TOOLS_DIR = process.env.PERF_LOOP_TOOLS ?? path.join(os.homedir(), '.cache', 'perf-loop', 'tools')

export async function loadTool(name) {
  const loader = path.join(TOOLS_DIR, 'load.mjs')
  if (!existsSync(path.join(TOOLS_DIR, 'node_modules', name))) {
    throw new MeasureError(1, `측정 도구 ${name} 이 ${TOOLS_DIR} 에 없다 — /perf-loop-init 으로 설치하라`)
  }
  const { load } = await import(pathToFileURL(loader).href)
  return load(name)
}
