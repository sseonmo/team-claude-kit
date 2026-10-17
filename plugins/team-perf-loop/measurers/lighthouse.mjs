// Lighthouse(모바일 기본값) 측정기. 원형: FinSight scripts/lighthouse/measure.mjs
//
// score  = 페이지별 Performance 중앙값의 평균
// guards = Accessibility·Best Practices·SEO (기준선보다 낮아지면 discard)
// opportunities = metricSavings 가 있는 performance audit

import { loadTool } from '../engine/tools.mjs'
import { MeasureError } from '../engine/server.mjs'

export const direction = 'higher'

const CATS = { perf: 'performance', a11y: 'accessibility', bp: 'best-practices', seo: 'seo' }
const GUARDS = ['a11y', 'bp', 'seo']
const TIME_METRICS = ['FCP', 'LCP', 'TBT', 'INP']

export function median(nums) {
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function summarizeLhr(lhr) {
  if (lhr.runtimeError) throw new Error(`Lighthouse runtimeError ${lhr.runtimeError.code}: ${lhr.runtimeError.message}`)
  const out = {}
  for (const [key, id] of Object.entries(CATS)) {
    const score = lhr.categories[id]?.score
    if (typeof score !== 'number') throw new Error(`${id} 점수가 없다`)
    out[key] = Math.round(score * 100)
  }
  // Lighthouse 13 은 기존 opportunity audit 상당수를 insight audit 으로 바꿨다.
  // audit 이름에 기대지 않고 metricSavings 가 있는 performance audit 을 모두 진단으로 본다.
  out.opportunities = lhr.categories.performance.auditRefs
    .map(({ id }) => ({ id, a: lhr.audits[id] }))
    .filter(({ a }) => a && typeof a.score === 'number' && a.score < 1 && a.metricSavings)
    .map(({ id, a }) => ({ id, savings: TIME_METRICS.reduce((s, k) => s + (a.metricSavings[k] ?? 0), 0) }))
    .filter((o) => o.savings > 0)
  return out
}

// 리다이렉트된 페이지를 재면 엉뚱한 점수가 조용히 기록된다(로그인 페이지 100점이 대시보드 점수로).
// 다른 곳에 도착했으면 그 경로를, 요청한 페이지면 null.
export function landedElsewhere(lhr, requestedPath) {
  const final = new URL(lhr.finalDisplayedUrl)
  const got = final.pathname + final.search
  return got === requestedPath ? null : got
}

export function aggregate(results) {
  const units = results.map(({ path: p, runs }) => ({
    id: p,
    score: median(runs.map((r) => r.perf)),
    guards: Object.fromEntries(GUARDS.map((g) => [g, median(runs.map((r) => r[g]))])),
  }))
  const score = Math.round((units.reduce((s, u) => s + u.score, 0) / units.length) * 100) / 100

  const ops = new Map()
  for (const { path: p, runs } of results) {
    for (const r of runs) {
      for (const o of r.opportunities) {
        const e = ops.get(o.id) ?? { id: o.id, total: 0, units: [] }
        e.total += o.savings / runs.length
        if (!e.units.includes(p)) e.units.push(p)
        ops.set(o.id, e)
      }
    }
  }
  const opportunities = [...ops.values()]
    .map(({ id, total, units: u }) => ({ id, savings: Math.round(total), units: u }))
    .sort((a, b) => b.savings - a.savings)
  return { score, units, opportunities }
}

// 로그인 쿠키는 extraHeaders 가 아니라 브라우저 쿠키 저장소에 넣는다. extraHeaders 는 SEO 감사의
// robots.txt 요청 같은 곳에 붙지 않아, 그 요청이 로그인 리다이렉트를 타며 익명 세션 쿠키를 심고
// 다음 회차부터 로그인 페이지를 재게 된다(Spring 샘플 실측: 1회차 /dashboard, 2·3회차 /login).
// 페이지마다 Chrome 을 새로 띄워 비로그인 페이지에 인증 쿠키가 섞이지 않게 한다.
export async function measure({ baseUrl, cookies, config, log }) {
  const { launch } = await loadTool('chrome-launcher')
  const { default: runLighthouse } = await loadTool('lighthouse')
  const { default: puppeteer } = await loadTool('puppeteer-core')
  const domain = new URL(baseUrl).hostname
  const results = []
  for (const p of config.measurer.pages) {
    const chrome = await launch({ chromeFlags: ['--headless=new'] })
    try {
      if (p.auth) {
        const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}` })
        await browser.setCookie(...cookies.map(({ name, value }) => ({ name, value, domain, path: '/' })))
        await browser.disconnect()
      }
      const runs = []
      for (let i = 0; i < config.measurer.runs; i++) {
        log(`${p.path} ${i + 1}/${config.measurer.runs}`)
        const r = await runLighthouse(`${baseUrl}${p.path}`, {
          port: chrome.port,
          output: 'json',
          logLevel: 'error',
          onlyCategories: Object.values(CATS),
        })
        const elsewhere = landedElsewhere(r.lhr, p.path)
        if (elsewhere) throw new MeasureError(1, `${p.path} 를 쟀는데 ${elsewhere} 에 도착했다 — 쿠키·리다이렉트 확인`)
        try {
          runs.push(summarizeLhr(r.lhr))
        } catch (e) {
          throw new MeasureError(1, `${p.path}: ${e.message}`)
        }
      }
      results.push({ path: p.path, runs })
    } finally {
      await chrome.kill()
    }
  }
  return aggregate(results)
}
