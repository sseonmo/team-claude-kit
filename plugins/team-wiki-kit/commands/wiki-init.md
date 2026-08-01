---
description: 현재 프로젝트에 LLM Wiki 구조를 부트스트랩한다 (WIKI_SCHEMA.md + wiki/ + raw/)
argument-hint: "[위키 주제 한 줄 — 생략 가능]"
allowed-tools: Bash(mkdir:*), Bash(cp:*), Bash(ls:*), Bash(find:*), Read, Write, Edit
---

# wiki-init

`team-wiki-kit`의 세 스킬(`wiki-ingest` / `wiki-lint` / `wiki-query`)이 동작하려면
프로젝트에 `WIKI_SCHEMA.md` + `wiki/` + `raw/` 구조가 있어야 한다. 이 명령이 그걸 만든다.

사용자가 준 위키 주제: $ARGUMENTS

## 절차

### 1. 기존 구조 확인 — 덮어쓰지 않는다

```bash
ls -d WIKI_SCHEMA.md wiki raw 2>/dev/null
```

`WIKI_SCHEMA.md`가 이미 있으면 **멈추고 사용자에게 알린다.** 절대 덮어쓰지 않는다.
`wiki/`나 `raw/`만 있으면 없는 것만 채운다.

### 2. 디렉터리 생성

```bash
mkdir -p wiki/concepts wiki/people wiki/tools raw
```

### 3. 스키마 템플릿 복사

```bash
TPL=$(find "$HOME/.claude/plugins" -path '*team-wiki-kit/templates/WIKI_SCHEMA.md' 2>/dev/null | head -1)
cp "$TPL" ./WIKI_SCHEMA.md
```

`TPL`이 비면 플러그인이 제대로 설치되지 않은 것이다 — 사용자에게 알리고 중단한다.

복사한 뒤 `## 이 위키가 담는 것` 아래 TODO 주석을 **사용자가 준 주제로 채운다.**
주제를 안 줬으면 무엇을 담을 위키인지 사용자에게 묻는다. 이 칸이 비면 ingest 때마다 범위가 흔들린다.

### 4. `wiki/index.md` 생성

```markdown
# Index

전체 0개 페이지 / 소스 0개

## 소스 현황

### ingest 대기
(아직 없음 — `raw/<소스명>/script.md` 로 추가한다)

### 완료
(없음)

## concepts
(없음)

## people
(없음)

## tools
(없음)
```

### 5. `wiki/log.md` 생성

```markdown
# Log

Append-only. 기존 항목은 절대 수정하지 않는다.

## [<오늘 날짜>] init | 위키 초기화

- 생성: `WIKI_SCHEMA.md`, `wiki/index.md`, `wiki/log.md`
- 카테고리: concepts, people, tools
```

날짜는 실제 오늘 날짜를 쓴다.

### 6. 보고

만든 파일 목록을 알려주고, **다음 단계를 안내한다**:

> `raw/<소스명>/script.md` 에 첫 소스를 넣고 "ingest 해줘" 라고 하세요.

## 체크리스트
- [ ] 기존 `WIKI_SCHEMA.md`를 덮어쓰지 않았다
- [ ] `## 이 위키가 담는 것` 칸을 실제 내용으로 채웠다 (TODO 주석을 남기지 않았다)
- [ ] `wiki/index.md`와 `wiki/log.md`를 만들었다
- [ ] 다음 단계를 안내했다
