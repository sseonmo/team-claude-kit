import { readFileSync } from 'node:fs'

export const VERSION = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version

// 모드별 시간 상한(초)과 심각도별 검증자 수 (nit 은 검증하지 않는다)
export const MODES = {
  fast: { capSec: 300, votes: { critical: 2, major: 2, minor: 0, nit: 0 } },
  deep: { capSec: 480, votes: { critical: 3, major: 3, minor: 1, nit: 0 } },
}

// 아래 세 값은 설계 문서 docs/specs/2026-10-18-team-code-review-design.md 의 `## 실증 결과` (Task 1 실측)
export const LARGE_DIFF_LINES = 2650 // 이 줄 수를 넘으면 큰 diff 경고
export const VERIFY_CAP = { fast: 10, deep: 16 } // 모드별 검증 대상 발견 수 상한
export const TIEBREAK_MIN_SEC = 27 // 남은 시간이 이보다 적으면 타이브레이크를 건너뛴다

// 변경 줄 수 집계에서 빼는 생성 파일
export const LOCKFILES = ['*.lock', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'gradle.lockfile']

export const SEVERITY_RANK = { critical: 0, major: 1, minor: 2, nit: 3 }
