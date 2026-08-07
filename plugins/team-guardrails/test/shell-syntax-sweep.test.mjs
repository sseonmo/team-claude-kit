// 셸 문법 구문별 일제 점검.
//
// v0.1.0~0.1.3 은 네 번 연속으로 "테스트 전부 통과" 상태에서 결함을 내보냈다.
// 매번 그 **형태 자체가** 테스트에 없었기 때문이다. 그래서 룰별 테스트와 별개로,
// 셸 문법을 구문 종류로 나눠 한 표에 세워 둔다. 파서를 건드리면 이 표가 먼저 깨진다.
//
// 기대값 세 가지:
//   deny — 막아야 한다
//   pass — 통과해야 한다 (오탐 방지선)
//   leak — 통과가 **정상**이다. 정적 판정의 원리적 한계이며 의도된 동작이다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check as d1 } from '../lib/rules/d1-rm-rf.mjs'
import { check as d3 } from '../lib/rules/d3-force-push.mjs'

const ctx = { cwd: '/Users/tester/proj', home: '/Users/tester' }
const verdict = (command) => {
  const r = d1('Bash', { command }, ctx) || d3('Bash', { command }, ctx)
  return r ? r.decision : 'pass'
}

const sweep = (title, cases) =>
  test(`문법 점검 — ${title}`, () => {
    for (const [command, want] of cases) {
      const expected = want === 'leak' ? 'pass' : want
      assert.equal(verdict(command), expected, `${want}: ${JSON.stringify(command)}`)
    }
  })

sweep('명령 치환 · 백틱', [
  ['rm -rf $(cat list.txt)', 'leak'],
  ['rm -rf `pwd`/dist', 'leak'],
  ['cd $(pwd)/sub && rm -rf dist', 'pass'],
  ['cd "$(git rev-parse --show-toplevel)" && rm -rf dist', 'pass'],
])

sweep('리다이렉션 변형', [
  ['rm -rf dist > /dev/null 2>&1', 'pass'],
  ['rm -rf dist 2>>build.log', 'pass'],
  ['rm -rf dist >| out.txt', 'pass'],
  ['rm -rf dist &>> all.log', 'pass'],
  ['rm -rf dist 1>&2', 'pass'],
  ['git push origin main > /dev/null 2>&1', 'pass'],
  // 리다이렉션이 껴 있어도 진짜 대상은 여전히 본다
  ['rm -rf > /dev/null /etc', 'deny'],
  ['rm -rf /etc 2>/dev/null', 'deny'],
])

sweep('파이프 · 백그라운드', [
  ['find . -name x | xargs rm -rf', 'leak'],
  ['ls |& grep x; rm -rf dist', 'pass'],
  ['cd /tmp |& cat; rm -rf dist', 'pass'],
  ['npm run dev & rm -rf dist', 'pass'],
  ['echo start | rm -rf /', 'deny'],
])

sweep('경로 정규화', [
  ['rm -rf /etc/', 'deny'],
  ['rm -rf //', 'deny'],
  ['rm -rf /../', 'deny'],
  ['rm -rf --no-preserve-root /', 'deny'],
  ['rm -rf ~root', 'leak'],
  ['rm -rf ./dist/', 'pass'],
  ['rm -rf packages/a/../b/tmp', 'pass'],
])

sweep('줄바꿈 · 줄 연속', [
  ['echo a\nrm -rf /', 'deny'],
  ['rm -rf \\\n  /etc', 'deny'],
  ['cd /tmp\nrm -rf junk', 'deny'],
])

sweep('인용부호', [
  ['rm -rf "/etc"', 'deny'],
  ["rm -rf '/etc'", 'deny'],
  ['rm -rf "$HOME/Documents"', 'deny'],
  ['rm -rf "my dist"', 'pass'],
  ['rm -rf "abc', 'pass'], // 닫히지 않은 따옴표 — 죽지 않고 통과
  ['echo "rm -rf /"', 'pass'],
  ['git commit -m "git push --force 관련"', 'pass'],
])

sweep('서브셸 스코프', [
  ['(rm -rf /)', 'deny'],
  ['(cd /tmp && rm -rf junk)', 'deny'],
  ['(a && (rm -rf /))', 'deny'],
  ['cd /tmp; (rm -rf dist)', 'deny'],
  ['(cd /tmp) && rm -rf dist', 'pass'],
  ['(cd ../x && npm i) && (rm -rf dist)', 'pass'],
  ['(cd /tmp && tar xzf a.tgz) && rm -rf dist', 'pass'],
])

// 0.1.4 의 회귀 3건이 전부 이 두 축에서 나왔다 — 그때 이 표에 없던 축이다.
sweep('서브셸 × 알 수 없는 기준', [
  ['cd - && (rm -rf ../x)', 'pass'],
  ['cd $UNKNOWN && (rm -rf ../x)', 'pass'],
  ['cd - && rm -rf ../x', 'pass'],
  ['cd /tmp; ( (rm -rf junk) )', 'deny'],
  ['cd /tmp && ( ( (rm -rf junk) ) )', 'deny'],
])

sweep('조건문 · 반복문 안의 cd', [
  ['if false; then cd /tmp; fi; rm -rf dist', 'pass'],
  ['for d in a; do cd /tmp; done; rm -rf dist', 'pass'],
  ['while cd /tmp; do ls; done; rm -rf dist', 'pass'],
  // 조건부여도 삭제 자체는 본다
  ['if [ -d dist ]; then rm -rf /; fi', 'deny'],
  // 언제나 실행되는 것들은 기준을 바꾼다
  ['time cd /tmp && rm -rf junk', 'deny'],
  ['! cd /tmp; rm -rf junk', 'deny'],
  // 브레이스 그룹은 즉시 실행인지 함수 정의 본문인지 알 수 없다
  ['{ cd /tmp; }; rm -rf junk', 'leak'],
  ['cleanup() { cd /tmp; }\nrm -rf node_modules', 'pass'],
  ['deploy() {\n  cd /opt\n}\nrm -rf dist', 'pass'],
  // 건너뛴 cd 뒤의 상대경로는 기준을 모른다
  ['if [ -d packages/app ]; then\n  cd packages/app\n  rm -rf ../shared/node_modules\nfi', 'pass'],
])

// 여러 줄로 쓰면 본문 줄에 키워드가 없다. 0.1.5 의 회귀가 이 축에서 나왔다.
sweep('여러 줄 스크립트', [
  ['if [ -d /tmp/c ]; then\n  cd /tmp\nfi\nrm -rf node_modules', 'pass'],
  ['for d in a b; do\n  cd /tmp\ndone\nrm -rf dist', 'pass'],
  ['while true; do\n  cd /tmp\ndone\nrm -rf .next', 'pass'],
  ['if [ -d x ]; then\n  rm -rf /\nfi', 'deny'],
  ['for d in a; do\n  rm -rf ~\ndone', 'deny'],
  ['if [ -d x ]; then\n  ls\nfi\ncd /tmp\nrm -rf junk', 'deny'],
])

sweep('명령 앞에 붙는 것들', [
  ['sudo rm -rf /', 'deny'],
  ['{ sudo rm -rf /; }', 'deny'],
  ['DEBUG=1 rm -rf /', 'deny'],
  ['env FOO=1 rm -rf /', 'deny'],
  ['if [ -d dist ]; then rm -rf /; fi', 'deny'],
  ['for f in a b; do rm -rf /; done', 'deny'],
  ['{ git push -f; }', 'deny'],
  ['DEBUG=1 git push -f', 'deny'],
  // 접두어가 인자로 등장하면 벗기지 않는다
  ['echo sudo rm -rf /', 'pass'],
  ['rm -rf time', 'pass'],
  ['sudo -u root rm -rf /', 'leak'], // 값을 받는 sudo 플래그는 다루지 않는다
])
