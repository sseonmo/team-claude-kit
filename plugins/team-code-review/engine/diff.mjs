import { git } from './git.mjs'
import { LOCKFILES } from './config.mjs'

// git 의 C 스타일 따옴표 경로("\355\225\234.java", \t, \" ...)를 풀어 UTF-8 로 해석한다.
function unquote(s) {
  if (!(s.length >= 2 && s.startsWith('"') && s.endsWith('"'))) return s
  const bytes = []
  const simple = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '"': 34, '\\': 92 }
  const body = s.slice(1, -1)
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c !== '\\') { bytes.push(...Buffer.from(c, 'utf8')); continue }
    const n = body[++i]
    if (/[0-7]/.test(n)) {
      let oct = n
      while (oct.length < 3 && /[0-7]/.test(body[i + 1] ?? '')) oct += body[++i]
      bytes.push(parseInt(oct, 8))
    } else bytes.push(simple[n] ?? n.charCodeAt(0))
  }
  return Buffer.from(bytes).toString('utf8')
}

// 공백 경로는 양쪽 동일 이름을 먼저 찾고, 이름 변경은 rename from/to 가 덮어쓴다.
function headerPaths(rest) {
  const invalid = () => { throw new Error(`잘못된 diff 헤더: ${rest}`) }
  const quoted = value => {
    if (!value.startsWith('"')) return null
    let i = 1
    while (i < value.length && value[i] !== '"') i += value[i] === '\\' ? 2 : 1
    if (i >= value.length) invalid()
    return { path: unquote(value.slice(0, i + 1)), end: i + 1 }
  }
  let oldPath, newPath
  const first = quoted(rest)
  if (first) {
    if (rest[first.end] !== ' ') invalid()
    oldPath = first.path
    const tail = rest.slice(first.end + 1)
    const second = quoted(tail)
    if (second && second.end !== tail.length) invalid()
    newPath = second ? second.path : tail
  } else {
    const mid = (rest.length - 1) / 2
    if (rest[mid] === ' ' && rest.slice(2, mid) === rest.slice(mid + 3)) {
      oldPath = rest.slice(0, mid)
      newPath = rest.slice(mid + 1)
    } else {
      const match = rest.match(/^(a\/.*) ("b\/.*"|b\/.*)$/)
      if (!match) invalid()
      oldPath = match[1]
      const second = quoted(match[2])
      if (second && second.end !== match[2].length) invalid()
      newPath = second ? second.path : match[2]
    }
  }
  if (!oldPath.startsWith('a/') || !newPath.startsWith('b/') || oldPath.length <= 2 || newPath.length <= 2) invalid()
  return [oldPath.slice(2), newPath.slice(2)]
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

// unified diff 텍스트를 FileDiff[] 로 바꾼다. added 는 new 쪽, removed 는 old 쪽 줄 번호.
export function parseDiff(text) {
  const files = []
  let f = null
  let oldNo = 0, newNo = 0, oldLeft = 0, newLeft = 0
  const finish = () => {
    if (!f) return
    if (f.status === 'D') f.path = f.oldPath
    files.push(f)
    f = null
  }
  for (const line of text.split('\n')) {
    // hunk 본문 안: 남은 줄 수로 끝을 판단해야 "--- x" 같은 내용이 헤더로 오인되지 않는다
    if (f && (oldLeft > 0 || newLeft > 0)) {
      const c = line[0]
      if (c === '+') { f.added.push(newNo++); f.addedText.push(line.slice(1)); newLeft-- }
      else if (c === '-') { f.removed.push(oldNo++); f.removedText.push(line.slice(1)); oldLeft-- }
      else if (c === ' ' || line === '') { oldNo++; newNo++; oldLeft--; newLeft-- }
      continue
    }
    if (line.startsWith('diff --git ')) {
      finish()
      const [oldPath, path] = headerPaths(line.slice('diff --git '.length))
      f = { path, oldPath, status: 'M', added: [], removed: [], addedText: [], removedText: [], hunks: [] }
      continue
    }
    if (!f) continue
    if (line.startsWith('new file mode')) f.status = 'A'
    else if (line.startsWith('deleted file mode')) f.status = 'D'
    else if (line.startsWith('rename from ')) { f.status = 'R'; f.oldPath = unquote(line.slice(12)) }
    else if (line.startsWith('rename to ')) f.path = unquote(line.slice(10))
    else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) f.status = 'B'
    else {
      const m = HUNK.exec(line)
      if (m) {
        const h = { oldStart: +m[1], oldLines: m[2] === undefined ? 1 : +m[2], newStart: +m[3], newLines: m[4] === undefined ? 1 : +m[4] }
        f.hunks.push(h)
        oldNo = h.oldStart; newNo = h.newStart
        oldLeft = h.oldLines; newLeft = h.newLines
      }
    }
  }
  finish()
  return files
}

// untracked 파일은 git diff 에 안 나오므로 /dev/null 과 비교해 새 파일 diff 를 만든다.
// 차이가 있으면 종료 코드 1 이 정상이다.
export function untrackedDiff(root, paths) {
  return paths.flatMap(p => parseDiff(git(['diff', '--no-index', '--', '/dev/null', p], root, { okCodes: [1] }) ?? ''))
}

// 생성 파일(lockfile)인지 — 변경 줄 수 집계에서 뺀다. LOCKFILES 의 `*.x` 는 접미사, 나머지는 파일명 일치.
export function isLockfile(path) {
  const base = path.split('/').pop()
  return LOCKFILES.some(p => (p.startsWith('*') ? base.endsWith(p.slice(1)) : base === p))
}
