import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, realpathSync, utimesSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeRepo, removeRepo, commit } from './helpers.mjs'

const cli = fileURLToPath(new URL('../engine/cli.mjs', import.meta.url))
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const json = file => JSON.parse(readFileSync(file, 'utf8'))
const text = 'before one\nbefore two\nunsafe()\nafter one\nafter two\n'
const finding = (overrides = {}) => ({ dimension: 'security', severity: 'major', loc: { path: 'a.js', side: 'new', line: 3 }, title: '위험 호출', tldr: '검사 누락', good: '작은 변경', fix: 'validate()', assigned: 2,
  votes: Array.from({ length: 2 }, () => ({ verdict: 'confirmed', severity: 'major', reason: '호출이 노출된다', fixSafe: true, relation: null })), priorId: null, ...overrides })
const workflow = (...findings) => ({ dimensions: [{ key: 'security', failed: false, findings, walkthrough: '호출 검토', praise: '명확한 경계' }], tiebreaks: 0, cutoff: false })

function fixture(t, files = { 'a.js': text.replace('unsafe()', 'safe()') }) {
  const root = realpathSync(makeRepo())
  t.after(() => removeRepo(root))
  if (files !== null) commit(root, files, 'base')
  const metadata = path.join(root, '.git', 'deep-review')
  const bin = path.join(metadata, 'bin')
  mkdirSync(bin, { recursive: true })
  const gh = path.join(bin, 'gh')
  // 테스트에서는 외부 gh/네트워크에 절대 접근하지 않는다.
  writeFileSync(gh, '#!/bin/sh\nprintf "%s\\n" "$*" >> "' + metadata + '/gh-calls"\nif [ -f "' + metadata + '/pr.json" ]; then cat "' + metadata + '/pr.json"; else exit 1; fi\n')
  chmodSync(gh, 0o755)
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` }
  const run = (args, cwd = root, expectedCode = 0) => {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: 'utf8' })
    assert.equal(result.status, expectedCode, result.stderr || result.stdout)
    assert.equal(result.stderr, '')
    return JSON.parse(result.stdout)
  }
  const settle = (result = workflow(finding()), args = []) => {
    const file = path.join(metadata, 'result.json')
    writeFileSync(file, JSON.stringify(result))
    return run(['settle', '--result', file, ...args])
  }
  const change = (name = 'a.js', value = text) => writeFileSync(path.join(root, name), value)
  const record = () => json(path.join(metadata, 'main.json'))
  const pr = () => writeFileSync(path.join(metadata, 'pr.json'), JSON.stringify({ number: 7, baseRefOid: git(root, 'rev-parse', 'main'), headRefOid: git(root, 'rev-parse', 'HEAD') }))
  return { root, metadata, run, settle, change, record, pr }
}

test('대상 없음과 명령 오류는 stdout JSON 한 개다', t => {
  const f = fixture(t)
  assert.equal(f.run(['prepare']).status, 'none')
  assert.match(f.run(['bogus'], f.root, 1).message, /명령/)
  assert.match(f.run(['settle'], f.root, 1).message, /result/)
})

test('상태 조회도 index 를 갱신하지 않는다', t => {
  const f = fixture(t)
  utimesSync(path.join(f.root, 'a.js'), new Date('2001-01-01'), new Date('2001-01-01'))
  const before = readFileSync(path.join(f.root, '.git', 'index'))
  assert.equal(f.run(['prepare']).status, 'none')
  assert.deepEqual(readFileSync(path.join(f.root, '.git', 'index')), before)
})

test('첫 커밋 전 저장소도 리뷰하고 headSha null 로 기록한다', t => {
  const f = fixture(t, null)
  f.change()
  assert.equal(f.run(['prepare']).status, 'run')
  assert.equal(f.settle().verdict, 'Changes Requested')
  assert.equal(f.record().rounds[0].headSha, null)
  assert.equal(f.run(['prepare']).status, 'reuse')
})

test('실패 차원은 Incomplete 로 기록하고 재사용에도 남긴다', t => {
  const f = fixture(t)
  f.change(); f.run(['prepare'])
  const result = f.settle({ dimensions: [{ key: 'architecture', failed: true, findings: [], walkthrough: '', praise: '' }], tiebreaks: 1, cutoff: true })
  assert.equal(result.verdict, 'Incomplete')
  assert.match(result.rendered, /architecture 차원은 실행되지 않았다/)
  assert.match(f.run(['prepare']).reuse.rendered, /architecture 차원은 실행되지 않았다/)
  assert.equal(f.record().rounds[0].result.cutoff, true)
})

test('prepare → settle 은 기록·runs·범위 제외와 workflow 인수를 연결한다', t => {
  const f = fixture(t)
  f.change()
  const prepared = f.run(['prepare', '--deep'])
  assert.equal(prepared.status, 'run')
  assert.equal(prepared.workflowArgs.root, f.root)
  assert.equal(prepared.workflowArgs.mode, 'deep')
  assert.equal(prepared.workflowArgs.capSec, 480)
  assert.equal(prepared.workflowArgs.verifyCap, 16)
  assert.equal(prepared.workflowArgs.votes.major, 3)
  assert.match(prepared.workflowArgs.scopeText, /a.js: 3/)
  assert.equal(prepared.workflowArgs.files[0].path, 'a.js')
  assert.ok(existsSync(prepared.pendingPath))
  const result = f.settle(workflow(finding(), finding({ loc: { path: 'a.js', side: 'new', line: 1 }, title: '범위 밖' })))
  assert.equal(result.verdict, 'Changes Requested')
  assert.equal(result.treeChanged, false)
  assert.match(result.rendered, /범위 밖 1건 제외/)
  assert.match(result.rendered, /호출 검토/)
  assert.equal(f.record().rounds.length, 1)
  assert.equal(f.record().rounds[0].findings.length, 1)
  assert.equal(f.record().rounds[0].findings[0].id, 'R1-1')
  assert.equal(f.record().rounds[0].findings[0].anchor.text, 'unsafe()')
  assert.equal(readFileSync(path.join(f.metadata, 'runs.tsv'), 'utf8').trim().split('\n').length, 2)
})

test('재사용·fresh·파일 수정·skip 재계산·수동 skip 해제를 보존한다', t => {
  const f = fixture(t)
  f.change()
  f.run(['prepare'])
  f.settle()
  assert.equal(f.run(['prepare']).status, 'reuse')
  assert.equal(f.run(['skip', 'R1-1', '나중에']).ok, true)
  const reused = f.run(['prepare'])
  assert.equal(reused.status, 'reuse')
  assert.match(reused.reuse.rendered, /보류됨 · R1-1/)
  assert.match(reused.reuse.rendered, /나중에/)
  assert.match(reused.reuse.rendered, /판정: Approve/)
  const record = f.record()
  record.skips = {}
  writeFileSync(path.join(f.metadata, 'main.json'), JSON.stringify(record))
  assert.match(f.run(['prepare']).reuse.rendered, /판정: Changes Requested/)
  assert.equal(f.record().rounds.length, 1)
  assert.equal(readFileSync(path.join(f.metadata, 'runs.tsv'), 'utf8').trim().split('\n').length, 2)
  assert.equal(f.run(['prepare', '--fresh']).status, 'run')
  f.change('a.js', text + 'x\n')
  assert.equal(f.run(['prepare']).status, 'run')
})

test('skip 없는 id 는 유효 id 를 안내한다', t => {
  const f = fixture(t)
  f.change(); f.run(['prepare']); f.settle()
  const result = f.run(['skip', 'R9-9'])
  assert.equal(result.ok, false)
  assert.match(result.message, /R1-1/)
})

test('작업 트리 변경은 경고를 맨 위에 붙이고 회차·runs 를 늘리지 않는다', t => {
  const f = fixture(t)
  f.change(); f.run(['prepare']); f.settle()
  f.run(['prepare', '--fresh'])
  f.change('a.js', text + 'later()\n')
  const result = f.settle()
  assert.equal(result.treeChanged, true)
  assert.ok(result.rendered.startsWith('⚠ 리뷰 중 작업 트리가 바뀌었다'))
  assert.equal(f.record().rounds.length, 1)
  assert.equal(readFileSync(path.join(f.metadata, 'runs.tsv'), 'utf8').trim().split('\n').length, 2)
})

test('기존 untracked 내용 변경과 index 내용 변경도 treeChanged 다', t => {
  for (const kind of ['untracked', 'index']) {
    const f = fixture(t)
    f.change()
    if (kind === 'untracked') f.change('new.js', 'one\n')
    else git(f.root, 'add', 'a.js')
    f.run(['prepare'])
    if (kind === 'untracked') f.change('new.js', 'two\n')
    else {
      f.change('a.js', text + 'staged\n')
      git(f.root, 'add', 'a.js')
      f.change()
    }
    assert.equal(f.settle().treeChanged, true)
    assert.equal(existsSync(path.join(f.metadata, 'main.json')), false)
  }
})

test('리뷰 중 파일 삭제·줄 축소도 결과와 treeChanged 경고를 반환한다', t => {
  for (const deleted of [true, false]) {
    const f = fixture(t)
    f.change(); f.run(['prepare'])
    if (deleted) unlinkSync(path.join(f.root, 'a.js'))
    else f.change('a.js', 'short\n')
    const result = f.settle()
    assert.equal(result.treeChanged, true)
    assert.ok(result.rendered.startsWith('⚠ 리뷰 중 작업 트리가 바뀌었다'))
    assert.equal(result.verdict, 'Changes Requested')
    assert.equal(existsSync(path.join(f.metadata, 'main.json')), false)
  }
})

test('같은 위치·제목은 높은 심각도로 병합하고 다른 제목은 남긴다', t => {
  const f = fixture(t)
  f.change(); f.run(['prepare'])
  f.settle(workflow(finding(), finding({ dimension: 'architecture', severity: 'minor', assigned: 0, votes: [] }), finding({ title: '다른 결함' })))
  const findings = f.record().rounds[0].findings
  assert.equal(findings.length, 2)
  assert.equal(findings.find(item => item.title.startsWith('위험 호출')).severity, 'major')
  assert.equal(findings.find(item => item.title.startsWith('위험 호출')).title, '위험 호출 (security · architecture)')
})

test('하위 cwd 경로와 개행·한글 untracked 파일명을 처리한다', t => {
  const f = fixture(t, { 'src/a/base.js': 'base\n' })
  f.change('src/a/한글\n파일.js', 'new\n')
  const result = f.run(['prepare', 'a/'], path.join(f.root, 'src'))
  assert.deepEqual(result.workflowArgs.files.map(file => file.path), ['src/a/한글\n파일.js'])
})

test('detached HEAD 는 기록과 runs 를 쓰지 않는다', t => {
  const f = fixture(t)
  git(f.root, 'checkout', '--detach', '-q')
  f.change(); f.run(['prepare'])
  const result = f.settle()
  assert.match(result.rendered, /detached HEAD/)
  assert.equal(existsSync(path.join(f.metadata, 'main.json')), false)
  assert.equal(existsSync(path.join(f.metadata, 'runs.tsv')), false)
})

test('파일 diff 가 없어도 index 전용 변경은 Incomplete 다', t => {
  const f = fixture(t)
  f.change(); git(f.root, 'add', 'a.js'); f.change('a.js', text.replace('unsafe()', 'safe()'))
  const prepared = f.run(['prepare'])
  assert.equal(prepared.status, 'run')
  assert.deepEqual(prepared.workflowArgs.files, [])
  const result = f.settle(workflow())
  assert.equal(result.verdict, 'Incomplete')
  assert.match(result.rendered, /index/)
})

test('PR 없는 --comment 도 로컬 리뷰하며 PR 생성·fetch 는 없다', t => {
  const f = fixture(t)
  f.change()
  assert.equal(f.run(['prepare', '--comment']).status, 'run')
  const result = f.settle()
  assert.equal(result.verdict, 'Changes Requested')
  assert.match(result.rendered, /PR.*없/)
  assert.equal(result.payloadPath, undefined)
  const calls = readFileSync(path.join(f.metadata, 'gh-calls'), 'utf8')
  assert.match(calls, /^pr view /)
  assert.doesNotMatch(calls, /create|fetch/)
})

test('재사용 + comment 는 현재 HEAD 로 payload 를 다시 만들고 skip 을 반영한다', t => {
  const f = fixture(t)
  git(f.root, 'checkout', '-q', '-b', 'feature')
  commit(f.root, { 'a.js': text }, 'feature')
  f.pr()
  f.run(['prepare', '--comment'])
  const first = f.settle()
  assert.equal(json(first.payloadPath).comments.length, 1)
  assert.equal(json(first.fallbackPath).comments.length, 0)
  writeFileSync(first.payloadPath, '{"stale": true}')
  // 범위 밖 파일이 dirty 여도 대상 diff/HEAD 는 같다. 인라인 가능 여부는 다시 계산한다.
  f.change('unrelated.txt', 'local\n')
  // 대상 경로를 고정하여 unrelated 변경을 리뷰 범위에서 뺀다.
  const fresh = f.run(['prepare', '--comment', '--fresh', 'a.js'])
  assert.equal(fresh.status, 'run')
  f.settle()
  const reused = f.run(['prepare', '--comment', 'a.js'])
  assert.equal(reused.status, 'reuse')
  assert.equal(json(reused.reuse.payloadPath).commit_id, git(f.root, 'rev-parse', 'HEAD'))
  assert.equal(json(reused.reuse.payloadPath).comments.length, 0)
  f.run(['skip', 'R2-1', '검토 완료'])
  const skipped = f.run(['prepare', '--comment', 'a.js'])
  assert.match(json(skipped.reuse.payloadPath).body, /검토 완료/)
  assert.doesNotMatch(json(skipped.reuse.payloadPath).body, /## 인라인 생략된 발견/)
  const stored = json(path.join(f.metadata, 'feature.json'))
  assert.equal(stored.rounds.length, 2)
})

test('PR head 가 바뀐 재사용은 최신 commit_id 와 인라인 조건을 사용한다', t => {
  const f = fixture(t)
  git(f.root, 'checkout', '-q', '-b', 'feature')
  commit(f.root, { 'a.js': text }, 'feature'); f.pr()
  f.run(['prepare', '--comment']); const first = f.settle()
  const remoteHead = 'a'.repeat(40)
  const prFile = path.join(f.metadata, 'pr.json')
  writeFileSync(prFile, JSON.stringify({ ...json(prFile), headRefOid: remoteHead }))
  writeFileSync(first.payloadPath, '{"stale": true}')
  const result = f.run(['prepare', '--comment'])
  assert.equal(result.status, 'reuse')
  assert.equal(json(result.reuse.payloadPath).commit_id, remoteHead)
  assert.equal(json(result.reuse.payloadPath).comments.length, 0)
})

test('리뷰 중 clean PR head 로 이동해도 오래된 좌표를 인라인하지 않는다', t => {
  const f = fixture(t)
  git(f.root, 'checkout', '-q', '-b', 'feature')
  commit(f.root, { 'a.js': text }, 'commit A'); f.pr()
  f.run(['prepare', '--comment'])
  const currentHead = commit(f.root, { 'a.js': 'prefix\n' + text }, 'commit B')
  assert.equal(git(f.root, 'status', '--porcelain'), '')
  const result = f.settle(workflow(finding()), ['--head-ref-oid', currentHead])
  assert.equal(result.treeChanged, true)
  assert.ok(result.rendered.startsWith('⚠ 리뷰 중 작업 트리가 바뀌었다'))
  const payload = json(result.payloadPath)
  assert.equal(payload.commit_id, currentHead)
  assert.deepEqual(payload.comments, [])
  assert.match(payload.body, /⚠ 리뷰 중 작업 트리가 바뀌었다/)
  assert.match(payload.body, /위험 호출/)
  assert.match(payload.body, /validate\(\)/)
  assert.match(json(result.fallbackPath).body, /⚠ 리뷰 중 작업 트리가 바뀌었다/)
  assert.equal(existsSync(path.join(f.metadata, 'feature.json')), false)
  assert.equal(existsSync(path.join(f.metadata, 'runs.tsv')), false)
})

test('실제 old 기각·new 채택 회차는 반대편 왕복을 접고 채택 코드 변경 시 푼다', t => {
  const f = fixture(t)
  f.change(); f.run(['prepare'])
  f.settle(workflow(finding({ title: '이전 코드 제거', loc: { path: 'a.js', side: 'old', line: 3 } })))
  const next = f.run(['prepare', '--fresh'])
  assert.deepEqual(next.workflowArgs.priors[0].hunk.paired, { path: 'a.js', side: 'new', start: 1, end: 5 })
  const roundTrip = (overrides = {}) => finding({ priorId: 'R1-1', title: '새 코드 유지', votes: finding().votes.map(vote => ({ ...vote, relation: 'round_trip' })), ...overrides })
  const conflict = f.settle(workflow(roundTrip()))
  assert.equal(conflict.verdict, 'Approve')
  assert.deepEqual(f.record().rounds[1].conflicts, [{ newId: 'R2-1', priorId: 'R1-1' }])
  assert.equal(f.run(['skip', 'R1-1', '새 코드 채택']).ok, true)
  assert.equal(f.record().skips['R1-1'].adopted, 'R2-1')
  f.run(['prepare', '--fresh'])
  const reversed = roundTrip({ priorId: 'R2-1', title: '이전 코드 복원', loc: { path: 'a.js', side: 'old', line: 3 } })
  const folded = f.settle(workflow(reversed))
  assert.match(folded.rendered, /보류됨 · R1-1/)
  assert.deepEqual(f.record().rounds[2].conflicts, [])
  assert.equal(f.record().skips['R1-1'].snapshot.text, 'unsafe()')
  f.run(['prepare', '--fresh']); f.settle(workflow())
  const carried = f.record().rounds[3].findings
  assert.equal(carried.length, 1)
  assert.equal(carried[0].id, 'R1-1')
  assert.equal(carried[0].loc.side, 'new')
  assert.equal(carried[0].anchor.text, 'unsafe()')
  f.change('a.js', text.replace('unsafe()', 'different()'))
  f.run(['prepare']); f.settle(workflow(reversed))
  assert.equal(f.record().skips['R1-1'], undefined)
  assert.equal(f.record().rounds[4].findings[0].folded, undefined)
  assert.deepEqual(f.record().rounds[4].conflicts, [{ newId: 'R5-1', priorId: 'R2-1' }])
})

test('실제 이전 회차 anchor 는 prior hunk·충돌 상세·보류·변경 해제를 연결한다', t => {
  const f = fixture(t)
  f.change(); f.run(['prepare']); f.settle()
  const second = f.run(['prepare', '--fresh'])
  assert.equal(second.workflowArgs.priors[0].id, 'R1-1')
  assert.deepEqual(second.workflowArgs.priors[0].hunk, { path: 'a.js', side: 'new', start: 1, end: 5,
    paired: { path: 'a.js', side: 'old', start: 1, end: 5 } })
  const reversed = finding({ title: '검사 제거', tldr: '기존 판단 반대', priorId: 'R1-1', votes: finding().votes.map(v => ({ ...v, relation: 'round_trip' })) })
  const conflict = f.settle(workflow(reversed))
  assert.match(conflict.rendered, /R1-1 \(1회차\) 위험 호출 — 검사 누락/)
  assert.equal(conflict.verdict, 'Approve')
  assert.equal(f.run(['skip', 'R2-1', '기존 검사 채택']).ok, true)
  f.run(['prepare', '--fresh'])
  const folded = f.settle(workflow(reversed))
  assert.match(folded.rendered, /보류됨 · R2-1/)
  assert.equal(folded.verdict, 'Approve')
  assert.equal(f.record().skips['R2-1'].snapshot.text, 'unsafe()')
  f.change('a.js', text.replace('unsafe()', 'different()'))
  assert.equal(f.run(['prepare']).workflowArgs.priors.some(prior => prior.id === 'R2-1'), true)
  f.settle(workflow(finding()))
  assert.equal(f.record().skips['R2-1'], undefined)
})

test('rename old 쪽 anchor 는 canonical 새 경로 대신 이전 base 경로를 읽는다', t => {
  const f = fixture(t)
  git(f.root, 'mv', 'a.js', 'renamed.js')
  f.change('renamed.js', text)
  const prepared = f.run(['prepare'])
  assert.equal(prepared.workflowArgs.files[0].status, 'R')
  f.settle(workflow(finding({ loc: { path: 'renamed.js', oldPath: 'a.js', side: 'old', line: 3 } })))
  assert.equal(f.record().rounds[0].findings[0].anchor.text, 'safe()')
  const repeated = f.run(['prepare', '--fresh'])
  assert.equal(repeated.workflowArgs.priors[0].hunk.path, 'renamed.js')
  assert.equal(repeated.workflowArgs.priors[0].loc.side, 'old')
})
