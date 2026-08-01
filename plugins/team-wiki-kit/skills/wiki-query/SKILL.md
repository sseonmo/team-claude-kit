---
name: wiki-query
description: Use when the user asks a question that should be answered from the wiki's accumulated knowledge rather than from general knowledge. Reads index.md first, drills into relevant pages, synthesizes an answer with citations, and offers to file good answers back into the wiki. Triggers - any substantive question about topics the wiki covers, "위키에서 찾아줘", "정리해줘", "비교해줘", "…에 대해 뭐라고 돼있어?".
---

# Query

위키에 대고 질문한다. 핵심은 두 가지: **인용 없는 답은 하지 않는다**, **좋은 답은 위키에 남긴다.**

시작 전에 `WIKI_SCHEMA.md`를 읽는다.

> `WIKI_SCHEMA.md` 가 없으면 이 프로젝트는 아직 위키가 아니다. 작업을 시작하지 말고 `/wiki-init` 을 안내한다.


## 절차

### 1. index.md부터
`wiki/index.md`를 먼저 읽는다. 여기서 관련 페이지를 추린다. 카탈로그를 건너뛰고 파일을 무작정 grep 하지 않는다 — index가 위키의 목차다.

index로 부족하면 그 다음에 `wiki/` 전체를 검색한다.

### 2. 페이지 읽기
추린 페이지를 **전부** 읽는다. 링크(`[[…]]`)를 타고 한 단계 더 들어간다. 관련 있는데 index에서 놓친 페이지가 거기 있다.

### 3. 답변
- 모든 주장에 출처를 단다: `([[페이지명]])` 또는 원본까지 `(raw/ep0N-…)`
- 위키에 **없는 내용은 없다고 말한다.** 일반 지식으로 메우지 말 것. 메워야겠으면 "위키 밖 정보"라고 명시한다.
- 페이지끼리 충돌하면 양쪽 다 보여주고 어느 소스가 더 최신/신뢰도 높은지 (frontmatter의 `sources` 수, `updated`) 알려준다.
- 답변 형식은 질문에 맞춘다 — 산문, 비교표, 타임라인, 목록.

### 4. 위키에 남길지 판단
답변이 **여러 페이지를 종합했거나 새로운 연결을 발견했다면**, 사람에게 물어본다:

> 이 분석 `wiki/concepts/<제목>.md`로 남길까요?

승낙하면:
- `wiki/concepts/`에 페이지 생성 (frontmatter의 `sources`에 근거로 쓴 에피소드를 전부 나열)
- 관련 concepts/people/tools 페이지에서 이 새 페이지로 역링크 추가
- `wiki/index.md` 갱신
- `wiki/log.md`에 append:
  ```markdown
  ## [YYYY-MM-DD] query | <질문 요약>

  - 참조: [[페이지A]], [[페이지B]]
  - 신규: [[제목]]
  ```

단순 사실 조회("X가 뭐야?")는 남기지 않는다. 종합·비교·발견만 남긴다.

### 5. 빈틈 보고
답하다가 위키의 구멍을 발견하면 알려준다 — "이 질문에 제대로 답하려면 Y에 대한 소스가 더 필요합니다."

## 체크리스트
- [ ] `WIKI_SCHEMA.md`와 `wiki/index.md`를 먼저 읽었다
- [ ] 링크를 한 단계 더 따라갔다
- [ ] 모든 주장에 인용이 붙어 있다
- [ ] 위키에 없는 건 없다고 말했다
- [ ] 종합·비교였다면 위키 페이지로 남길지 물어봤다
