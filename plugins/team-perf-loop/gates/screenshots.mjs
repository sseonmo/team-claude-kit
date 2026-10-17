// 스크린샷 관문. 후보의 최종 화면이 기준선과 픽셀 단위로 같은지 본다. 원형: FinSight scripts/lighthouse/shots.mjs
//
// 판정은 엄격하다 — FinSight 에서 같은 커밋 두 번 촬영이 22장 전부 0px 이었으므로 허용치를 두지 않는다.
// 채널 차이 16 이하는 같은 것으로 본다(안티앨리어싱).

import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

import { MeasureError, preflightErrorCode } from '../engine/server.mjs'
import { loadTool } from '../engine/tools.mjs'

export const VIEWPORTS = {
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
  desktop: { width: 1440, height: 900 },
}
export const THRESHOLD = 16
export const RETAKES = 2

export const shotName = (viewport, p) => `${viewport}${p === '/' ? '__root' : p.replace(/[/?&=]/g, '_')}.png`

export function listScreens(screens, viewports) {
  return Object.keys(viewports).flatMap((viewport) =>
    screens.map(({ path, auth }) => ({ viewport, path, auth, name: shotName(viewport, path), label: `${viewport} ${path}` })))
}

// RGBA 버퍼 두 개에서 RGB 채널 차이가 THRESHOLD 를 넘는 픽셀을 센다. alpha 는 보지 않는다.
export function comparePixels(a, b) {
  const mask = new Uint8Array(a.length / 4)
  let count = 0
  for (let i = 0, p = 0; i < a.length; i += 4, p++) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]))
    if (d > THRESHOLD) {
      mask[p] = 1
      count++
    }
  }
  return { count, mask }
}

const differs = (r) => r.sizeA !== r.sizeB || r.diffPx > 0

export function judgeShots(results) {
  const diffs = results.filter(differs).map((r) =>
    r.sizeA !== r.sizeB
      ? `${r.label} 크기 ${r.sizeA}→${r.sizeB ?? '없음'}`
      : `${r.label} ${((r.diffPx / r.total) * 100).toFixed(2)}%`)
  return { ok: diffs.length === 0, diffs }
}

export function pickRetakes(results) {
  return results.filter(differs).map((r) => r.name)
}

// 측정 프리플라이트와 같은 기준: 5xx 는 후보가 깨뜨린 것(2), 리다이렉트·그 밖은 환경 문제(1).
export function navErrorCode(status, redirected) {
  if (redirected) return 1
  if (status === 200) return null
  return preflightErrorCode(status)
}

// 이동 예외(서버 다운·연결 거부·타임아웃)는 후보 탓이라 단정할 수 없다. crash 로 세면 pickHypotheses 가
// 실패로 쳐서 멀쩡한 가설이 이력에서 영구히 빠진다. 후보가 페이지를 깨뜨린 것은 5xx 로 잡힌다.
export function gotoFailure(label, e) {
  return new MeasureError(1, `${label} 이동 실패: ${e.message}`)
}

const FREEZE = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'

const viewportsOf = (config) => config.gate.viewports ?? VIEWPORTS

function log(msg) {
  process.stderr.write(`[shots] ${msg}\n`)
}

async function launchBrowser() {
  const { Launcher } = await loadTool('chrome-launcher')
  const executablePath = Launcher.getInstallations()[0]
  if (!executablePath) throw new MeasureError(1, 'Chrome 을 찾지 못했다')
  const { default: puppeteer } = await loadTool('puppeteer-core')
  try {
    return await puppeteer.launch({ executablePath, headless: true, args: ['--font-render-hinting=none', '--disable-gpu'] })
  } catch (e) {
    throw new MeasureError(1, `Chrome 실행 실패: ${e.message}`)
  }
}

async function capture({ baseUrl, cookies }, config, outDir, only) {
  mkdirSync(outDir, { recursive: true })
  const domain = new URL(baseUrl).hostname
  const viewports = viewportsOf(config)
  const targets = listScreens(config.gate.screens, viewports).filter((s) => !only || only.includes(s.name))
  const browser = await launchBrowser()
  try {
    for (const s of targets) {
      const ctx = await browser.createBrowserContext()
      try {
        const page = await ctx.newPage()
        await page.setViewport({ ...viewports[s.viewport], deviceScaleFactor: 1 })
        if (s.auth) await ctx.setCookie(...cookies.map(({ name, value }) => ({ name, value, domain, path: '/' })))
        let res
        try {
          res = await page.goto(baseUrl + s.path, { waitUntil: 'networkidle0', timeout: 60000 })
        } catch (e) {
          throw gotoFailure(s.label, e)
        }
        const code = navErrorCode(res.status(), res.request().redirectChain().length > 0)
        if (code) throw new MeasureError(code, `${s.label} HTTP ${res.status()} → ${page.url()}`)
        await page.addStyleTag({ content: FREEZE })
        await page.evaluate(() => document.fonts.ready)
        await new Promise((r) => setTimeout(r, 500))
        await page.screenshot({ path: path.join(outDir, s.name), fullPage: true })
        log(s.label)
      } finally {
        await ctx.close()
      }
    }
  } finally {
    await browser.close()
  }
}

async function writeDiff(sharp, A, mask, file) {
  const { width, height } = A.info
  const img = Buffer.alloc(width * height * 4)
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4
    if (mask[p]) img.set([255, 0, 0, 255], i)
    else {
      const g = Math.round(((A.data[i] + A.data[i + 1] + A.data[i + 2]) / 3) * 0.3 + 178)
      img.set([g, g, g, 255], i)
    }
  }
  await sharp(img, { raw: { width, height, channels: 4 } }).png().toFile(file)
}

async function compare(config, refDir, dir, diffDir) {
  const { default: sharp } = await loadTool('sharp')
  rmSync(diffDir, { recursive: true, force: true })
  mkdirSync(diffDir, { recursive: true })
  const read = (f) => (existsSync(f) ? sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true }) : null)
  const results = []
  for (const s of listScreens(config.gate.screens, viewportsOf(config))) {
    const A = await read(path.join(refDir, s.name))
    if (!A) throw new MeasureError(1, `기준 이미지가 없다: ${path.join(refDir, s.name)}`)
    const B = await read(path.join(dir, s.name))
    const sizeA = `${A.info.width}x${A.info.height}`
    const sizeB = B ? `${B.info.width}x${B.info.height}` : null
    const total = A.info.width * A.info.height
    if (sizeA !== sizeB) {
      results.push({ ...s, sizeA, sizeB, diffPx: null, total })
      continue
    }
    const { count, mask } = comparePixels(A.data, B.data)
    results.push({ ...s, sizeA, sizeB, diffPx: count, total })
    if (count) await writeDiff(sharp, A, mask, path.join(diffDir, s.name))
  }
  return results
}

// 기준은 연속 두 촬영이 같아야 채택한다. 기준이 틀리면 그 실행의 모든 후보가 억울하게 탈락한다.
// FinSight 에서 CSS 없이 찍힌 촬영(99.8% diff)이 실제로 1회 관측됐다.
export async function captureRef(server, config, refDir) {
  const checkDir = `${refDir}-check`
  rmSync(refDir, { recursive: true, force: true })
  rmSync(checkDir, { recursive: true, force: true })
  await capture(server, config, refDir)
  await capture(server, config, checkDir)
  let results = await compare(config, refDir, checkDir, `${refDir}-diff`)
  for (let i = 0; i < RETAKES && !judgeShots(results).ok; i++) {
    const names = pickRetakes(results)
    // 직전 촬영을 새 기준 후보로 두고 한 번 더 찍어 맞춰 본다
    for (const n of names) copyFileSync(path.join(checkDir, n), path.join(refDir, n))
    await capture(server, config, checkDir, names)
    results = await compare(config, refDir, checkDir, `${refDir}-diff`)
  }
  const { ok, diffs } = judgeShots(results)
  if (!ok) throw new MeasureError(1, `기준 이미지가 안정되지 않는다: ${diffs.join(', ')}`)
}

export async function check(server, config, refDir, dir) {
  const shotDir = path.join(dir, 'shots')
  const diffDir = path.join(dir, 'diff')
  rmSync(shotDir, { recursive: true, force: true })
  await capture(server, config, shotDir)
  let results = await compare(config, refDir, shotDir, diffDir)
  for (let i = 0; i < RETAKES && !judgeShots(results).ok; i++) {
    await capture(server, config, shotDir, pickRetakes(results))
    results = await compare(config, refDir, shotDir, diffDir)
  }
  return judgeShots(results)
}
