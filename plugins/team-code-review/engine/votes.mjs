import { SEVERITY_RANK } from './config.mjs'

// 원래 등급보다 무거운 표는 자른다. 두 표면 무거운 값, 세 표면 가운데 값이다.
export function settleSeverity(original, confirmations) {
  const severities = confirmations
    .map(vote => SEVERITY_RANK[vote.severity] < SEVERITY_RANK[original] ? original : vote.severity)
    .sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])
  return severities.length ? severities[Math.ceil(severities.length / 2) - 1] : original
}

export function settleFinding(raw) {
  const confirmations = raw.votes.filter(vote => vote.verdict === 'confirmed')
  const refutations = raw.votes.filter(vote => vote.verdict === 'refuted')
  let verification = 'unverified'
  if (raw.assigned === 0) {
    // major/critical 의 0명 배정은 검증 상한 초과이므로 미검증으로 남긴다.
    if (raw.severity === 'minor' || raw.severity === 'nit') verification = 'skipped'
  } else if (confirmations.length * 2 > raw.assigned) {
    verification = 'confirmed'
  } else if (refutations.length * 2 > raw.assigned) {
    verification = 'refuted'
  }

  let severity = verification === 'confirmed' ? settleSeverity(raw.severity, confirmations) : raw.severity
  if (raw.dimension === 'test-coverage' && SEVERITY_RANK[severity] < SEVERITY_RANK.major) severity = 'major'

  const reasons = verification === 'confirmed' ? confirmations : verification === 'refuted' ? refutations : raw.votes
  const finding = {
    ...raw,
    id: null,
    severity,
    verification,
    votesText: `${confirmations.length}/${raw.assigned}`,
    reasons: reasons.map(vote => vote.reason),
    fix: raw.fix,
    fixNote: verification === 'unverified' || verification === 'skipped' ? '미검증' : '',
  }
  if (severity !== raw.severity) finding.originalSeverity = raw.severity

  // 안전성은 과반과 별개다. 확인한 검증자 한 명이라도 위험을 찾으면 수정안을 뺀다.
  const unsafe = confirmations.find(vote => vote.fixSafe === false)
  if (unsafe) {
    finding.fix = null
    finding.fixNote = unsafe.reason.trim().match(/^[\s\S]*?(?:[.!?。！？](?=\s|$)|\n|$)/)[0].trim()
  }

  if (raw.priorId && ((raw.assigned === 0 && ['minor', 'nit'].includes(raw.severity)) || (confirmations.length > 0 && confirmations.every(vote => vote.relation === 'round_trip')))) {
    finding.conflict = { priorId: raw.priorId }
  }
  return finding
}
