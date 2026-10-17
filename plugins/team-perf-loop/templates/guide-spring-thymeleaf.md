
## Spring Boot + Thymeleaf

서버가 HTML 을 렌더링한다. 브라우저가 받는 것은 템플릿 결과 + `static/` 리소스다.

| 가설 | 먼저 볼 곳 |
|---|---|
| `render-blocking-insight` | `templates/**` 의 `<head>` — 동기 `<script>` 에 `defer`, 당장 필요 없는 CSS 는 `media`/`preload` 로 미루기 |
| `unused-javascript`, `unused-css-rules`, `legacy-javascript-insight` | 페이지마다 공통 레이아웃(fragment)이 무거운 라이브러리를 통째로 싣는지. 그 페이지에서만 쓰는 스크립트는 그 템플릿으로 |
| `document-latency-insight`, `server-response-time` | `application.yml` 의 `server.compression.enabled`·`mime-types`, `spring.thymeleaf.cache` |
| `cache-insight`, `uses-long-cache-ttl` | `spring.web.resources.cache.cachecontrol.max-age`, `spring.web.resources.chain.strategy.content.enabled`(파일명에 해시 → 오래 캐시해도 안전) |
| `image-delivery-insight`, `lcp-discovery-insight` | `<img>` 의 `width`·`height`·`loading="lazy"`(LCP 요소는 제외)·`fetchpriority="high"` |
| `font-display-insight` | `@font-face` 의 `font-display` — 글꼴 자체는 바꾸지 않는다 |
| `cls-culprits-insight` | 크기 미지정 이미지·늦게 끼어드는 요소 |

- 컨트롤러·서비스·쿼리는 고칠 수 없다(허용 경로 밖). 응답이 느린 것은 위의 압축·캐시·리소스로만 접근한다
- `config/**` 의 `WebMvcConfigurer`(리소스 핸들러·캐시)는 고칠 수 있다. 빈 설정을 깨뜨리면 서버가 안 떠서 crash 로 탈락한다
