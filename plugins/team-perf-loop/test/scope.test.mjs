// node --test plugins/team-perf-loop/test/*.test.mjs
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { globToRegExp, checkPaths } from '../engine/scope.mjs'

describe('globToRegExp', () => {
  const m = (glob, p) => globToRegExp(glob).test(p)

  test('* 는 / 를 넘지 않는다', () => {
    assert.ok(m('src/*.ts', 'src/a.ts'))
    assert.ok(!m('src/*.ts', 'src/x/a.ts'))
  })

  test('** 는 / 를 넘는다', () => {
    assert.ok(m('public/**', 'public/a/b.webp'))
    assert.ok(m('src/main/resources/templates/**', 'src/main/resources/templates/index.html'))
  })

  test('중간의 **/ 는 0개 이상의 디렉터리 — src/app/page.tsx 도 맞는다', () => {
    assert.ok(m('src/app/**/page.tsx', 'src/app/page.tsx'))
    assert.ok(m('src/app/**/page.tsx', 'src/app/(app)/dashboard/page.tsx'))
    assert.ok(!m('src/app/**/page.tsx', 'src/app/(app)/dashboard/route.ts'))
  })

  test('앞의 **/ 는 루트 파일도 맞는다', () => {
    assert.ok(m('**/*.test.*', 'Foo.test.tsx'))
    assert.ok(m('**/*.test.*', 'src/components/Foo.test.tsx'))
    assert.ok(m('**/.env*', '.env.local'))
  })

  test('? 는 / 가 아닌 한 글자, 정규식 특수문자는 글자 그대로', () => {
    assert.ok(m('a?.ts', 'ab.ts'))
    assert.ok(!m('a?.ts', 'a/.ts'))
    assert.ok(m('src/(app)/x+y.ts', 'src/(app)/x+y.ts'))
    assert.ok(!m('next.config.ts', 'nextXconfig.ts'))
  })

  test('전체 일치만 — 접두어 일치는 아니다', () => {
    assert.ok(!m('package.json', 'sub/package.json'))
    assert.ok(!m('src/lib', 'src/lib/a.ts'))
  })
})

describe('checkPaths', () => {
  const scope = {
    allow: ['src/components/**', 'src/app/**/page.tsx', 'next.config.ts', 'public/**'],
    deny: ['**/*.test.*', 'package.json'],
  }

  test('허용만 있으면 통과', () => {
    assert.deepEqual(checkPaths(['src/components/A.tsx', 'src/app/page.tsx', 'public/a.png'], scope), { ok: true, violations: [] })
  })

  test('deny 가 allow 보다 우선한다', () => {
    assert.deepEqual(checkPaths(['src/components/A.test.tsx'], scope).violations, ['src/components/A.test.tsx'])
  })

  test('어느 목록에도 없으면 막는다', () => {
    assert.deepEqual(checkPaths(['src/middleware.ts', 'package.json'], scope).violations, ['src/middleware.ts', 'package.json'])
  })

  test('엔진 상태(.perf-loop/·.claude/)는 allow 에 있어도 항상 막는다', () => {
    const open = { allow: ['**'], deny: [] }
    assert.deepEqual(checkPaths(['.perf-loop/results.tsv', '.claude/perf-loop.json', 'a.ts'], open).violations,
      ['.perf-loop/results.tsv', '.claude/perf-loop.json'])
  })
})
