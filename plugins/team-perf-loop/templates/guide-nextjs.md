
## Next.js (App Router)

| 가설 | 먼저 볼 곳 |
|---|---|
| `unused-javascript`, `legacy-javascript-insight` | `"use client"` 경계가 너무 위에 있는지, 무거운 클라이언트 컴포넌트를 `next/dynamic` 으로 미룰 수 있는지 |
| `render-blocking-insight`, `font-display-insight` | `layout.tsx` 의 폰트·CSS 로딩, `next/font` 사용 여부. 폰트는 로딩 방식(`preload`·`display`)만 |
| `lcp-discovery-insight`, `image-delivery-insight` | LCP 요소가 `next/image` 인지, `priority`·`sizes` |
| `cls-culprits-insight` | 크기 미지정 이미지·늦게 끼어드는 배너 |
| `server-response-time`, `document-latency-insight` | `loading.tsx` 로 셸을 먼저 흘려보낼 수 있는지 |

- 데이터 조회 코드는 대개 허용 경로 밖이다. 렌더링 구조(클라이언트 경계, `next/dynamic`, 스트리밍, 이미지·폰트 로딩)로 접근한다
