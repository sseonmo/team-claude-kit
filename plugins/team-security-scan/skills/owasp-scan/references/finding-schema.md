# 발견 스키마 — 에이전트 사이의 계약

항목 담당 에이전트, 검증 에이전트, 리포트 생성이 모두 이 형식을 주고받는다.
산문으로 보고하면 리포트를 만들 수 없다.

## 발견 하나

```json
{
  "id": "A01-1",
  "category": "A01",
  "severity": "critical",
  "title": "프로필 조회 엔드포인트에 소유권 검사가 없어 임의 사용자 PII 노출",
  "file": "src/routes/users.js",
  "line": 6,
  "endLine": 10,
  "scenario": "비로그인 상태에서 GET /api/users/2/profile 을 호출하면 2번 사용자의 전화번호·주소·카드 끝자리가 그대로 응답에 담긴다. id 를 순회하면 전체 사용자 PII 를 수집할 수 있다.",
  "impact": "전체 사용자 개인정보 유출",
  "fix": "세션의 userId 와 params.id 가 같은지 확인하거나, 관리자 권한을 요구한다. 소유권 검사를 라우터 공통 미들웨어로 올려 라우트별 누락을 막는다.",
  "source": "agent",
  "cwe": "CWE-639",
  "verification": "CONFIRMED"
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `id` | ✓ | `<항목>-<순번>`. 예: `A05-3` |
| `category` | ✓ | `A01`~`A10`. **2025 번호** — `references/owasp-2025.md` 의 변환표를 확인할 것 |
| `severity` | ✓ | `critical` \| `high` \| `medium` \| `low` — 아래 기준표 |
| `title` | ✓ | 한 문장. "무엇이 왜 문제인가"까지. "SQL 인젝션" 만 쓰지 말 것 |
| `file` | ✓ | 리포 루트 기준 상대 경로 |
| `line` | ✓ | 1-기반 행 번호. 파일 전체가 대상이면 `null` |
| `endLine` | | 코드 조각의 끝 줄. 생략하면 `line`+4 |
| `scenario` | ✓ | **구체적 입력 → 구체적 결과.** 아래 규칙 참고 |
| `impact` | | 한 줄 |
| `fix` | ✓ | 수정 방향. 패치 diff 는 쓰지 않는다 (이 스킬은 코드를 고치지 않는다) |
| `source` | ✓ | `agent` \| `semgrep` \| `npm-audit` \| `pip-audit` \| `detect-secrets` \| `osv-scanner` |
| `cwe` | | 알면 적는다 |
| `verification` | | 검증 패스가 채운다. `CONFIRMED` \| `PLAUSIBLE` |

## 코드 조각은 쓰지 않는다

`snippet` 필드를 직접 채우지 말 것. `file` 과 `line`(필요하면 `endLine`)만 주면
`scripts/build_report.py` 가 리포에서 해당 줄을 직접 읽어 넣는다.

측정된 실패: 코드를 JSON 에 손으로 써넣은 결과 따옴표와 줄바꿈이 이스케이프되지 않아
리포트가 **브라우저에서 빈 화면**이 됐다. 줄 번호만 넘기면 이 문제가 사라지고,
리포트에 실리는 코드가 실제 파일 내용임이 보장된다.

## `scenario` 규칙

검증 패스가 판정하는 대상이 이 필드다. **공격자가 실제로 무엇을 보내면 무엇이 일어나는지**를 적는다.

| 나쁜 예 | 좋은 예 |
|---|---|
| "SQL 인젝션 가능" | "`GET /api/users/1'%20OR%20'1'='1/profile` 로 WHERE 절이 항상 참이 되어 첫 행이 반환된다" |
| "인증이 약함" | "`Authorization: Bearer <header>.eyJyb2xlIjoiYWRtaW4ifQ.x` 처럼 서명을 아무 값으로 채워 보내면 `jwt.decode` 가 payload 를 그대로 반환해 role=admin 으로 통과한다" |
| "로깅이 부족함" | "로그인 5회 실패 후에도 `console.log` 호출이 없어 무차별 대입이 일어나도 탐지할 기록이 남지 않는다" |

시나리오를 구체적으로 못 쓰겠으면 그 발견은 확신이 없는 것이다. 버리거나 `low` 로 내린다.

## 심각도 기준

추측하지 말고 이 표에 맞춘다.

| 등급 | 기준 | 예 |
|---|---|---|
| `critical` | 인증 없이 외부에서 서버 장악, 전면 인증 우회, 전체 데이터 유출·조작 | RCE, 명령 인젝션, 서명 미검증 JWT, 인증 없는 SQLi, 결제 상태 위조 |
| `high` | 인증된 사용자가 권한을 넘어서거나, 민감정보가 유출되거나, 한 단계만 더 가면 치명적 | IDOR, 관리자 우회, 저장형 XSS, 시크릿 전면 노출, 하드코딩된 프로덕션 키 |
| `medium` | 다른 취약점과 결합해야 피해가 되거나, 공격 난도가 높음 | MD5 비밀번호 해시, 예측 가능한 토큰, CORS 과다 허용, 취약 의존성 |
| `low` | 심층 방어 미흡, 모범 사례 이탈 | 보안 헤더 누락, 과도한 바디 크기 한도, 긴 세션 만료 |

**의존성 CVE 는 도구가 준 등급을 그대로 쓴다** (npm audit 의 critical/high/moderate/low).
단 실제로 그 코드 경로를 쓰지 않는다면 한 단계 내리고 그 이유를 `impact` 에 적는다.

## 항목 담당 에이전트가 반환하는 형태

```json
{
  "category": "A01",
  "findings": [ /* 위 형식의 발견들 */ ],
  "checked": ["인증 미들웨어 적용 범위", "IDOR 후보 엔드포인트 12개", "SSRF 후보 3개"],
  "notChecked": ["DB RLS 정책 — 마이그레이션 파일이 없어 확인 불가"]
}
```

`notChecked` 는 비워두지 말 것. 확인하지 못한 영역을 밝히는 것이 이 스캔의 신뢰도를 만든다.

## 검증 에이전트가 반환하는 형태

```json
{
  "id": "A01-1",
  "verdict": "CONFIRMED",
  "reason": "users.js:7 을 다시 읽었다. 라우터에 인증 미들웨어가 없고 app.js 에서도 /api/users 앞에 붙이지 않는다. 시나리오대로 비로그인 호출이 가능하다.",
  "correctedSeverity": null
}
```

| `verdict` | 의미 | 처리 |
|---|---|---|
| `CONFIRMED` | 코드를 다시 읽었고 시나리오가 성립한다 | 그대로 싣는다 |
| `PLAUSIBLE` | 문제 소지는 맞지만 시나리오의 일부를 확인하지 못했다 | 싣되 `PLAUSIBLE` 로 표시 |
| `REJECTED` | 시나리오가 성립하지 않는다 (방어 코드가 있거나, 도달 불가능하거나, 죽은 코드) | **리포트에서 제외** |

`correctedSeverity` 가 채워져 있으면 그 값으로 바꾼다.
