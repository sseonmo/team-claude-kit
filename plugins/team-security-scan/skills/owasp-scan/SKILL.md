---
name: owasp-scan
description: Use when auditing a codebase against the OWASP Top 10, running a security scan or security audit of a repository, checking a project for vulnerabilities before a release, or asking which OWASP categories a codebase is exposed to. Any language or stack.
---

# OWASP Top 10:2025 스캔

리포 전체를 OWASP Top 10:2025 열 개 항목으로 감사하고, 검증을 거친 발견만 담은 HTML 대시보드를 남긴다.

**코드는 고치지 않는다.** 이 스킬의 산출물은 리포트다. 사용자가 명시적으로 수정을 요청하면 스캔을
끝내고 리포트를 낸 뒤, 별도 작업으로 시작한다. 스캔과 수정을 섞으면 감사 결과를 믿을 수 없다.

## 시작 전에 반드시

`references/owasp-2025.md` 를 읽는다. **2025 목록은 당신의 기본값이 아니다.**
이 스킬 없이 스캔한 에이전트는 Injection 을 A03(2021 번호)으로, Misconfiguration 을 A05 로 보고했다.
2025 에서는 각각 A05, A02 다. 항목 번호를 적을 때마다 변환표를 확인한다.

A01 Broken Access Control · A02 Security Misconfiguration · A03 Software Supply Chain Failures ·
A04 Cryptographic Failures · A05 Injection · A06 Insecure Design · A07 Authentication Failures ·
A08 Software or Data Integrity Failures · A09 Security Logging and Alerting Failures ·
A10 Mishandling of Exceptional Conditions

## 절차

### 1. 정찰

리포 루트를 확인하고 다음을 파악해 이후 모든 단계에 넘길 공통 컨텍스트를 만든다.

- 언어·프레임워크·패키지 매니저, 진입점, 라우트 정의 위치
- 인증 방식(세션/JWT/OAuth), 데이터 접근 계층, DB 와 RLS 유무
- 파일 수·라인 수, 제외할 경로 (`references/tools.md` 의 제외 목록)

### 2. 도구 패스

`references/tools.md` 의 검증된 명령을 그대로 쓴다. 감지된 스택에 해당하는 것만 병렬로 돌린다.

- 정적 분석은 `--config=p/default`. 이름과 달리 `p/owasp-top-ten` 은 SQL 인젝션과 `jwt.decode()`
  미검증을 놓친다 — 실측으로 확인된 사실이다.
- 의존성 스캔은 건너뛰지 않는다. 측정 결과 코드 정독만으로는 "오래된 버전이 있다" 수준에 그쳤고,
  도구는 같은 리포에서 CVE 13건을 버전과 함께 특정했다.
- 못 돌린 도구는 `status: "skipped"` 와 이유를 기록한다. 설치를 강요하지 않는다.
- 도구가 조용한 영역이 깨끗한 영역이 아니다. **실측 커버리지는 도구 최선 조합으로도 약 3분의 1이다.**

### 3. 항목별 팬아웃

A01~A10 각 항목에 서브에이전트 하나씩, 열 개를 한 번에 띄운다. 각 에이전트에게 준다:

1. 담당 항목 코드와 이름 (2025 번호)
2. `references/owasp-2025.md` 의 해당 항목 절을 읽으라는 지시 — **존재 점검과 부재 점검 둘 다**
3. 1단계 정찰 결과
4. 2단계 도구 결과 중 그 항목에 해당하는 것
5. `references/finding-schema.md` 의 반환 형식

**부재 점검을 반드시 지시에 넣는다.** 측정된 실패: 스킬 없는 스캔이 완전히 놓친 세 건은 전부
"있어야 할 것이 없는" 유형이었다 — 보안 로깅 전무(A09), 빈 `catch` 로 인한 fail-open(A10),
`DEBUG=true` 기본값(A02). 나쁜 코드를 찾는 것과 없는 것을 알아채는 것은 다른 작업이다.

A09 와 A10 은 도구가 한 건도 잡지 못하는 항목이므로 특히 코드 정독에 의존한다.

### 4. 취합과 검증

**먼저 사각지대를 메운다.** 2단계 도구 결과를 한 줄씩 훑어 **어느 발견에도 반영되지 않은 항목**을
찾는다. 측정된 실패: semgrep 이 올린 CSRF 경고를 A01·A02·A07 담당이 모두 "다른 항목 소관"으로
판단해 셋 다 올리지 않았다. 겹치는 영역은 서로 미루다 사라진다 — 취합 단계에서 직접 확인한다.

그다음 `critical` 과 `high` 로 올라온 발견마다 검증 에이전트를 띄운다. 검증자는 해당 파일을
**직접 다시 읽고** `scenario` 가 성립하는지만 판정한다 — 원 발견의 설명을 믿지 않는다.
취합 단계에서 새로 추가한 발견도 같은 기준으로 검증 대상에 넣는다.

`CONFIRMED` / `PLAUSIBLE` / `REJECTED` 중 하나를 반환하고, `REJECTED` 는 리포트에서 뺀다.
같은 코드가 여러 항목에서 올라왔으면 `references/owasp-2025.md` 의 중복 배정표로 한 곳에 병합한다.

### 5. 리포트

결과를 `references/finding-schema.md` 형식의 JSON 파일로 쓴 뒤, 조립 스크립트를 돌린다.
**HTML 을 직접 편집하지 않는다** — 코드를 JSON 에 손으로 써넣으면 따옴표와 줄바꿈이 깨져
리포트가 브라우저에서 빈 화면이 된다. 실제로 그렇게 됐다.

스크립트 경로는 설치 형태(플러그인 / 개인 스킬)에 따라 다르므로 먼저 찾는다.
캐시에는 구버전이 함께 남으므로 `head -1` 이 아니라 버전 정렬로 최신 설치본을 고정한다.

```bash
BUILD=$(find "$HOME/.claude/plugins/cache" \
  -path '*owasp-scan/scripts/build_report.py' 2>/dev/null | sort -V | tail -1)
[ -f "$BUILD" ] || BUILD="$HOME/.claude/skills/owasp-scan/scripts/build_report.py"
[ -f "$BUILD" ] || echo "OWASP_SCAN_NOT_INSTALLED"

python3 "$BUILD" <결과.json> .security/owasp-<YYYY-MM-DD>.html <리포루트>
```

`OWASP_SCAN_NOT_INSTALLED` 가 찍히면 스킬이 제대로 설치되지 않은 것이다 — 사용자에게 알리고 중단한다.

- 코드 조각은 JSON 에 넣지 않는다. `file` 과 `line`(필요하면 `endLine`)만 주면 스크립트가 읽어온다.
- 스크립트가 0 이 아닌 코드로 끝나면 리포트가 만들어지지 않은 것이다. 출력된 사유를 고치고 다시 돌린다.
- 결과 JSON 은 리포 밖(임시 경로)에 쓴다. 리포에 남기지 않는다.
- `.gitignore` 에 `.security/` 가 없으면 한 줄 추가한다 (이미 있으면 그대로 둔다).
- 2단계에서 락파일을 새로 만들었다면 지운다. 스캔은 리포를 바꾸지 않는다.
- 터미널에는 심각도 분포와 `critical` 전체만 요약하고, 나머지는 리포트 경로를 안내한다.

## 흔한 실수

스킬 없이 스캔했을 때 실제로 나온 실패들이다.

| 실수 | 바로잡기 |
|---|---|
| 2021 카테고리 번호로 보고 | 변환표를 매번 확인. Injection=A05, 설정=A02, 공급망=A03, 암호=A04 |
| 도구를 안 돌리고 코드만 읽음 | 의존성 CVE 는 도구만 특정할 수 있다. "오래된 버전" 은 발견이 아니다 |
| 존재하는 나쁜 코드만 찾음 | 항목마다 부재 점검을 별도로 수행 |
| 산문으로 보고 | 스키마가 계약이다. 형식을 지키지 않으면 리포트를 만들 수 없다 |
| 겹치는 항목을 서로 미룸 | CSRF·예측 가능한 토큰처럼 두 항목에 걸친 점검은 아무도 안 본다. 배정표를 따르고, 없으면 일단 올린다 |
| 코드를 JSON 에 손으로 써넣음 | `file`+`line` 만 준다. 조립 스크립트가 디스크에서 읽는다 |
| 모든 발견을 같은 확신도로 나열 | critical·high 는 검증을 거친 것만 |
| "전부 확인했다" 고 단언 | `notChecked` 와 미실행 도구를 리포트에 남긴다 |
| 시크릿 스캐너 결과를 그대로 신뢰 | 실측 3건 중 2건이 오탐이었다. 테스트 더미와 필드명 상수를 걸러낼 것 |
| 오탐을 올림 | 허용 목록 기반 쿼리, 주석 처리된 코드, 테스트 픽스처는 취약점이 아니다 |

## 참고 파일

| 파일 | 내용 |
|---|---|
| `references/owasp-2025.md` | 2025 목록, 2021→2025 변환표, 항목별 존재·부재 점검, 중복 배정 규칙 |
| `references/tools.md` | 검증된 실행 명령, 도구별 실측 커버리지, 제외 경로 |
| `references/finding-schema.md` | 발견 JSON 스키마, `scenario` 작성 규칙, 심각도 기준 |
| `scripts/build_report.py` | 결과 JSON → 대시보드 HTML 조립. 스키마를 검사하고 코드 조각을 리포에서 읽어온다 |
| `assets/report.html` | 대시보드 템플릿. 직접 편집하지 않는다 |
