export const meta = {
  name: 'deep-review',
  description: '4개 차원 코드 리뷰와 발견별 반박 검증 원본 표',
  phases: [
    { title: 'Review', detail: '4개 차원 동시 리뷰' },
    { title: 'Verify', detail: '모드별 검증과 동점 추가 검증' },
  ],
}

// 파일 읽기는 에이전트가 대상 저장소에서 수행한다. 집계는 엔진에 맡긴다.
const a = args
const RANK = { critical: 0, major: 1, minor: 2, nit: 3 }
const SEVERITIES = Object.keys(RANK)
const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array', items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: SEVERITIES },
          loc: { type: 'object', properties: {
            path: { type: 'string' }, oldPath: { type: 'string' },
            side: { type: 'string', enum: ['new', 'old'] }, line: { type: 'integer', minimum: 1 },
          }, required: ['path', 'side', 'line'] },
          title: { type: 'string' }, tldr: { type: 'string' }, good: { type: 'string' }, fix: { type: 'string' },
        }, required: ['severity', 'loc', 'title', 'tldr', 'good', 'fix'],
      },
    },
    walkthrough: { type: 'string' }, praise: { type: 'string' },
  }, required: ['findings', 'walkthrough', 'praise'],
}
const VERDICT_SCHEMA = {
  type: 'object', properties: {
    verdict: { type: 'string', enum: ['confirmed', 'refuted'] },
    severity: { type: 'string', enum: SEVERITIES }, reason: { type: 'string' },
    fixSafe: { type: 'boolean' }, relation: { type: 'string', enum: ['new_problem', 'round_trip'] },
  }, required: ['verdict', 'severity', 'reason', 'fixSafe'],
}
const DIMENSIONS = [
  { key: 'correctness', focus: '로직 오류·조건 반전·off-by-one, 런타임에 깨지는 타입 단언, null 미처리·삼키기, async(await 누락·경쟁·중복 실행), 에러 삼키기·실패가 성공으로 마감되는 경로, 경계값, 숫자·날짜 처리' },
  { key: 'security', focus: '인증·인가 우회, 소유자 확인 누락, 입력 검증·인젝션(SQL·명령·경로·프롬프트), 비밀값 노출·클라이언트로 새는 서버 키, 서명 검증·멱등성 누락, 안전하지 않은 역직렬화·리다이렉트' },
  { key: 'architecture', focus: '레이어·신뢰 경계 위반, 한 곳에 있어야 할 판단의 복제, 기존 유틸이 있는데 새로 만듦, 순수 로직에 I/O 혼입, 결합도' },
  { key: 'test-coverage', focus: '이번 변경이 만든 새 분기·경로·에러 처리에 대응하는 테스트 변경이 있는가. 저장소 전체 커버리지는 보지 않는다.\nJava src/main↔src/test 미러, Python test_x.py·tests/, Node *.test.*·__tests__/ 관례를 인정하라. 테스트 누락 자체의 최고 등급은 major.' },
]
const LENSES = [
  '도달 가능성 — 지적한 조건이 실제 입력과 호출 경로로 발생하는가. 호출부를 거슬러 올라가 확인하라.',
  '이미 막혀 있는가 — 상위 가드, 미들웨어, 권한 검사, 스키마 제약, 타입 시스템이 이 문제를 이미 막고 있지 않은가.',
  '심각도 과장 — 문제가 실재하더라도 실제 피해가 주장한 등급만큼인가. 심각도 기준에 맞춰 다시 매겨라.',
]
const RULES = [
  '빌드·테스트를 실행하지 마라. 파일을 수정하지 마라. 읽기 전용 도구만 사용하라.',
  '시작 전에 CLAUDE.md·AGENTS.md(루트와 변경 파일 상위 디렉터리)를 읽어라. 필수로 표시된 규칙(CRITICAL, MUST, 절대)의 명백한 위반은 critical이다. 문서가 없으면 범용 체크리스트를 적용하라.',
].join('\n')
const SEVERITY_GUIDE = [
  'critical — 배포되면 데이터 유실·보안 사고·과금 사고 또는 필수 규칙의 명백한 위반.',
  'major — 특정 조건에서 사용자가 실제로 겪는 잘못된 결과나 장애.',
  'minor — 유지보수·가독성에 실질적 영향. nit — 취향·스타일.',
].join('\n')
const TARGET = [
  '대상 저장소 루트(작업 디렉터리): ' + a.root,
  'base SHA: ' + a.base,
  '변경 파일과 hunk: ' + JSON.stringify(a.files),
  '리뷰 범위:\n' + a.scopeText,
  '이 루트에서 기준 커밋 대비 git diff 와 작업 트리 변경을 읽어라. untracked 파일도 반드시 직접 열어라. git diff 만으로 새 파일을 누락하지 마라.',
  '변경 줄이 호출하거나 의존하는 기존 코드와 호출부도 읽어 원인을 확인하라.',
  '발견 loc는 원인 변경 줄에 앵커하라. 증상이 나타난 기존 줄 대신 결함을 도입한 변경 줄을 지목하라.',
  'loc.path는 루트 상대 canonical 경로, rename이면 새 경로와 oldPath를 사용한다. 삭제 줄은 side old와 기준 커밋의 줄 번호, 추가 줄은 side new와 현재 줄 번호를 쓴다.',
].join('\n')
function buildPrompt(d) {
  return [
    '너는 코드 리뷰어다. 담당 차원은 하나뿐이다: ' + d.key,
    RULES, '## 리뷰 대상', TARGET, '## 네가 볼 것', d.focus,
    '## 네가 보지 않을 것', '다른 차원(' + ACTIVE.filter(x => x !== d).map(x => x.key).join(', ') + ')은 다른 에이전트가 보고 있다. 네 차원으로 설명할 수 있는 발견만 보고하라.',
    SEVERITY_GUIDE, '## 발견 형식',
    'title: 문제를 명사구 한 줄(40자 안쪽). tldr: 왜 문제이고 언제 터지는지 구체적 조건 한 문장. good: 그 지점의 장점, 없으면 빈 문자열. fix: 적용할 수정 코드, 설명 문장 금지.',
    '## 거짓 양성 금지', '확실하지 않으면 보고하지 마라. 코드를 실제로 읽기 전에 추측으로 보고하지 마라. 가능성만 있으면 빼라. 발견 0건은 정상이다.',
    '## 반환', 'findings는 심각도순. walkthrough는 이 차원의 변경 요약 1~2줄, praise는 잘된 점(없으면 빈 문자열).',
  ].join('\n')
}
function priorFor(f) {
  const matching = (a.priors || []).filter(p => p.authoritative !== false && [p.hunk, p.hunk && p.hunk.paired].some(h => h && h.path === f.loc.path && h.side === f.loc.side && f.loc.line >= h.start && f.loc.line <= h.end))
  return matching.find(p => p.id === f.priorId) || matching[0] || null
}
function verifyPrompt(f, d, lens, prior) {
  return [
    '너는 ' + d.key + ' 발견을 검증하는 반박자다. 리뷰어의 말을 믿지 말고 틀렸음을 코드로 입증하려고 시도하라.',
    RULES, TARGET, '## 검증할 발견', JSON.stringify(f),
    prior ? '이전 회차 판단: ' + prior.id + '\n' + JSON.stringify(prior) + '\nrelation은 이 판단에 대해 new_problem(새 문제) 또는 round_trip(이전 수정의 왕복)을 반환하라.' : '',
    '## 네 검증 관점', lens,
    '호출부, 상위 코드, 설정과 스키마를 따라가라. 실제 코드로 확인한 경우만 confirmed, 틀렸거나 확인할 수 없으면 refuted.',
    SEVERITY_GUIDE, '원래 등급보다 무겁게 매기지 마라. 새 발견은 보고하지 마라.',
    '제안된 수정이 다른 동작을 깨지 않고 안전한지 fixSafe에 기록하라. reason에는 확인한 파일:줄과 근거를 적어라.',
  ].join('\n')
}

// args.dimensions 가 있으면 그 키의 차원만 실행한다. 없거나 일치하는 키가 없으면 전부 실행한다(하위 호환).
const requested = Array.isArray(a.dimensions) ? DIMENSIONS.filter(d => a.dimensions.includes(d.key)) : []
const ACTIVE = requested.length ? requested : DIMENSIONS
let late = false
let noTiebreak = a.tiebreak === false
let tiebreaks = 0
let allocated = 0
let capped = 0
let stop
const deadline = new Promise(resolve => { stop = resolve })
const capTimer = setTimeout(() => { late = true; noTiebreak = true; stop(null) }, a.capSec * 1000)
const tieTimer = setTimeout(() => { noTiebreak = true }, Math.max(0, a.capSec - a.tiebreakMinSec) * 1000)
// 역할별 모델(엔진 config 의 AGENT_MODELS). 없으면 세션 모델을 상속한다.
function withModel(config, role) {
  const model = a.models && a.models[role]
  return model ? { ...config, model } : config
}
async function bounded(prompt, config) {
  if (late) return null
  try { return await Promise.race([Promise.resolve().then(() => agent(prompt, config)), deadline]) }
  catch (error) { log('에이전트 실패 — ' + config.label); return null }
}
async function verifyFinding(f, d, j) {
  const prior = priorFor(f)
  const tagged = { ...f, dimension: d.key, assigned: 0, votes: [], priorId: prior ? prior.id : null }
  const n = a.votes[f.severity]
  if (!n) return tagged
  if (allocated >= a.verifyCap) { capped++; return tagged }
  if (late) return tagged
  allocated++
  tagged.assigned = n
  const schema = prior ? { ...VERDICT_SCHEMA, required: [...VERDICT_SCHEMA.required, 'relation'] } : VERDICT_SCHEMA
  const cast = async (lens, index) => {
    const v = await bounded(verifyPrompt(f, d, lens, prior), withModel({ label: 'verify:' + d.key + '#' + j + '.' + index, phase: 'Verify', schema }, 'verifier'))
    return v ? { ...v, relation: prior ? v.relation : null } : null
  }
  const lenses = n === 1 ? [LENSES.join('\n')] : n === 2 ? [LENSES[0] + '\n' + LENSES[2], LENSES[1] + '\n' + LENSES[2]] : LENSES.slice(0, n)
  tagged.votes = (await parallel(lenses.map((lens, i) => () => cast(lens, i)))).filter(Boolean)
  // 원본 두 표의 동점만 확인한다. 최종 판정·등급 집계는 엔진 책임이다.
  if (n === 2 && tagged.votes.length === 2 && tagged.votes[0].verdict !== tagged.votes[1].verdict && !late && !noTiebreak) {
    tagged.assigned++
    tiebreaks++
    const extra = await cast(LENSES[2], 2)
    if (extra) tagged.votes.push(extra)
  }
  return tagged
}
async function verifyDimension(r, d) {
  if (!r) {
    log('차원 실패 — ' + d.key + ' 는 결과를 내지 못했다. 이 차원은 리뷰되지 않았다.')
    return { key: d.key, failed: true, findings: [], walkthrough: '', praise: '' }
  }
  // Ruling19: 완료된 차원 안에서 정렬한 뒤 공유 상한을 즉시 배정한다.
  // 아직 오지 않은 차원의 발견은 이미 시작한 검증을 선점하지 못한다.
  const raw = (Array.isArray(r.findings) ? r.findings : []).slice().sort((x,y) => RANK[x.severity] - RANK[y.severity])
  const findings = await parallel(raw.map((f,j) => () => verifyFinding(f,d,j)))
  return { key: d.key, failed: false, findings, walkthrough: r.walkthrough || '', praise: r.praise || '' }
}
const omitted = DIMENSIONS.filter(d => !ACTIVE.includes(d))
if (omitted.length) log(omitted.map(d => d.key).join(' · ') + ' 생략 — 작은 변경이라 이 차원은 리뷰하지 않는다.')
log(ACTIVE.length + '개 차원 동시 리뷰: ' + ACTIVE.map(d => d.key).join(' · '))
try {
  const dimensions = await pipeline(ACTIVE,
    d => bounded(buildPrompt(d), withModel({ label: 'review:' + d.key, phase: 'Review', schema: FINDINGS_SCHEMA }, 'reviewer')),
    (r,d) => verifyDimension(r,d))
  if (capped) log('검증 상한으로 ' + capped + '건 미검증')
  return { dimensions, tiebreaks, cutoff: late }
} finally {
  if (typeof clearTimeout === 'function') { clearTimeout(capTimer); clearTimeout(tieTimer) }
}
