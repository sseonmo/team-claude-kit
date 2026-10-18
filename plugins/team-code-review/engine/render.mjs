const icons = { critical: '🔴', major: '🟠', minor: '🟡', nit: '🟢' }
const actionable = finding => finding.verification !== 'refuted' && !finding.folded && !finding.conflict
const location = finding => `${finding.loc.path}:${finding.loc.line}${finding.loc.side === 'old' ? ' (삭제된 줄)' : ''}`
const prose = value => (Array.isArray(value) ? value.filter(Boolean).join('\n') : value ?? '')

function comment(finding) {
  const lowered = finding.originalSeverity && finding.originalSeverity !== finding.severity ? ` ← ${finding.originalSeverity}` : ''
  const unverified = finding.verification === 'unverified' ? ' · 미검증' : ''
  const fix = finding.fix == null ? `→ Fix   제안 없음 — ${finding.fixNote || '제안 없음'}`
    : `${finding.fixNote === '미검증' ? '→ Fix (미검증)' : '→ Fix'}   ${finding.fix}`
  return `[${finding.severity}${lowered}${unverified}] ${finding.id} ${finding.title}\nTL;DR   ${finding.tldr ?? ''}\n✓ Good  ${finding.good ?? ''}\n${fix}`
}

function summary(input) {
  const { verdict, findings = [], carried = [], conflicts = [], convergence, dropped = 0, notices = [], walkthrough, praise, reusedFrom } = input
  const all = [...findings, ...carried]
  const active = all.filter(actionable)
  const counts = Object.fromEntries(Object.keys(icons).map(severity => [severity, active.filter(f => f.severity === severity).length]))
  const lines = []
  if (reusedFrom != null) lines.push(`변경 없음 — R${reusedFrom} 결과를 다시 보여줍니다`)
  lines.push(`판정: ${typeof verdict === 'string' ? verdict : verdict.verdict}    ${Object.entries(icons).map(([severity, icon]) => `${icon} ${counts[severity]}`).join(' · ')}`)
  lines.push(`검증: 확정 ${all.filter(f => f.verification === 'confirmed').length} · 미검증 ${all.filter(f => f.verification === 'unverified').length} · 생략 ${all.filter(f => f.verification === 'skipped').length} · 기각 ${all.filter(f => f.verification === 'refuted').length}`)
  lines.push(...(typeof verdict === 'object' ? verdict.notes ?? [] : []), ...notices)
  if (convergence) lines.push(`이전 회차 대비: 해결 ${convergence.resolved} · 새 문제 ${convergence.fresh} · 충돌 ${convergence.conflicts} · 보류 ${convergence.skipped}${convergence.unchecked ? ` · 미확인 ${convergence.unchecked}` : ''}`)
  if (dropped) lines.push(`범위 밖 ${dropped}건 제외`)
  lines.push('', '## walkthrough', prose(walkthrough))
  if (prose(praise)) lines.push('', '## 잘된 점', prose(praise))
  const important = active.filter(f => ['critical', 'major'].includes(f.severity))
  lines.push('', '## critical / major', ...important.map(f => `- ${icons[f.severity]} ${location(f)} — ${f.title}${f.verification === 'unverified' ? ' (미검증)' : ''}`))
  lines.push('', '## 다음 액션', ...(important.length ? important.map(f => `- ${f.id} ${f.title}`) : ['추가 수정이 필요한 critical / major 발견 없음']))
  const conflictFindings = all.filter(f => f.conflict && !f.folded && f.verification !== 'refuted')
  if (conflictFindings.length) {
    lines.push('', '## 판단 충돌')
    for (const current of conflictFindings) {
      const pair = conflicts.find(pair => pair.newId === current.id)
      const priorId = pair?.priorId ?? current.conflict.priorId
      const prior = pair?.prior ?? all.find(f => f.id === priorId)
      const round = /^R(\d+)-/.exec(priorId)?.[1] ?? '?'
      lines.push(`${priorId} (${round}회차) ${prior ? `${prior.title} — ${prior.tldr ?? ''}` : '이전 판단 상세 없음'} / ${current.id} (이번) ${current.title} — ${current.tldr ?? ''}`)
    }
    lines.push('채택하지 않을 판단은 --skip <id> "메모"로 보류합니다.')
  }
  const folded = all.filter(f => f.folded && f.verification !== 'refuted')
  if (folded.length) lines.push('', `<details><summary>보류 ${folded.length}건</summary>`, '', ...folded.map(f => `- [보류됨 · ${f.folded.byId}] ${f.title} — ${f.folded.memo ?? ''}`), '', '</details>')
  const refuted = all.filter(f => f.verification === 'refuted')
  if (refuted.length) lines.push('', `<details><summary>검증에서 기각된 발견 ${refuted.length}건</summary>`, '', ...refuted.map(f => `- ${location(f)} — ${f.title}\n  기각 근거: ${f.reasons?.[0] ?? '근거 없음'}`), '', '</details>')
  return lines.join('\n')
}

export function renderTerminal(input) {
  const comments = [...(input.findings ?? []), ...(input.carried ?? [])].filter(actionable).map(f => `${location(f)}\n${comment(f)}`)
  return [summary(input), ...comments].join('\n\n')
}

export function buildPayload(input) {
  const active = [...(input.findings ?? []), ...(input.carried ?? [])].filter(actionable)
  const eligible = finding => finding.in_diff !== false
  const base = summary(input)
  const withSkipped = (body, findings) => findings.length ? `${body}\n\n## 인라인 생략된 발견\n\n${findings.map(f => `${location(f)}\n${comment(f)}`).join('\n\n')}` : body
  const payload = (body, comments) => ({ commit_id: input.headRefOid, event: 'COMMENT', body, comments })
  const comments = input.inlineAllowed ? active.filter(eligible).map(f => ({ path: f.loc.path, line: f.loc.line, side: f.loc.side === 'old' ? 'LEFT' : 'RIGHT', body: comment(f) })) : []
  const warning = input.inlineAllowed ? base : base.replace(/(판정:[^\n]*)/, '$1\n⚠ 로컬과 PR head 가 달라 인라인을 생략했다')
  return {
    primary: payload(withSkipped(warning, input.inlineAllowed ? active.filter(f => !eligible(f)) : active), comments),
    fallback: payload(withSkipped(warning, active), []),
  }
}
