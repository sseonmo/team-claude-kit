export const meta = {
  name: 'perf-loop',
  description: '측정 기반 최적화 루프 한 회차 — 라운드마다 후보 여러 개를 만들고 기준선보다 나은 최고 1개만 keep',
  whenToUse: '/perf-loop 스킬이 사전 점검과 기준 화면 확인을 마친 뒤 scriptPath 로 호출',
  phases: [
    { title: 'Baseline', detail: '현재 최고 커밋 재측정' },
    { title: 'Round', detail: '후보 병렬 → 직렬 측정 → 최고만 keep' },
  ],
}

// 이 스크립트는 셸·파일 접근이 없다. 측정·판정·git 은 전부 엔진 round.mjs 가 하고,
// 측정 에이전트는 그 출력(JSON)을 그대로 돌려줄 뿐이다. 판정을 LLM 이 하지 않게 하려는 것이다.
//
// args: { bench, engine, guide, allow: [glob], candidates, rounds?, run? }
//   bench  벤치 worktree 절대 경로      engine  플러그인 루트 절대 경로
//   guide  후보 지침 (벤치 기준 상대 경로) allow   scope.allow — 후보 프롬프트에 보여주기만 한다(검사는 엔진)
const a = typeof args !== 'undefined' && args ? args : {}
for (const k of ['bench', 'engine', 'guide', 'allow', 'candidates']) {
  if (a[k] == null) throw new Error(`args.${k} 가 필요하다 — /perf-loop 스킬로 실행하라`)
}
let RUN = a.run || null
const BENCH = a.bench
const ROUND_JS = `${a.engine}/engine/round.mjs`
const ROUNDS = a.rounds || 2
const IDS = 'ABCDEFGH'.slice(0, a.candidates).split('')

const MEASURE_SCHEMA = {
  type: 'object',
  properties: { stdout: { type: 'string', description: '마지막 wait 출력 JSON 한 줄, 가공 없이 그대로' } },
  required: ['stdout'],
}
const CAND_SCHEMA = {
  type: 'object',
  properties: {
    committed: { type: 'boolean', description: '지정 브랜치에 커밋했는가' },
    summary: { type: 'string', description: '무엇을 왜 바꿨는지 한 줄' },
  },
  required: ['committed', 'summary'],
}

// round.mjs 의 encodeCandidates 와 같은 규칙. 스크립트는 import 할 수 없어 다시 둔다.
const encode = (list) =>
  encodeURIComponent(JSON.stringify(list)).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())

function measurePrompt(name, cliArgs) {
  const out = `.perf-loop/.local/run${RUN ?? '-next'}-${name}.json`
  return [
    `성능 루프의 측정 단계를 실행하고 결과를 그대로 돌려준다. 해석·요약·재시도 금지.`,
    ``,
    `1. 실행 (Bash, 한 번만):`,
    `   cd ${BENCH} && mkdir -p .perf-loop/.local && rm -f ${out} && nohup node ${ROUND_JS} ${cliArgs} --out ${out} > ${out}.log 2>&1 &`,
    `2. 대기: 아래를 반복한다. 출력이 {"pending":true} 이면 같은 명령을 다시 실행한다. 한 번에 최대 9분 걸리므로 Bash 도구의 timeout 파라미터를 600000(10분)으로 설정해 실행한다. 기본값(2분)이면 중간에 끊긴다.`,
    `   cd ${BENCH} && node ${ROUND_JS} wait --out ${out} --max 540`,
    `   출력 없이 timeout 으로 끊기면 같은 wait 명령을 그대로 다시 실행한다(out 파일을 읽기만 하므로 안전하며, 1번을 두 번 실행하지 말라는 규칙과 무관하다).`,
    `3. pending 이 아닌 출력이 나오면 그 JSON 한 줄을 stdout 필드에 그대로 담아 반환한다.`,
    ``,
    `규칙: 1번 명령을 두 번 실행하지 않는다(측정이 겹치면 점수가 흔들린다). 파일·브랜치를 고치지 않는다.`,
    `120분이 지나도 끝나지 않으면 stdout 에 {"ok":false,"error":"timeout — ${out}.log 확인"} 을 담아 반환한다.`,
  ].join('\n')
}

// 후보 worktree 는 벤치 저장소에서 직접 만든다. Workflow 의 isolation: 'worktree' 는 세션 cwd 저장소에
// 만들어지므로, 세션이 다른 저장소에 있으면 후보가 엉뚱한 저장소에서 일한다.
function candidatePrompt(c, bestCommit) {
  const dir = `${BENCH}/../cand/${c.branch.replace(/\//g, '-')}`
  return [
    `성능 지표를 개선하는 후보 변경 하나를 만든다.`,
    ``,
    `겨냥할 가설: \`${c.id_}\` — 예상 절감 ${c.savings}, 해당 대상 ${c.units.join(', ')}`,
    ``,
    `1. 작업 디렉터리 만들기 (Bash):`,
    `   git -C ${BENCH} worktree remove --force ${dir} 2>/dev/null; git -C ${BENCH} worktree add -q -b ${c.branch} ${dir} ${bestCommit}`,
    `   이후 모든 읽기·수정·git 명령은 ${dir} 안에서만 한다(절대 경로로). 세션의 현재 디렉터리는 다른 저장소일 수 있다 — 건드리지 않는다.`,
    `2. ${dir}/${a.guide} 를 읽고 그 규칙대로 수정한다. 고칠 수 있는 경로는 다음뿐이다(밖을 건드리면 측정 없이 탈락):`,
    ...a.allow.map((g) => `   - ${g}`),
    `3. git -C ${dir} add -A && git -C ${dir} commit -q -m "perf: <한 줄 요약>" — 브랜치 ${c.branch} 에 커밋 1개.`,
    `4. 끝나면 git -C ${BENCH} worktree remove --force ${dir} (브랜치는 남는다).`,
    `5. push 하지 않는다. 빌드·테스트·측정은 돌리지 않는다 — 측정은 다른 곳에서 결정론적으로 한다.`,
    ``,
    `고칠 만한 것이 없다고 판단하면 커밋하지 말고 committed=false 와 이유를 반환한다.`,
  ].join('\n')
}

async function step(label, name, cliArgs) {
  const r = await agent(measurePrompt(name, cliArgs), { label, phase: label === 'measure:baseline' ? 'Baseline' : 'Round', schema: MEASURE_SCHEMA, effort: 'low' })
  if (!r) return { ok: false, error: '측정 에이전트가 결과 없이 끝났다' }
  try {
    return JSON.parse(r.stdout)
  } catch {
    return { ok: false, error: `측정 출력이 JSON 이 아니다: ${String(r.stdout).slice(0, 200)}` }
  }
}

const summary = { run: RUN, aborted: null, stop: null, bestScore: null, rounds: [] }

phase('Baseline')
let s = await step('measure:baseline', 'base', RUN ? `baseline --run ${RUN}` : 'baseline')
if (s.ok && s.run) {
  RUN = s.run
  summary.run = RUN
}

for (let r = 1; s.ok && r <= ROUNDS; r++) {
  if (s.stop.stop) break
  if (!s.hypotheses.length) {
    s = { ...s, stop: { stop: true, reason: 'no-hypotheses' } }
    break
  }

  phase('Round')
  const cands = s.hypotheses.slice(0, IDS.length).map((h, i) => ({
    id_: h.id, savings: h.savings, units: h.units, id: IDS[i], branch: `perf/cand/run${RUN}-r${r}-${IDS[i].toLowerCase()}`,
  }))
  log(`run ${RUN} round ${r}: ${cands.map((c) => `${c.id}=${c.id_}`).join(' ')} (현재 ${s.bestScore})`)

  const bestCommit = s.bestCommit
  const outs = await parallel(cands.map((c) => () =>
    agent(candidatePrompt(c, bestCommit), { label: `cand:${r}:${c.id}:${c.id_}`, phase: 'Round', schema: CAND_SCHEMA })))

  const list = cands.map((c, i) => ({
    id: c.id, hypothesis: c.id_, branch: c.branch,
    description: outs[i] ? outs[i].summary : '후보 에이전트 실패',
  }))
  s = await step(`measure:round${r}`, `r${r}`, `evaluate --run ${RUN} --round ${r} --candidates ${encode(list)}`)
  if (s.ok) {
    summary.rounds.push({ round: r, winner: s.winner, results: s.results })
    log(`round ${r}: ${s.winner ? `keep ${s.winner} → ${s.bestScore}` : 'keep 없음'}`)
  }
}

if (!s.ok) summary.aborted = s.error ?? '예상 밖 출력: ' + JSON.stringify(s).slice(0, 200)
else {
  summary.stop = s.stop
  summary.bestScore = s.bestScore
}
return summary
