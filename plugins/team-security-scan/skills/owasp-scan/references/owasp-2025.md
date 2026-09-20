# OWASP Top 10:2025 — 항목별 점검 지침

출처: https://top10.owasp.org/2025/

## 목록 (이것이 정답. 기억에 의존하지 말 것)

| 코드 | 이름 |
|---|---|
| A01:2025 | Broken Access Control |
| A02:2025 | Security Misconfiguration |
| A03:2025 | Software Supply Chain Failures |
| A04:2025 | Cryptographic Failures |
| A05:2025 | Injection |
| A06:2025 | Insecure Design |
| A07:2025 | Authentication Failures |
| A08:2025 | Software or Data Integrity Failures |
| A09:2025 | Security Logging and Alerting Failures |
| A10:2025 | Mishandling of Exceptional Conditions |

## 2021 → 2025 번호 변환표

**당신의 기본값은 2021 이다.** 측정된 실패: 스킬 없이 스캔한 에이전트는 Injection 을 `A03`(2021 번호)으로,
Misconfiguration 을 `A05` 로 보고했다. 2025 에서는 각각 `A05`, `A02` 다. 항목을 적을 때마다 위 표를 다시 볼 것.

| 2021 | 2025 | 비고 |
|---|---|---|
| A01 Broken Access Control | **A01** | 그대로 |
| A02 Cryptographic Failures | **A04** | 내려감 |
| A03 Injection | **A05** | 내려감. XSS 포함 |
| A04 Insecure Design | **A06** | 내려감 |
| A05 Security Misconfiguration | **A02** | 크게 올라감 |
| A06 Vulnerable and Outdated Components | **A03** | 범위가 넓어져 *Software Supply Chain Failures* 로 개명 |
| A07 Identification and Authentication Failures | **A07** | *Authentication Failures* 로 개명 |
| A08 Software and Data Integrity Failures | **A08** | 이름 미세 변경 (`and` → `or`) |
| A09 Security Logging and Monitoring Failures | **A09** | *Logging and Alerting* 으로 개명 |
| A10 SSRF | — | 독립 항목에서 빠짐. SSRF 는 A01 또는 A06 으로 매핑 |
| — | **A10** | *Mishandling of Exceptional Conditions* 신설 |

---

## 각 항목: 무엇을 볼 것인가

각 항목은 **존재 점검**(나쁜 코드가 있는가)과 **부재 점검**(있어야 할 것이 없는가)으로 나뉜다.

> 측정된 실패: 베이스라인 스캔이 완전히 놓친 3건은 **전부 부재형**이었다.
> 나쁜 코드를 찾는 건 쉽고, 없는 것을 알아채는 건 어렵다. 부재 점검을 건너뛰지 말 것.

### A01 — Broken Access Control

**존재 점검**
- 식별자를 받는 엔드포인트(`/:id`, `?userId=`)가 그 자원의 소유자인지 확인하는가 — IDOR
- 권한 판정이 클라이언트가 보내는 값(쿼리 파라미터, 헤더, 요청 바디, JWT 의 미검증 claim)에 의존하는가
- 경로 순회(`../`), 디렉터리 인덱싱, 인증 없이 열린 내부/관리 엔드포인트
- SSRF — 사용자 입력 URL 로 서버가 요청을 보내는가 (2025 에서 SSRF 는 여기로)
- DB 레벨 권한(RLS/row-level policy)이 있다면, 서비스 롤 키로 그것을 우회하는 경로가 있는가

**부재 점검**
- 인증 미들웨어가 라우터 **전체**에 걸려 있는가, 일부 라우트만 개별 적용인가 (누락이 생기는 구조)
- 기본값이 deny 인가 allow 인가
- 다중 테넌트라면 테넌트 경계 검사가 모든 쿼리에 있는가

### A02 — Security Misconfiguration

**존재 점검**
- CORS: `origin: '*'` 또는 요청 오리진 반사 + `credentials: true`
- 디버그 플래그가 켜진 채 배포 (`DEBUG=true`, `NODE_ENV=development`, `app.debug = True`)
- 불필요하게 강한 DB 옵션 (`multipleStatements`, 과도한 권한의 DB 계정)
- 기본 계정·기본 비밀번호, 샘플 앱, 열린 관리 콘솔
- 과도한 업로드/바디 크기 한도

**부재 점검**
- 보안 헤더가 없는가 — CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`
- 프로덕션 설정과 개발 설정이 분리되어 있는가
- 클라우드 스토리지 버킷·DB 가 공개로 열려 있는가

### A03 — Software Supply Chain Failures

**존재 점검**
- `postinstall` / `prepare` 같은 설치 훅이 원격 스크립트를 받아 실행하는가 (`curl | sh`)
- 알려진 CVE 가 있는 의존성 버전 — **반드시 도구로 확인. 눈으로 판단하지 말 것**
- 잠금 파일 없이 범위 지정만 된 의존성(`^`, `~`), 또는 잠금 파일이 커밋되지 않음
- 타이포스쿼팅 의심 패키지명, 사설 레지스트리와 공용 레지스트리 혼용
- CI 워크플로가 태그 아닌 브랜치로 서드파티 액션을 참조 (`uses: foo/bar@master`)

**부재 점검**
- SBOM 이나 의존성 검토 절차가 있는가
- 외부 CDN 스크립트에 SRI(`integrity`) 가 있는가

### A04 — Cryptographic Failures

**존재 점검**
- 비밀번호에 일반 해시(MD5, SHA-1, SHA-256 단독) 사용 — KDF(bcrypt/scrypt/argon2) 가 아님, salt 없음
- 소스에 하드코딩된 시크릿: API 키, JWT 서명 키, DB 비밀번호, 세션 서명 키
- 약한 알고리즘·모드: DES, RC4, ECB 모드, 고정 IV, `Math.random()` 으로 만든 토큰
- 저장소에 커밋된 `.env`, 인증서, 키 파일 (`.env.example` 도 실제 형식의 키를 담고 있으면 문제)

**부재 점검**
- 전송 구간 암호화 강제(HTTPS 리다이렉트, HSTS)가 있는가
- 민감 필드(주민번호, 카드, 건강정보)가 평문으로 저장되는가
- 키 교체(rotation) 경로가 있는가

### A05 — Injection

**존재 점검**
- SQL: 문자열 결합·템플릿 리터럴로 만든 쿼리. 파라미터 바인딩이 아닌 것
- 명령: `exec`/`system`/`Runtime.exec` 에 사용자 입력이 문자열로 들어감
- 코드: `eval`, `Function()`, `pickle.loads`, 템플릿 엔진에 사용자 입력을 템플릿으로 전달(SSTI)
- XSS(반사형/저장형/DOM): 이스케이프 없는 HTML 결합, `innerHTML`, `dangerouslySetInnerHTML`, `v-html`
- NoSQL/LDAP/XPath 인젝션, XXE(외부 엔티티 허용된 XML 파서)
- ORM 의 raw 쿼리 이스케이프 해치

**부재 점검**
- 입력 검증이 경계(라우트 진입)에서 이뤄지는가, 아니면 각자 알아서인가
- 출력 인코딩이 컨텍스트(HTML/속성/JS/URL)에 맞게 적용되는가

**오탐 주의**: 컬럼명·테이블명을 **허용 목록**에서 고른 뒤 템플릿에 넣는 것은 안전하다. 주석 처리된 코드는 실행되지 않는다.

### A06 — Insecure Design

코드 한 줄이 아니라 **흐름 전체**를 봐야 하는 항목. 도구가 전혀 잡지 못한다.

**존재 점검**
- 비밀번호 재설정: 토큰이 예측 가능한가, 만료가 있는가, 1회용인가, 이메일 변경과 결합되는가
- 비즈니스 로직: 가격·수량·할인율을 클라이언트가 보내는가. 음수·정수 오버플로 허용
- 경쟁 조건 — 잔액 차감, 쿠폰 사용, 재고 감소에 원자성이 있는가
- 신뢰 경계가 잘못 그어진 곳 — 내부망이라서 인증을 생략한 서비스

**부재 점검**
- 레이트 리밋·계정 잠금이 로그인, 재설정, OTP, 결제에 있는가
- 위험한 작업(비밀번호 변경, 이메일 변경, 출금)에 재인증이 있는가
- 멱등성 키가 결제·주문에 있는가

### A07 — Authentication Failures

**존재 점검**
- JWT: `decode()` 로 끝내고 `verify()` 를 안 함, `algorithms` 미지정(`none`/알고리즘 혼동), 만료 미확인
- 세션 쿠키: `httpOnly:false`, `secure:false`, `sameSite:'none'`, 과도하게 긴 만료
- 로그아웃 시 세션이 서버에서 무효화되지 않음, 권한 상승 후 세션 ID 미재발급
- 사용자 열거 가능한 오류 메시지 ("없는 아이디" vs "비밀번호 틀림")

**부재 점검**
- MFA 경로가 있는가 (관리자 계정에라도)
- 비밀번호 정책·유출 비밀번호 차단이 있는가
- 무차별 대입 대응이 있는가 (A06 과 겹쳐도 양쪽에 적되, 최종 리포트에서 중복 병합)

### A08 — Software or Data Integrity Failures

**존재 점검**
- 웹훅 수신부가 HMAC 서명을 검증하는가 — 결제·배송·인증 웹훅이 서명 없이 상태를 바꾸면 치명적
- 역직렬화: 신뢰할 수 없는 데이터를 `pickle`, `yaml.load`, Java 직렬화로 복원
- 자동 업데이트·플러그인 로딩이 서명 검증 없이 이뤄짐
- CI/CD 파이프라인이 검증 없는 아티팩트를 배포

**부재 점검**
- 외부 스크립트에 SRI 가 없는가 (A03 과 같은 코드, 관점만 다름 — 한쪽에만 적을 것)
- 중요 데이터 변경에 감사 추적(audit trail)이 있는가

### A09 — Security Logging and Alerting Failures

**이 항목은 거의 전부 부재 점검이다.** 베이스라인이 통째로 놓친 항목.

**부재 점검**
- 로그인 실패, 권한 거부, 관리자 작업, 결제 변경이 **로그에 남는가**
- 남는다면 누가 그걸 **보는가** — 알림·경보 경로가 있는가 (2025 에서 "Alerting" 이 이름에 들어온 이유)
- 로그에 요청 추적 ID·행위자·시각이 있는가

**존재 점검 (과다 로깅)**
- 로그에 비밀번호·토큰·카드번호·주민번호가 평문으로 찍히는가
- 로그가 외부 서비스로 나가는데 마스킹이 없는가
- 로그 주입 — 사용자 입력이 개행 필터 없이 로그에 들어가는가

### A10 — Mishandling of Exceptional Conditions

2025 신설 항목. 도구가 잡지 못하고, 베이스라인도 놓쳤다.

**존재 점검**
- 예외를 삼키는 `catch` — 특히 **인증·권한 검사 주변**. 실패했는데 통과시키면 fail-open
- 오류 응답이 스택 트레이스·환경 변수·내부 경로·SQL 문을 클라이언트에 노출
- 반환값 오류를 확인하지 않음 (Go 의 `_ =`, C 의 반환 코드 무시)
- 오류 경로에서 자원 누수 — 트랜잭션 미롤백, 락 미해제, 파일 핸들 누수

**부재 점검**
- 외부 호출에 타임아웃·재시도 한도가 있는가 (없으면 연쇄 장애)
- 실패 시 기본 동작이 deny 인가 allow 인가 — **fail-open 인 지점을 모두 찾을 것**
- 부분 실패 시 데이터 정합성이 보장되는가

---

## 항목 배정이 겹칠 때

한 코드가 여러 항목에 해당하면 **가장 직접적인 원인 하나**에만 적는다.

> **겹치는 항목은 아무도 안 보는 사각지대가 된다.** 측정된 실패: CSRF 방어 부재를
> A01·A02·A07 담당이 모두 "다른 항목 소관"으로 판단해 셋 다 보고하지 않았다.
> 아래 표에 있으면 **지정된 항목 담당이 반드시 올린다.** 표에 없는 겹침을 만나면
> 미루지 말고 일단 올리고, 병합 단계에서 정리한다. 빠뜨리는 것보다 중복이 낫다.

| 사례 | 어디에 적는가 |
|---|---|
| 하드코딩된 JWT 서명 키 | A04 (암호 실패). A07 아님 |
| `jwt.decode()` 로 서명 미검증 | A07 (인증 실패). A04 아님 |
| SRI 없는 CDN 스크립트 | A03 (공급망) 한 곳만 |
| 로그인에 레이트 리밋 없음 | A06 (설계). A07 에 중복 기재 금지 |
| 세션 쿠키 플래그 취약 | A07 (인증). A02 아님 |
| **CSRF 방어 부재** (토큰 없음, `sameSite:'none'`) | **A01** (접근 제어). A02·A07 아님 |
| **예측 가능한 토큰** (`Math.random()`, 순번, 타임스탬프) | **A04** (암호 실패). 토큰의 만료·1회성 문제는 A06 |
| 에러 응답의 스택 트레이스 유출 | A10 (예외 처리). A02 아님 |
| 웹훅 서명 미검증 | A08 (무결성). A01 아님 |
| 민감정보 평문 로깅 | A09 (로깅). A04 아님 |
| 취약 버전 의존성 | A03 (공급망). 그 CVE 의 성격이 무엇이든 A03 |
