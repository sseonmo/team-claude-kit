---
name: wiki-ingest
description: Use when the user asks to ingest, file, add, or process a source from raw/ into the wiki. Reads the raw script, discusses takeaways, then creates and updates concept/people/tool pages across the wiki plus index.md and log.md. Triggers - "ep01 넣어줘", "소스 추가해줘", "이 글 정리해줘", "ingest", "파일링해줘".
---

# Ingest

`raw/`의 소스를 위키에 통합한다. **페이지 두세 개 만들고 끝내는 게 아니다.** 한 번의 ingest는 보통 10~15개 페이지를 건드린다.

시작 전에 `WIKI_SCHEMA.md`를 읽는다. 규칙이 거기 있다.

> `WIKI_SCHEMA.md` 가 없으면 이 프로젝트는 아직 위키가 아니다. 작업을 시작하지 말고 `/wiki-init` 을 안내한다.


## 절차

### 1. 읽기
`raw/<에피소드>/script.md`를 **전부** 읽는다. 앞부분만 보고 진행하지 않는다.
`slides/`가 있으면 `index.html`을 훑어 스크립트에 없는 도식·표가 있는지 확인한다.

### 2. 논의 (기본값: 사람과 같이)
읽은 뒤 멈추고 사람에게 제시한다:
- 핵심 주장 3~5개
- 이미 위키에 있는 내용과 **겹치는 부분** / **충돌하는 부분**
- 새로 만들 페이지 후보 — 어느 카테고리(`concepts`/`people`/`tools`)에 넣을지 포함

사람이 "알아서 해"라고 하거나 배치 처리를 요청한 경우에만 건너뛴다.

### 3. 페이지 생성·갱신 — 여기가 작업의 전부다
소스에서 나온 정보를 위키 전체에 분배한다. **소스 요약 페이지는 만들지 않는다.**

- **`wiki/concepts/`** — 소스가 다루는 개념마다 한 페이지. 이미 있으면 갱신, 없으면 생성.
- **`wiki/people/`** — 언급된 사람.
- **`wiki/tools/`** — 언급된 도구·제품·프로토콜.

각 페이지를 건드릴 때:
- frontmatter의 `sources` 배열에 이번 에피소드 폴더명을 추가한다.
- `updated`를 오늘 날짜로 바꾼다.
- `sources`가 3개 이상이 됐으면 `status: solid`로 올린다.
- 관련 페이지로 `[[링크]]`를 건다. 아직 없는 페이지를 가리켜도 된다.

**모순 발견 시** — 기존 서술을 지우지 말고 표시한다:
```markdown
> [!warning] 모순
> ep02는 X라고 하고, ep04는 Y라고 한다. 아직 확인 안 됨.
```

### 4. index.md 갱신
`wiki/index.md`에서:
- 새 페이지를 카테고리별 목록에 등록 (링크 + 한 줄 요약 + 소스 수)
- 갱신된 페이지의 한 줄 요약·소스 수 수정
- 이번 소스를 "ingest 대기"에서 "완료"로 이동

**이 단계를 빠뜨리면 위키가 검색 불가능해진다.**

### 5. log.md 추가
`wiki/log.md` 맨 끝에 append. 기존 항목은 건드리지 않는다.

```markdown
## [YYYY-MM-DD] ingest | ep0N-제목

- 신규: [[페이지A]], [[페이지B]]
- 갱신: [[페이지C]], [[페이지D]]
- 모순 표시: …
```

### 6. 보고
사람에게 요약해 준다: 만든 페이지, 고친 페이지, 발견한 모순, **다음에 던져볼 질문.**

## 체크리스트
- [ ] `WIKI_SCHEMA.md`를 읽었다
- [ ] script.md 전문을 읽었다
- [ ] `raw/` 안의 파일을 수정하지 않았다
- [ ] concepts/people/tools 세 곳에 분배했다 (페이지 두세 개로 끝내지 않았다)
- [ ] 건드린 모든 페이지의 `sources` / `updated` frontmatter를 갱신했다
- [ ] `wiki/index.md`를 갱신했다
- [ ] `wiki/log.md`에 append 했다
