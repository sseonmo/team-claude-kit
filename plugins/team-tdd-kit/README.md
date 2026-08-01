# team-tdd-kit

테스트 없는 구현 코드 작성을 **차단**하는 TDD Guard hook.

프롬프트로 "테스트를 먼저 작성하라"고 부탁하는 것과, 시스템이 그걸 막는 것은 다르다.
이 플러그인은 후자를 담당한다 — 부탁을 결정론적 게이트로 바꾼다.

## 구성

| 종류 | 이벤트 | 하는 일 |
|---|---|---|
| Hook | `PreToolUse[Edit\|Write]` | 대상 모듈의 테스트 파일이 없으면 수정을 `deny` |

## 동작

```
1. lib/slugify.ts 작성 시도  → 차단. 파일이 디스크에 닿지 않는다
2. lib/slugify.test.ts 작성  → 통과 (테스트 파일은 예외)
3. lib/slugify.ts 재시도     → 통과
```

테스트 파일은 세 위치에서 찾는다:

- 같은 폴더 — `<name>.test.<ext>` 또는 `<name>.spec.<ext>`
- `__tests__/` — 같은 폴더 또는 부모 폴더
- 프로젝트 루트의 `src/__tests__/`

## 대상과 예외

**대상** — `.ts` `.tsx` `.js` `.jsx`

**예외 (테스트 없이 통과)**

| 분류 | 패턴 |
|---|---|
| 테스트 파일 | `*.test.*` `*.spec.*` `*__tests__*` |
| 설정·문서·스타일 | `*.json` `*.css` `*.scss` `*.md` `*.yml` `*.env*` `*.config.*` `tsconfig*` 등 |
| 타입 | `*/types/*` `*/types.ts` `*/types.d.ts` |
| Next.js 프레임워크 | `layout` `page` `loading` `error` `not-found` `globals.css` |
| presentation 레이어 | `*/components/*` |

`components/` 를 통째로 비워둔 것은 의도다 — **비즈니스 로직은 `lib/` 에 두고 거기서만 TDD를 강제**한다는
전제가 깔려 있다. 이 전제가 팀 컨벤션과 다르면 `hooks/tdd-guard.sh` 의 case 블록을 고쳐 쓴다.

## 전제

- `jq` 가 설치돼 있어야 한다 (hook 입력 JSON 파싱).
- 예외 목록이 **Next.js 레이아웃을 가정**한다. 다른 프레임워크에서는 그대로 쓰지 말고 조정할 것.
- `tests/` 디렉터리 레이아웃은 예외에 없다. 그 구조를 쓰면 case 블록에 `*/tests/*` 를 추가한다.

## 알려진 겹침

`Edit|Write` 에 훅을 거는 다른 TDD 플러그인과 함께 설치하면 **둘 다 발동한다.**
어느 하나라도 `deny` 하면 차단되므로, 프로젝트 전용 가드가 이미 있다면 둘 중 하나만 켤 것.

## 출처

hook 스크립트 원본: <https://github.com/jha0313/demo-project/blob/main/.claude/hooks/tdd-guard.sh>

팀 배포용으로 2건 수정했다.

- 테스트 파일 예외를 `*test*` 부분일치에서 `*.test.*|*.spec.*|*__tests__*` 로 좁힘.
  기존에는 `latest.ts` `contest.ts` 처럼 이름에 `test` 가 들어간 **구현 파일이 그냥 통과**했다.
- 거부 메시지의 확장자 안내를 `.ts` 고정에서 실제 확장자로 변경.
