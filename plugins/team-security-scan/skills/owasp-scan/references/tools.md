# 스캔 도구 — 검증된 명령과 실측 커버리지

아래 명령은 모두 macOS + `uvx` 0.9 / `npx` 10.9 환경에서 실제로 실행해 확인했다.

## 도구가 얼마나 잡는가 (실측)

의도적으로 심은 취약점 32건짜리 Node/Express 픽스처에서 측정:

| 도구·설정 | 보고 건수 | 실제 취약점 적중 |
|---|---|---|
| `semgrep --config=p/default` | 17 | **약 10/32 (31%)** |
| `semgrep --config=p/owasp-top-ten` | 9 | 4/32 (12.5%) |
| `semgrep --config=p/javascript` | 9 | 4/32 |
| `semgrep --config=p/security-audit` | 2 | 2/32 |
| `npm audit` (락파일 생성 후) | 13 | A03 의존성 CVE 를 사실상 전부 |
| `detect-secrets` | 3 | 1건 적중, **2건 오탐** |

**두 가지 결론:**

1. **`p/owasp-top-ten` 보다 `p/default` 를 쓸 것.** 이름과 반대로 OWASP 전용 룰셋은 SQL 인젝션과
   `jwt.decode()` 미검증을 놓쳤고, `p/default` 는 잡았다. 둘 다 돌려도 되지만 하나만 고른다면 `p/default`.
2. **도구 최선 조합으로도 3분의 1이다.** 접근 제어(A01) 4건 전부, 보안 로깅 부재(A09), fail-open
   예외 처리(A10), 설계 결함(A06)은 **어떤 도구도 한 건도 잡지 못했다.** 나머지는 코드 정독의 몫이다.
   도구 결과가 조용하다고 해서 깨끗한 것이 아니다.

## 명령

모든 명령은 스캔 대상 리포 루트에서 실행한다. `uvx`/`npx` 는 전역 설치 없이 그 자리에서 받아 실행한다.

### 정적 분석 — 전 언어

```bash
uvx --from semgrep semgrep scan --config=p/default --json --quiet . > /tmp/semgrep.json
```

- 첫 실행은 패키지 다운로드로 1~2분 걸린다. `timeout 600` 을 붙일 것.
- 큰 리포는 `--exclude` 를 추가: `--exclude=node_modules --exclude=dist --exclude=.next --exclude=vendor`
- 결과 요약:
  ```bash
  python3 -c "
  import json,sys
  d=json.load(open('/tmp/semgrep.json'))
  for r in d['results']:
      print(f\"{r['path']}:{r['start']['line']}  {r['check_id'].split('.')[-1]}  {r['extra']['metadata'].get('cwe',[''])[0] if r['extra']['metadata'].get('cwe') else ''}\")
  print(len(d['results']),'건')"
  ```

### 의존성 CVE — A03 의 핵심

**Node** — 락파일이 없으면 먼저 만든다. `--ignore-scripts` 는 필수다(스캔 대상의 `postinstall` 이
악성일 수 있고, 실제로 그게 A03 의 점검 항목 중 하나다):

```bash
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
npm audit --json > /tmp/npm-audit.json
```

작업 후 생성한 `package-lock.json` 이 원래 없던 것이면 **지울 것**. 스캔은 리포를 바꾸지 않는다.

**Python**

```bash
uvx pip-audit -r requirements.txt --format json          # requirements 기반
uvx pip-audit --format json                              # 현재 환경 기반
```

**그 외 언어 / 통합** — `osv-scanner` 가 설치돼 있으면 가장 넓다:

```bash
osv-scanner scan source --format json .
```

없으면 설치하지 말고 "미실행"으로 기록한다. Go/Rust/Java 는 각각 `govulncheck`, `cargo audit`,
`mvn dependency-check` 가 있으면 쓰고, 없으면 미실행으로 남긴다.

### 시크릿

```bash
uvx detect-secrets scan --all-files . > /tmp/secrets.json
```

`gitleaks` 가 설치돼 있으면 그쪽이 더 정확하다 (`gitleaks detect --no-git --report-format json`).

**detect-secrets 결과는 반드시 사람 눈으로 걸러야 한다.** 실측에서 3건 중 2건이 오탐이었다:
테스트 더미 상수(`TEST_API_KEY = 'sk-test-000...'`)와 **필드 이름 상수**(`PASSWORD_FIELD = 'password'`)를
시크릿으로 올렸다. 반대로 `.env.example` 에 실제 형식으로 들어 있던 AWS·Stripe 키는 놓쳤다.
즉 이 도구는 **재현율도 정밀도도 낮다.** 단서로만 쓰고 판정은 직접 한다.

### 커밋 히스토리의 시크릿

현재 파일에서 지워도 히스토리에는 남는다. 리포가 git 이면:

```bash
git log --all --diff-filter=AM -p -- '*.env' '*.pem' '*.key' | head -200
```

## 도구를 못 돌렸을 때

설치를 강요하지 않는다. 네트워크가 없거나 `uvx`/`npx` 가 없으면 **그 도구를 건너뛰고 리포트에 남긴다**:

```json
{ "name": "semgrep", "version": null, "status": "skipped",
  "reason": "uvx 없음 — 정적 분석 룰 기반 탐지 미수행, 이 영역 커버리지 없음" }
```

리포트 템플릿은 미실행 도구가 하나라도 있으면 상단에 경고 배너를 띄운다. 침묵으로 넘기지 말 것.

## 스캔에서 제외할 경로

`node_modules`, `.git`, `dist`, `build`, `.next`, `out`, `coverage`, `vendor`, `target`,
`__pycache__`, `.venv`, 바이너리·이미지·잠금 파일 본문.

제외 목록은 리포트의 `scope.excluded` 에 기록한다 — 무엇을 안 봤는지가 무엇을 봤는지만큼 중요하다.
