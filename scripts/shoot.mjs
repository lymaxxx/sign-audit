import { readdir, readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

/** Rasterises the proof SVGs so the layout can actually be looked at. */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'proof-out')
const MAX_EDGE = 1500

const run = async () => {
  await mkdir(OUT, { recursive: true })
  const files = (await readdir(OUT)).filter((f) => f.endsWith('.svg')).sort()
  if (files.length === 0) {
    console.error('No SVGs in proof-out — run `npm run proof` first.')
    process.exit(1)
  }

  // The sandbox ships its own Chromium; the pinned playwright build may not
  // match it, so point at the binary that is actually there.
  const preinstalled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
  const fontCss = await readFile(join(OUT, 'fonts.css'), 'utf8')

  const browser = await chromium.launch(
    existsSync(preinstalled) ? { executablePath: preinstalled } : {},
  )
  const page = await browser.newPage({ deviceScaleFactor: 2 })

  for (const file of files) {
    const svg = await readFile(join(OUT, file), 'utf8')
    const [, w, h] = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg) ?? []
    const mmW = Number(w)
    const mmH = Number(h)
    const pxPerMm = Math.min(4, MAX_EDGE / Math.max(mmW, mmH))
    const pxW = Math.round(mmW * pxPerMm)
    const pxH = Math.round(mmH * pxPerMm)

    await page.setViewportSize({ width: pxW, height: pxH })
    await page.setContent(
      `<!doctype html><meta charset="utf-8">` +
        `<style>${fontCss}html,body{margin:0;padding:0;background:#fff}` +
        `svg{display:block;width:${pxW}px;height:${pxH}px}</style>${svg}`,
      { waitUntil: 'load' },
    )
    await page.evaluate(() => document.fonts.ready)
    const name = file.replace(/\.svg$/, '.png')
    await page.screenshot({ path: join(OUT, name) })
    console.log(`${name.padEnd(24)} ${pxW}×${pxH}px  (${mmW}×${mmH}mm)`)
  }

  await browser.close()
}

await run()
