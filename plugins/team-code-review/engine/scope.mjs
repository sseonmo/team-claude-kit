// 삭제 파일은 이전 경로, 나머지는 현재 경로를 키로 쓴다.
export function buildScope(files) {
  return new Map(files.filter(file => file.status !== 'B').map(file => [file.status === 'D' ? file.oldPath : file.path, file]))
}

export function inScope(loc, scope) {
  if (!loc || typeof loc.path !== 'string' || !Number.isSafeInteger(loc.line) || loc.line < 1 || !['old', 'new'].includes(loc.side)) return false
  const file = scope.get(loc.path)
  if (!file || file.status === 'B' || (loc.oldPath !== undefined && loc.oldPath !== file.oldPath)) return false
  if ((file.status === 'D' && loc.side === 'new') || (file.status === 'A' && loc.side === 'old')) return false
  return (loc.side === 'old' ? file.removed : file.added).includes(loc.line)
}

export function filterFindings(findings, scope) {
  const kept = findings.filter(finding => inScope(finding?.loc, scope))
  return { kept, dropped: findings.length - kept.length }
}

export function hunkOf(loc, scope) {
  if (!inScope(loc, scope)) return null
  const startKey = loc.side === 'old' ? 'oldStart' : 'newStart'
  const linesKey = loc.side === 'old' ? 'oldLines' : 'newLines'
  const hunk = scope.get(loc.path).hunks.find(hunk => loc.line >= hunk[startKey] && loc.line < hunk[startKey] + hunk[linesKey])
  return hunk ? { path: loc.path, side: loc.side, start: hunk[startKey], end: hunk[startKey] + hunk[linesKey] - 1 } : null
}

// 줄 번호를 정렬하고 중복을 제거한 뒤 연속 구간을 접는다.
function ranges(lines) {
  const sorted = [...new Set(lines)].sort((a, b) => a - b)
  const result = []
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]
    let end = start
    while (sorted[i + 1] === end + 1) end = sorted[++i]
    result.push(start === end ? String(start) : `${start}-${end}`)
  }
  return result.join(', ')
}

export function scopeSummary(scope) {
  return [...scope].flatMap(([path, file]) => {
    if (file.status === 'B') return []
    const added = file.status === 'D' ? '' : ranges(file.added)
    const removed = file.status === 'A' ? '' : ranges(file.removed)
    const parts = [added, removed ? `old: ${removed}` : ''].filter(Boolean)
    return parts.length ? [`${path}: ${parts.join(' / ')}`] : []
  }).join('\n')
}
