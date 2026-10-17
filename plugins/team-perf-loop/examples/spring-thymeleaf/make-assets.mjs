// 일부러 무거운 정적 리소스를 결정론적으로 만든다. 저장소에 수 MB 를 커밋하지 않으려고 생성한다.
//   node make-assets.mjs     (perf-loop 측정 도구가 설치된 뒤 — sharp 를 그 디렉터리에서 빌린다)
//
// 같은 입력이면 바이트 단위로 같은 파일이 나온다(시드 고정 난수). 스크린샷 관문의 기준이 흔들리지 않게.

import { mkdirSync, writeFileSync } from 'node:fs'

import { loadTool } from '../../engine/tools.mjs'

const STATIC = 'src/main/resources/static'
let seed = 42
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)

// vendor.js — 3000개 함수 중 하나만 쓴다(unused-javascript). 로드 시 메인 스레드를 잡는다(TBT).
const fns = Array.from({ length: 3000 }, (_, i) =>
  `function util${i}(a){var s=${JSON.stringify('x'.repeat(120) + i)};return s.length+a*${i}}`)
const js = `${fns.join('\n')}
(function(){var t=0;for(var i=0;i<4000000;i++){t+=util7(i%3)}window.__sampleReady=t>0})();
`
mkdirSync(`${STATIC}/js`, { recursive: true })
writeFileSync(`${STATIC}/js/vendor.js`, js)

// vendor.css — 화면에 없는 클래스 규칙 4000개(unused-css-rules, render-blocking)
const css = Array.from({ length: 4000 }, (_, i) =>
  `.u-${i}{margin:${i % 7}px;padding:${i % 5}px;color:#${(i * 2654435761 % 0xffffff).toString(16).padStart(6, '0')};border:1px solid #eee}`).join('\n')
mkdirSync(`${STATIC}/css`, { recursive: true })
writeFileSync(`${STATIC}/css/vendor.css`, css + '\n')

// hero.png — 1600x900 그라데이션 + 잡음. PNG 로는 잘 줄지 않아 크다(image-delivery)
const W = 1600
const H = 900
const px = Buffer.alloc(W * H * 3)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3
    const n = Math.floor(rand() * 40)
    px[i] = Math.min(255, 40 + Math.floor((x / W) * 120) + n)
    px[i + 1] = Math.min(255, 90 + Math.floor((y / H) * 100) + n)
    px[i + 2] = Math.min(255, 200 + n)
  }
}
const { default: sharp } = await loadTool('sharp')
mkdirSync(`${STATIC}/img`, { recursive: true })
await sharp(px, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 9 }).toFile(`${STATIC}/img/hero.png`)

console.log('assets ok')
