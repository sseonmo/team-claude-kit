// 루프의 판정. 순수 함수만 둔다 — 같은 측정이면 같은 판정이 나와야 테스트할 수 있고,
// LLM 이 결과를 해석할 여지가 없다.
//
// 측정 결과 모양 (측정기가 돌려준다):
//   { score, units: [{ id, score, guards: { 이름: 수치 } }], opportunities: [{ id, savings, units }] }
// guards 는 "기준선보다 낮아지면 안 되는 수치" 다. 이름은 측정기만 안다.
// direction 'higher' 면 score 가 클수록, 'lower' 면 작을수록 좋다.

export function guardDrops(best, m) {
  const drops = []
  for (const b of best.units) {
    const c = m.units.find((u) => u.id === b.id)
    if (!c) {
      drops.push(`${b.id}:missing`)
      continue
    }
    for (const [g, v] of Object.entries(b.guards)) {
      if (c.guards[g] < v) drops.push(`${b.id}:${g} ${v}→${c.guards[g]}`)
    }
  }
  return drops
}

export function minGuard(m) {
  const all = m.units.flatMap((u) => Object.values(u.guards))
  return all.length ? Math.min(...all) : null
}

// 표시용. 판정은 반올림 전 차이로 한다.
const round2 = (n) => Math.round(n * 100) / 100
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`)

export function decide(best, candidates, { thresholds, direction }) {
  const sign = direction === 'lower' ? -1 : 1
  const bestScore = best.measurement.score
  const results = candidates.map((c) => {
    const base = { id: c.id, hypothesis: c.hypothesis, branch: c.branch, description: c.description }
    if (c.status === 'nochange') return { ...base, status: 'discard', score: null, reason: c.reason }
    if (c.status !== 'measured') return { ...base, status: c.status, score: null, reason: c.reason }

    const score = c.measurement.score
    const drops = guardDrops(best.measurement, c.measurement)
    if (drops.length) return { ...base, status: 'discard', score, reason: 'guard ' + drops.join(', ') }

    const gain = sign * (score - bestScore)
    if (gain < thresholds.minGain - 1e-9) return { ...base, status: 'discard', score, gain, reason: `gain ${signed(round2(gain))} < ${thresholds.minGain}` }
    return { ...base, status: 'eligible', score, gain, reason: `gain ${signed(round2(gain))}` }
  })

  const eligible = results.filter((r) => r.status === 'eligible')
  const winner = eligible.reduce((w, r) => (w && w.gain >= r.gain ? w : r), null)
  for (const r of results) {
    if (r.status === 'eligible') {
      if (r === winner) r.status = 'keep'
      else Object.assign(r, { status: 'outcompeted', reason: `${r.reason}, ${winner.id} 에 밀림` })
    }
    delete r.gain
  }
  return { winner: winner ? winner.id : null, results }
}

const FAILED = new Set(['discard', 'crash', 'scope', 'gate'])

// keep 된 가설도 다시 고른다. 가장 큰 진단은 한 번의 최소 변경으로 다 해소되지 않는다.
export function pickHypotheses(opportunities, history, n) {
  const fails = {}
  for (const h of history) if (FAILED.has(h.status)) fails[h.hypothesis] = (fails[h.hypothesis] ?? 0) + 1

  return opportunities
    .filter((o) => (fails[o.id] ?? 0) < 2)
    .sort((a, b) => b.savings - a.savings || a.id.localeCompare(b.id))
    .slice(0, n)
}

export function shouldStop(bestScore, history, { thresholds, direction }) {
  const { target, stallRounds, maxRounds } = thresholds
  if (target != null && (direction === 'lower' ? bestScore <= target : bestScore >= target)) return { stop: true, reason: 'target' }

  // 라운드 = (run, round) 쌍. round 0 은 기준선이라 세지 않는다.
  const rounds = new Map()
  for (const h of history) {
    if (h.round === 0) continue
    const key = `${h.run}:${h.round}`
    rounds.set(key, (rounds.get(key) ?? false) || h.status === 'keep')
  }
  const ordered = [...rounds.entries()]
    .sort(([a], [b]) => {
      const [ar, an] = a.split(':').map(Number)
      const [br, bn] = b.split(':').map(Number)
      return ar - br || an - bn
    })
    .map(([, kept]) => kept)

  if (ordered.length >= maxRounds) return { stop: true, reason: 'max-rounds' }
  const tail = ordered.slice(-stallRounds)
  if (tail.length === stallRounds && tail.every((k) => !k)) return { stop: true, reason: 'stall' }
  return { stop: false, reason: '' }
}

const COLUMNS = ['run', 'round', 'candidate', 'hypothesis', 'score', 'minGuard', 'status', 'commit', 'description']
export const TSV_HEADER = COLUMNS.join('\t')

const clean = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ')

export function formatRow(row) {
  return COLUMNS.map((c) => (row[c] === null ? '' : clean(row[c]))).join('\t')
}

const num = (s) => (s === '' ? null : Number(s))

export function parseHistory(text) {
  return text
    .split('\n')
    .slice(1)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const v = line.split('\t')
      return {
        run: Number(v[0]),
        round: Number(v[1]),
        candidate: v[2],
        hypothesis: v[3],
        score: num(v[4]),
        minGuard: num(v[5]),
        status: v[6],
        commit: v[7],
        description: v[8] ?? '',
      }
    })
}
