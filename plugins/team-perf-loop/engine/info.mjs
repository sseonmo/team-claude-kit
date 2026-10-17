// 스킬이 쓰는 정보 한 줄 — 저장소 루트에서 실행한다.
//   node <플러그인>/engine/info.mjs [설정 파일 경로]
// 설정 파일을 주면 그 파일을, 안 주면 .claude/perf-loop.json 을 검증한다(init 의 초안 검증용).

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { benchDir, CONFIG_PATH, parseConfig } from './config.mjs'
import { TOOLS_DIR } from './tools.mjs'

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const file = process.argv[2] ?? path.join(root, CONFIG_PATH)
const out = { root, bench: benchDir(root), tools: TOOLS_DIR, pluginRoot: path.resolve(new URL('..', import.meta.url).pathname), configFile: file }
if (existsSync(file)) {
  const { config, errors } = parseConfig(JSON.parse(readFileSync(file, 'utf8')))
  Object.assign(out, { config, errors })
} else {
  Object.assign(out, { config: null, errors: [`${file} 이 없다`] })
}
process.stdout.write(JSON.stringify(out, null, 2) + '\n')
