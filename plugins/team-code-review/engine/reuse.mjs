import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { VERSION } from './config.mjs'

export function reuseKey({ headSha, baseSha, diffText, untrackedText, stagedText, mode, rulesText, version = VERSION, dimensions = null }) {
  // 구조화된 필드 경계로 내용에 개행·구분자가 있어도 입력끼리 합쳐지지 않는다.
  return createHash('sha256').update(JSON.stringify([headSha, baseSha, diffText, untrackedText, stagedText, mode, rulesText, version, dimensions])).digest('hex')
}

const inside = (root, target) => {
  const relative = path.relative(root, target)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export function rulesText(root, files) {
  root = realpathSync(root)
  const directories = new Set([root])
  for (const file of files) {
    for (const name of [file.path, file.oldPath]) {
      if (typeof name !== 'string' || path.isAbsolute(name)) continue
      const target = path.resolve(root, name)
      if (!inside(root, target)) continue
      let directory = path.dirname(target)
      while (inside(root, directory)) {
        directories.add(directory)
        if (directory === root) break
        directory = path.dirname(directory)
      }
    }
  }
  const entries = []
  for (const directory of directories) {
    for (const name of ['CLAUDE.md', 'AGENTS.md']) {
      const candidate = path.join(directory, name)
      try {
        // 파일이나 상위 디렉터리가 외부로 연결된 경우에도 읽기를 막는다.
        if (!inside(root, realpathSync(candidate))) continue
        entries.push([path.relative(root, candidate).split(path.sep).join('/'), readFileSync(candidate, 'utf8')])
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
      }
    }
  }
  entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  return JSON.stringify(entries)
}
