import { hunkOf, inScope } from './scope.mjs'

const clean = text => text.replace(/\r$/, '')

export function makeAnchor(lines, line) {
  const index = line - 1
  return { text: clean(lines[index]), before: lines.slice(Math.max(0, index - 2), index).map(clean), after: lines.slice(index + 1, index + 3).map(clean) }
}

function contextScore(anchor, lines, index) {
  return anchor.before.reduce((score, text, i) => score + (clean(text) === lines[index - anchor.before.length + i] ? 1 : 0), 0)
    + anchor.after.reduce((score, text, i) => score + (clean(text) === lines[index + i + 1] ? 1 : 0), 0)
}

export function locate(anchor, lines) {
  if (!anchor) return null
  const normalized = lines.map(clean)
  let best = null, score = -1
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] !== clean(anchor.text)) continue
    const next = contextScore(anchor, normalized, i)
    if (next > score) { best = i + 1; score = next }
  }
  return best
}

// 원문이 사라진 교체 줄은 두 줄 이상의 문맥이 완전히 일치하는 유일한 자리만 쓴다.
// 빈 줄만 맞거나 옛 줄 번호만 같은 자리를 쓰면 무관한 지적을 숨길 수 있다.
function replacementLine(anchor, lines) {
  const context = [...anchor.before, ...anchor.after]
  if (context.filter(text => clean(text).trim()).length < 2) return null
  const normalized = lines.map(clean)
  const matches = []
  for (let i = 0; i < normalized.length; i++) {
    if (contextScore(anchor, normalized, i) === context.length) matches.push(i + 1)
  }
  return matches.length === 1 ? matches[0] : null
}

const history = record => record.rounds.flatMap(round => round.findings)

export function priorCandidates(record, scope, readLines) {
  const previous = history(record)
  const byId = new Map(previous.map(finding => [finding.id, finding]))
  const candidates = []
  const seen = new Set()
  function correspond(finding, anchor) {
    if (!finding?.loc || !anchor) return null
    const file = scope.get(finding.loc.path) ?? [...scope.values()].find(file => file.oldPath === finding.loc.path)
    if (!file) return null
    const path = file.status === 'D' ? file.oldPath : file.path
    const lines = readLines(path, finding.loc.side)
    const line = locate(anchor, lines) ?? replacementLine(anchor, lines)
    const loc = { path, side: finding.loc.side, line }
    if (!inScope(loc, scope)) return null
    const hunk = hunkOf(loc, scope)
    if (hunk) {
      const side = loc.side === 'old' ? 'new' : 'old'
      const block = file.hunks.find(block => loc.line >= block[`${loc.side}Start`] && loc.line < block[`${loc.side}Start`] + block[`${loc.side}Lines`])
      // 같은 실제 수정 hunk 의 반대쪽도 연결하되 빈 쪽에는 범위를 만들지 않는다.
      if (block[`${side}Lines`] > 0) hunk.paired = { path, side, start: block[`${side}Start`], end: block[`${side}Start`] + block[`${side}Lines`] - 1 }
    }
    return hunk ? { loc, hunk } : null
  }
  for (const prior of previous.toReversed()) {
    if (seen.has(prior.id)) continue
    seen.add(prior.id)
    const skip = record.skips[prior.id]
    // 기각한 쪽의 old 코드는 계속 남을 수 있다. 결정의 수명은 채택한 쪽 코드로 판단한다.
    const source = skip?.adopted ? byId.get(skip.adopted) : prior
    const match = correspond(source, skip?.snapshot ?? source?.anchor)
    if (match) candidates.push({ prior, ...match })
  }
  // 보류 이월에는 기각 id 도 필요하지만 검증 판단의 기준으로 승격하지 않는다.
  // 채택 판단은 이후 왕복·기각 회차보다 먼저 유지한다.
  const adopted = new Set(Object.values(record.skips).map(skip => skip.adopted).filter(Boolean))
  for (const candidate of candidates) {
    const prior = candidate.prior
    candidate.authoritative = prior.verification !== 'refuted' && !record.skips[prior.id]?.adopted
      && (!prior.folded || Boolean(record.skips[prior.id]))
  }
  return candidates.sort((a, b) => Number(b.authoritative && adopted.has(b.prior.id)) - Number(a.authoritative && adopted.has(a.prior.id)))
}

const containsRange = (range, loc) => range && range.path === loc.path && range.side === loc.side && loc.line >= range.start && loc.line <= range.end
const contains = (hunk, loc) => containsRange(hunk, loc) || containsRange(hunk.paired, loc)

export function attachPriors(raws, candidates, scope) {
  return raws.map(raw => {
    const matching = inScope(raw.loc, scope) ? candidates.filter(candidate => candidate.authoritative !== false && contains(candidate.hunk, raw.loc)) : []
    // 관계 투표는 특정 prior 에 대한 판단이므로 유효한 supplied id 를 보존한다.
    const candidate = matching.find(candidate => candidate.prior.id === raw.priorId) ?? matching[0]
    return { ...raw, priorId: candidate?.prior.id ?? null }
  })
}

const newProblem = finding => finding.votes?.some(vote => vote.verdict === 'confirmed' && vote.relation === 'new_problem')
const sameIssue = (a, b) => a.dimension === b.dimension && a.title === b.title
const folded = (id, skip, decision = false) => ({ byId: id, memo: skip.memo, reason: decision ? `${id} 기각에 따름` : `${id} 보류에 따름` })

export function applyHistory(findings, record, candidates, readLines) {
  const active = new Map()
  for (const [id, skip] of Object.entries(record.skips)) {
    const candidate = candidates.find(candidate => candidate.prior.id === id)
      ?? (skip.adopted ? candidates.find(candidate => candidate.prior.id === skip.adopted) : null)
    if (!candidate) continue
    const lines = readLines(candidate.loc.path, candidate.loc.side)
    if (typeof lines[candidate.loc.line - 1] !== 'string') continue
    const anchor = makeAnchor(lines, candidate.loc.line)
    if (skip.snapshot === null) skip.snapshot = anchor
    else if (clean(skip.snapshot.text) !== anchor.text) { delete record.skips[id]; continue }
    active.set(id, { skip, candidate, anchor })
  }

  const merged = new Set()
  const conflicts = []
  const processed = findings.map(original => {
    const finding = { ...original }
    // 기각된 지적과 새 문제 표의 충돌 정보는 판정에 사용하지 않는다.
    if (finding.verification === 'refuted' || newProblem(finding)) delete finding.conflict
    if (finding.verification === 'refuted') return finding
    for (const [id, { skip, candidate }] of active) {
      if (newProblem(finding) || !contains(candidate.hunk, finding.loc)) continue
      // 재사용한 채택 항목은 충돌만 풀고 활성 발견으로 남긴다. 기각 항목은 이월한다.
      if (finding.id === skip.adopted && finding.conflict?.priorId === id) {
        delete finding.conflict
        continue
      }
      const decision = finding.conflict && skip.adopted === finding.conflict.priorId
      if (decision || sameIssue(finding, candidate.prior)) {
        if (!finding.folded || decision) finding.folded = folded(id, skip, decision)
        merged.add(id)
      }
    }
    if (finding.folded) delete finding.conflict
    if (finding.conflict && !finding.folded) conflicts.push({ newId: finding.id, priorId: finding.conflict.priorId })
    return finding
  })

  const carried = []
  for (const [id, { skip, candidate, anchor }] of active) {
    if (merged.has(id)) continue
    if (carried.some(finding => sameIssue(finding, candidate.prior) && finding.loc.path === candidate.loc.path && finding.loc.side === candidate.loc.side && finding.loc.line === candidate.loc.line)) continue
    const finding = { ...candidate.prior, loc: candidate.loc, anchor, folded: folded(id, skip) }
    delete finding.conflict
    carried.push(finding)
  }
  return { findings: processed, conflicts, carried }
}

export function convergence(record, findings, failedDims, candidates) {
  const current = findings.filter(finding => finding.verification !== 'refuted')
  const result = { resolved: 0, fresh: 0, conflicts: 0, skipped: 0, unchecked: 0 }
  const seen = new Set()
  const relevant = candidates.filter(candidate => {
    const key = JSON.stringify([candidate.prior.dimension, candidate.prior.title, candidate.loc])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const repeats = (finding, candidate) => (finding.folded || !newProblem(finding)) && (finding.id === candidate.prior.id || finding.priorId === candidate.prior.id
    || finding.conflict?.priorId === candidate.prior.id || finding.folded?.byId === candidate.prior.id
    || (sameIssue(finding, candidate.prior) && contains(candidate.hunk, finding.loc)))
  for (const candidate of relevant) {
    if (current.some(finding => repeats(finding, candidate))) continue
    if (failedDims.includes(candidate.prior.dimension)) result.unchecked++
    else result.resolved++
  }
  for (const finding of current) {
    if (finding.folded) result.skipped++
    else if (finding.conflict) result.conflicts++
    else if (!relevant.some(candidate => repeats(finding, candidate))) result.fresh++
  }
  return result
}
