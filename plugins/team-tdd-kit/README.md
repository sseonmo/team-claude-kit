# team-tdd-kit

테스트 없는 **새 구현 파일**의 작성을 차단하는 TDD Guard hook. Java · Python · Node 지원.

프롬프트로 "테스트를 먼저 작성하라"고 부탁하는 것과, 시스템이 그걸 막는 것은 다르다.
이 플러그인은 후자를 담당한다 — 부탁을 결정론적 게이트로 바꾼다.

## 구성

| 종류 | 이벤트 | 하는 일 |
|---|---|---|
| Hook | `PreToolUse[Edit\|Write]` | 대상 모듈의 테스트 파일이 없으면 **신규 파일** 작성을 `deny` |

의존성 없음 — Node 내장 모듈만 쓴다.

## 동작

```
1. lib/slugify.ts 새로 작성 시도 → 차단. 파일이 디스크에 닿지 않는다
2. lib/slugify.test.ts 작성      → 통과 (테스트 파일은 예외)
3. lib/slugify.ts 재시도         → 통과
```

**이미 있는 파일의 수정은 막지 않는다.** 차단은 새 파일을 만들 때만 걸린다.
테스트 없는 레거시가 쌓인 저장소에 그대로 켤 수 있게 하기 위한 선택이고,
그 대가로 *기존 파일에 테스트 없이 기능을 덧붙이는 것*은 막지 못한다.

## 언어별 인정 규칙

관례가 갈리는 축이 둘이다 — 구분자(`.` vs `_` vs CamelCase)와 배치(같은 폴더 vs 미러링된 별도 트리).

| 언어 | 대상 확장자 | 인정하는 테스트 위치 |
|---|---|---|
| Node | `.ts` `.tsx` `.js` `.jsx` `.mjs` `.cjs` | 같은 폴더 `<name>.test.*` / `<name>.spec.*`<br>`__tests__/` — 같은 폴더 또는 부모 폴더 (`.test.` `.spec.` 둘 다) |
| Python | `.py` | 같은 폴더 `test_<name>.py` / `<name>_test.py`<br>같은·부모 폴더의 `tests/`<br>루트 `tests/` — 플랫(`tests/test_x.py`)과 미러링(`tests/services/test_x.py`) 모두 |
| Java | `.java` | `src/main/java/<pkg>/` ↔ `src/test/java/<pkg>/` 미러링, `<Name>Test.java` / `<Name>Tests.java`<br>`src/main` 구조가 아니면 같은 폴더로 폴백 |

**그 외 언어(Go·Rust·Ruby 등)는 검사하지 않는다.** 통과는 "검사했고 문제없음"이 아니라
"검사 대상이 아님"이다.

## 테스트 파일로 인정되는 이름 (작성이 막히지 않는다)

| 언어 | 패턴 |
|---|---|
| Node | `*.test.*` `*.spec.*` `__tests__/` 하위 |
| Python | `test_*.py` `*_test.py` `conftest.py` `tests/`·`test/` 하위 |
| Java | `*Test.java` `*Tests.java` `*TestCase.java` `src/test/` 하위 |

## 테스트를 요구하지 않는 파일

| 언어 | 예외 |
|---|---|
| Node | `*.d.ts`, `*.config.*`, `types/`·`components/` 폴더, `app/`·`pages/` **안의** Next.js 라우팅 파일(`layout` `page` `loading` `error` `not-found`) |
| Python | `__init__.py` `setup.py` `conftest.py` `manage.py`, `migrations/` 폴더 |
| Java | `package-info.java` `module-info.java` |

예외는 **파일명 또는 경로 세그먼트 단위**로만 걸린다. 경로 전체에 부분일치를 걸면
`tailwind-app/` 같은 상위 폴더 이름 하나로 그 아래 트리 전체가 조용히 무력화된다(0.1.0 의 실제 구멍).

`components/` 를 통째로 비워둔 것은 의도다 — **비즈니스 로직은 `lib/` 에 두고 거기서만 TDD를 강제**한다는
전제가 깔려 있다. 이 전제가 팀 컨벤션과 다르면 `lib/tdd-rules.mjs` 의 `NODE_EXEMPT_DIRS` 를 고쳐 쓴다.

## 한계 — 이걸로 막지 못하는 것

이 훅은 **실수 방지용**이다. 우회하려는 사람을 막지 못한다.

- **테스트 파일은 존재 여부만 본다.** 내용을 검사하지 않으므로 빈 파일 하나로 게이트가 열린다.
- **기존 파일 수정은 통과한다.** 위 "동작" 참고.
- **Python 루트 `tests/` 플랫 배치**는 모듈명만 같으면 다른 패키지의 테스트로도 통과된다.
  pytest 의 지배적 관례를 존중한 대가다. 미러링(`tests/<pkg>/test_x.py`)을 쓰면 정확히 대응된다.
- **`Bash` 는 거치지 않는다.** `cat > lib/x.ts` 로 만든 파일은 훅을 타지 않는다.
- **끄는 스위치가 없다.** 신규 파일만 막으므로 상시 해제가 필요할 상황을 상정하지 않았다.
  필요해지면 그때 추가한다.

## 알려진 겹침

`Edit|Write` 에 훅을 거는 다른 TDD 플러그인과 함께 설치하면 **둘 다 발동한다.**
어느 하나라도 `deny` 하면 차단되므로, 프로젝트 전용 가드가 이미 있다면 둘 중 하나만 켤 것.

## 테스트

```bash
cd plugins/team-tdd-kit && npm test
```

## 출처

hook 원본(bash, TS/JS 전용): <https://github.com/jha0313/demo-project/blob/main/.claude/hooks/tdd-guard.sh>

0.2.0 에서 Node 로 다시 쓰면서 바뀐 것:

- **Java · Python 지원 추가.** 0.1.0 은 `.ts .tsx .js .jsx` 외의 확장자를 만나면
  검사를 통째로 건너뛰고 **아무 신호 없이 통과**시켰다 — 다른 언어 저장소에서는 강제력이 0이었다.
- **신규 파일만 차단.** 0.1.0 은 기존 파일 수정도 막아 레거시 저장소에 도입할 수 없었다.
- **예외 패턴을 파일명·세그먼트 기준으로 좁힘.** `tailwind-app/lib/auth.ts` 처럼
  상위 폴더 이름만으로 가드가 죽던 문제.
- **저장소 전역 basename 매칭 제거.** `lib/a/util.ts` 와 `lib/b/util.ts` 가
  `src/__tests__/util.test.ts` 하나로 둘 다 통과하던 문제.
- **`__tests__/` 안의 `.spec` 인정.** 같은 폴더에서만 인정되고 `__tests__/` 에서는 누락돼 있었다.
- **`jq` 의존 제거.** `jq` 가 없으면 경로 파싱이 실패해 게이트가 통째로 열렸다.
- **테스트 21건 추가.** 0.1.0 은 자체 테스트가 없었다.
