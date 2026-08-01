# team-wiki-kit

Andrej Karpathy의 **LLM Wiki** 패턴 운영 키트.
사람은 소스를 고르고 질문하고, LLM이 위키를 만들고 유지한다.

## 구성

| 종류 | 이름 | 하는 일 |
|---|---|---|
| Command | `/wiki-init` | 프로젝트에 `WIKI_SCHEMA.md` + `wiki/` + `raw/` 부트스트랩 |
| Skill | `wiki-ingest` | `raw/` 소스를 위키 전체에 분배 (1회당 10~15 페이지) |
| Skill | `wiki-lint` | 모순·낡은 주장·고아 페이지·index 표류 8개 항목 점검 |
| Skill | `wiki-query` | index부터 훑어 인용 붙은 답변, 좋은 답은 위키에 환원 |

## 전제

세 스킬 모두 프로젝트 루트에 다음이 있어야 동작한다:

```
WIKI_SCHEMA.md
raw/<소스명>/script.md
wiki/{index.md, log.md, concepts/, people/, tools/}
```

없으면 `/wiki-init` 이 만들어 준다. `templates/WIKI_SCHEMA.md` 가 그 원본이며,
**프로젝트마다 고쳐 쓰는 것을 전제로 한다** — 카테고리와 소스 명명 규칙은 팀마다 다르다.

## 설계 원칙

- `raw/` 는 불변. 어떤 이유로도 수정하지 않는다.
- 모든 주장에 출처. 출처 없으면 쓰지 않는다.
- 모순은 덮어쓰지 말고 `> [!warning] 모순` 으로 표시한다.
- `lint` 는 기본적으로 보고만 한다. 자동 수정은 index/frontmatter로 한정.
