import { openSync, fstatSync, writeSync, closeSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { commonDir } from './git.mjs'

export const RUNS_HEADER = 'at\tbranch\tmode\tfiles\tlines\tseconds\tcap_hit\tunverified\ttiebreaks\tverdict'

export function formatRun(row) {
  // 제어 문자를 이스케이프하여 한 실행이 항상 열 개의 열·한 줄이 되게 한다.
  return RUNS_HEADER.split('\t').map(key => String(row[key] ?? '')
    .replaceAll('\\', '\\\\').replaceAll('\t', '\\t').replaceAll('\r', '\\r').replaceAll('\n', '\\n')).join('\t')
}

export function appendRun(root, row) {
  const directory = path.join(commonDir(root), 'deep-review')
  mkdirSync(directory, { recursive: true })
  const file = openSync(path.join(directory, 'runs.tsv'), 'a')
  try {
    const header = fstatSync(file).size === 0 ? `${RUNS_HEADER}\n` : ''
    writeSync(file, `${header}${formatRun(row)}\n`)
  } finally { closeSync(file) }
}
