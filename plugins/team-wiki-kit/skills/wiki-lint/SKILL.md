---
name: wiki-lint
description: Use when the user asks to health-check, audit, or clean up the wiki, or periodically after several ingests. Scans all wiki pages for contradictions, stale claims, orphan pages, missing pages, broken links, and index drift, then reports findings ranked by severity and proposes next sources and questions. Triggers - "점검해줘", "위키 상태 봐줘", "lint", "정리 필요한 데 있어?", "건강검진".
---

# Lint

위키 건강 검진. 위키가 커지면 썩는다 — 이걸 막는 게 이 동작이다.

시작 전에 `WIKI_SCHEMA.md`를 읽는다.

> `WIKI_SCHEMA.md` 가 없으면 이 프로젝트는 아직 위키가 아니다. 작업을 시작하지 말고 `/wiki-init` 을 안내한다.


**중요: lint는 기본적으로 보고만 한다.** 발견한 문제를 나열하고, 고칠지 사람에게 묻는다. 자동으로 페이지를 지우거나 덮어쓰지 않는다. 단 아래 "자동 수정 허용" 항목은 예외.

## 점검 항목

`wiki/` 전체를 읽고 다음을 찾는다.

### 1. 모순 (severity: 높음)
서로 다른 페이지가 같은 사안에 대해 다르게 말하는 곳. 어느 소스에서 왔는지, `updated` 날짜가 어느 쪽이 최신인지 같이 보고한다.

### 2. 낡은 주장 (높음)
새 소스가 뒤집었는데 옛 페이지에 그대로 남아 있는 서술. `sources` 배열과 `updated` 날짜를 비교해서 찾는다.

### 3. 고아 페이지 (중간)
어디에서도 `[[링크]]`가 걸리지 않은 페이지. 아무도 도달할 수 없다는 뜻이다.

### 4. 없는 페이지 (중간)
`[[이렇게]]` 링크는 여러 페이지에 걸려 있는데 실제 파일이 없는 것. **링크 수가 많을수록 우선순위가 높다** — 위키가 "이 페이지 필요하다"고 말하고 있는 것이다.

### 5. 빈약한 페이지 (중간)
`status: stub`인데 오래 방치됐거나, `sources`가 1개뿐인데 중요해 보이는 페이지.

### 6. 누락된 교차참조 (낮음)
A 페이지가 B의 주제를 다루는데 `[[B]]` 링크가 없는 경우.

### 7. index 표류 (높음 — 자동 수정 허용)
`wiki/index.md`에 없는 페이지, 또는 index에는 있는데 파일이 없는 항목. **이건 물어보지 말고 고친다.** index는 사실 기록이지 판단이 아니다.

### 8. frontmatter 불량 (낮음 — 자동 수정 허용)
`type`/`created`/`updated`/`sources`/`status` 누락. 파악 가능한 값은 채운다.

## 보고 형식

```markdown
# 위키 점검 — YYYY-MM-DD

전체 N개 페이지 / 소스 M개

## 자동 수정함
- index.md: 미등록 페이지 3개 추가
- frontmatter: 2개 페이지 `updated` 보정

## 조치 필요 (심각도 순)

### 🔴 모순
1. [[페이지A]] vs [[페이지B]] — …
   → 제안: …

### 🟡 없는 페이지 (링크 수 순)
1. `[[하네스]]` — 4곳에서 참조, 페이지 없음

### 🟡 고아 페이지
…

## 다음에 할 일
**찾아볼 소스**: …
**던져볼 질문**: …
```

마지막 "다음에 할 일"이 lint의 진짜 가치다. 형식 점검만 하고 끝내지 마라 — **위키의 빈 곳을 보고 무엇을 더 읽어야 하는지, 무엇을 물어봐야 하는지 제안한다.**

## 마무리
`wiki/log.md`에 append:
```markdown
## [YYYY-MM-DD] lint | 페이지 N개 점검, 이슈 M건

- 자동 수정: …
- 미해결: …
```

## 체크리스트
- [ ] 모든 위키 페이지를 읽었다 (샘플링하지 않았다)
- [ ] 8개 항목을 다 점검했다
- [ ] 자동 수정은 index/frontmatter로만 한정했다
- [ ] 나머지는 지우지 않고 보고만 했다
- [ ] 다음 소스·질문을 제안했다
- [ ] `wiki/log.md`에 append 했다
