# team-repo-audit

레포지토리가 코딩 에이전트에게 얼마나 친화적인지 **AI-Ready v2 루브릭(100점 · 7 카테고리)** 으로 감사한다.

## 구성

| 종류 | 이름 |
|---|---|
| Skill | `ai-readiness-cartography` |

## 채점 카테고리

| | 배점 | 측정 |
|---|---|---|
| A | 15 | Navigation & Coverage — 모듈별 context 파일 보유율 |
| B | 20 | Context Document Quality — 간결성·명령어·핵심 파일·hidden rule·교차참조 |
| C | 20 | Tribal Knowledge Externalization |
| D | 15 | Cross-Module Dependency & Data Flow Mapping |
| E | 15 | Verification & Quality Gates — **hallucinated path 검증 포함** |
| F | 10 | Freshness & Self-Maintenance — context drift |
| G | 5  | Agent Performance Outcomes |

등급: 90+ AI-Native / 75+ AI-Ready / 60+ AI-Assisted / 40+ AI-Fragile / <40 AI-Hostile

## 산출물

1. `ai-readiness-score.json` — 구조화된 점수표
2. `ai-readiness-map.html` — 단일 파일 대시보드 (인라인 SVG, 외부 의존 없음)
3. ROI 순 액션 리스트 — Effort(S/M/L) × 정량 Impact

저장 위치는 `docs/` → `.claude/` → 레포 루트 순으로 자동 선택.

## 요구사항

Python 3.10+ (stdlib only). 외부 패키지 불필요.

## 파일

- `skills/ai-readiness-cartography/scripts/score.py` — 자동 채점기
- `skills/ai-readiness-cartography/assets/template.html` — 대시보드 원본
- `skills/ai-readiness-cartography/references/scoring-rubric.md` — v2 채점 기준
