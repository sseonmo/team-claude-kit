import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from '../lib/tdd-rules.mjs'

const ROOT = '/repo'

// 디스크 대신 파일 집합을 주입한다. 대상 파일 자체를 넣으면 "기존 파일 수정",
// 넣지 않으면 "신규 작성" 이 된다 — 이 구분이 0.2.0 판정의 축이다.
const world =
  (...files) =>
  (target) =>
    check(target, { exists: (p) => files.includes(p), projectRoot: ROOT })

const denied = (target, ...files) => {
  const r = world(...files)(target)
  assert.ok(r, `막았어야 한다: ${target}`)
  assert.equal(r.decision, 'deny')
  return r
}
const passed = (target, ...files) => {
  assert.equal(world(...files)(target), null, `통과했어야 한다: ${target}`)
}

// ─────────────────────────────────────────────────────────────
// Node
// ─────────────────────────────────────────────────────────────

test('node: 테스트 없는 신규 파일은 막는다', () => {
  denied('/repo/lib/slugify.ts')
  denied('/repo/lib/slugify.tsx')
  denied('/repo/lib/slugify.js')
  denied('/repo/lib/slugify.mjs')
})

test('node: 같은 폴더의 test·spec 을 인정한다', () => {
  passed('/repo/lib/slugify.ts', '/repo/lib/slugify.test.ts')
  passed('/repo/lib/slugify.ts', '/repo/lib/slugify.spec.ts')
  passed('/repo/lib/slugify.js', '/repo/lib/slugify.test.js')
})

test('node: __tests__ 는 같은 폴더와 부모 폴더 모두 인정한다', () => {
  passed('/repo/lib/slugify.ts', '/repo/lib/__tests__/slugify.test.ts')
  passed('/repo/src/lib/slugify.ts', '/repo/src/__tests__/slugify.test.ts')
})

test('node: __tests__ 안의 .spec 도 인정한다 (0.1.0 은 .test 만 봤다)', () => {
  passed('/repo/lib/parser.ts', '/repo/lib/__tests__/parser.spec.ts')
  passed('/repo/src/lib/parser.ts', '/repo/src/__tests__/parser.spec.ts')
})

test('node: 이름만 같은 남의 테스트로는 뚫리지 않는다', () => {
  // 0.1.0 은 저장소 루트의 src/__tests__ 를 basename 만으로 뒤져서
  // lib/a/util.ts 와 lib/b/util.ts 가 테스트 하나로 둘 다 통과했다.
  denied('/repo/lib/a/util.ts', '/repo/src/__tests__/util.test.ts')
  denied('/repo/lib/b/util.ts', '/repo/lib/a/util.test.ts')
})

// ─────────────────────────────────────────────────────────────
// Python
// ─────────────────────────────────────────────────────────────

test('python: 테스트 없는 신규 파일은 막는다', () => {
  denied('/repo/src/services/payment.py')
})

test('python: 같은 폴더의 test_x·x_test 를 인정한다', () => {
  passed('/repo/src/services/payment.py', '/repo/src/services/test_payment.py')
  passed('/repo/src/services/payment.py', '/repo/src/services/payment_test.py')
})

test('python: 루트 tests/ 를 플랫·미러링 양쪽으로 인정한다', () => {
  passed('/repo/src/services/payment.py', '/repo/tests/test_payment.py')
  passed('/repo/src/services/payment.py', '/repo/tests/services/test_payment.py')
})

test('python: 같은·부모 폴더의 tests/ 도 인정한다', () => {
  passed('/repo/src/services/payment.py', '/repo/src/services/tests/test_payment.py')
  passed('/repo/src/services/payment.py', '/repo/src/tests/test_payment.py')
})

// ─────────────────────────────────────────────────────────────
// Java
// ─────────────────────────────────────────────────────────────

test('java: 테스트 없는 신규 파일은 막는다', () => {
  denied('/repo/src/main/java/com/acme/Payment.java')
})

test('java: src/main ↔ src/test 미러링을 인정한다 (패키지 경로 유지)', () => {
  passed(
    '/repo/src/main/java/com/acme/Payment.java',
    '/repo/src/test/java/com/acme/PaymentTest.java'
  )
  passed(
    '/repo/src/main/java/com/acme/Payment.java',
    '/repo/src/test/java/com/acme/PaymentTests.java'
  )
})

test('java: 패키지가 다르면 인정하지 않는다', () => {
  denied(
    '/repo/src/main/java/com/acme/Payment.java',
    '/repo/src/test/java/com/other/PaymentTest.java'
  )
})

test('java: 멀티모듈에서도 모듈별로 미러링한다', () => {
  passed(
    '/repo/billing/src/main/java/com/acme/Payment.java',
    '/repo/billing/src/test/java/com/acme/PaymentTest.java'
  )
  denied(
    '/repo/billing/src/main/java/com/acme/Payment.java',
    '/repo/core/src/test/java/com/acme/PaymentTest.java'
  )
})

test('java: src/main 구조가 아니면 같은 폴더로 폴백한다', () => {
  passed('/repo/app/Payment.java', '/repo/app/PaymentTest.java')
})

// ─────────────────────────────────────────────────────────────
// 테스트 파일 자체는 언제나 통과 — 여기가 빠지면 테스트를 쓸 수 없다
// ─────────────────────────────────────────────────────────────

test('테스트 파일을 쓰려는 시도는 막지 않는다 (3언어 관용 네이밍)', () => {
  passed('/repo/lib/slugify.test.ts')
  passed('/repo/lib/slugify.spec.ts')
  passed('/repo/lib/__tests__/slugify.ts')
  passed('/repo/tests/test_payment.py')
  passed('/repo/src/services/payment_test.py')
  passed('/repo/tests/conftest.py')
  passed('/repo/src/test/java/com/acme/PaymentServiceTest.java')
  passed('/repo/src/test/java/com/acme/PaymentServiceTests.java')
  passed('/repo/src/test/java/com/acme/Helper.java')
})

// ─────────────────────────────────────────────────────────────
// 신규만 차단 — 기존 파일 수정은 통과
// ─────────────────────────────────────────────────────────────

test('이미 있는 파일의 수정은 테스트가 없어도 통과한다', () => {
  passed('/repo/lib/legacy.ts', '/repo/lib/legacy.ts')
  passed('/repo/src/services/legacy.py', '/repo/src/services/legacy.py')
  passed('/repo/src/main/java/com/acme/Legacy.java', '/repo/src/main/java/com/acme/Legacy.java')
})

// ─────────────────────────────────────────────────────────────
// 대상 밖 · 예외
// ─────────────────────────────────────────────────────────────

test('지원하지 않는 언어와 비-소스 파일은 검사하지 않는다', () => {
  passed('/repo/internal/payment/payment.go')
  passed('/repo/src/payment.rs')
  passed('/repo/app/services/payment.rb')
  passed('/repo/README.md')
  passed('/repo/package.json')
})

test('설정·타입·프레임워크 파일은 예외', () => {
  passed('/repo/next.config.js')
  passed('/repo/lib/api.d.ts')
  passed('/repo/app/dashboard/page.tsx')
  passed('/repo/app/layout.tsx')
  passed('/repo/src/types/user.ts')
  passed('/repo/src/components/Button.tsx')
  passed('/repo/src/__init__.py')
  passed('/repo/src/db/migrations/0001_init.py')
  passed('/repo/src/main/java/com/acme/package-info.java')
})

test('예외 패턴은 경로가 아니라 파일명·세그먼트로만 걸린다', () => {
  // 0.1.0 은 패턴을 전체 경로에 부분일치시켜, 상위 폴더 이름 하나로
  // 그 아래 트리 전체가 조용히 무력화됐다.
  denied('/repo/tailwind-app/lib/auth.ts')
  denied('/repo/my-postcss-tools/lib/auth.ts')
  denied('/repo/tsconfig-utils/lib/auth.ts')
  denied('/repo/app.config.d/lib/auth.ts')
  denied('/repo/lib/app.config.helper.ts')
  denied('/repo/src/components/../lib/auth.ts')
  // 0.1.0 은 `*__tests__*` 를 파일명에도 부분일치시켜 이 구현 파일을 통과시켰다
  denied('/repo/lib/__tests__mock.ts')
})

// ─────────────────────────────────────────────────────────────
// 입력 방어
// ─────────────────────────────────────────────────────────────

test('경로가 없거나 이상하면 통과시킨다 (fail-open)', () => {
  passed('')
  assert.equal(check(undefined, { exists: () => false }), null)
  assert.equal(check(null, { exists: () => false }), null)
})

test('projectRoot 가 없어도 동작한다', () => {
  const r = check('/repo/lib/slugify.ts', { exists: () => false })
  assert.ok(r)
  assert.equal(r.decision, 'deny')
  assert.match(r.reason, /slugify\.test\.ts/)
})
