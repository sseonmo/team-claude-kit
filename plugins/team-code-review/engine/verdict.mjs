export function computeVerdict({ findings, failedDims, indexOnly }) {
  const counts = { critical: 0, major: 0, minor: 0, nit: 0 }
  for (const finding of findings) {
    if (finding.folded || finding.conflict || finding.verification === 'refuted') continue
    counts[finding.severity] += 1
  }

  const notes = [
    ...failedDims.map(dimension => `⚠ ${dimension} 차원은 실행되지 않았다`),
    ...indexOnly.map(path => `⚠ 커밋될 내용(index)이 리뷰한 내용(작업 트리)과 다르다: ${path}`),
  ]
  let verdict = counts.critical > 0 ? 'Blocked' : counts.major > 0 ? 'Changes Requested' : 'Approve'
  if (verdict === 'Approve' && notes.length > 0) verdict = 'Incomplete'
  return { verdict, counts, notes }
}
