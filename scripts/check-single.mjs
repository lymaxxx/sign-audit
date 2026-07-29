import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

/**
 * Opens the single-file build the way a person would: straight off the disk.
 *
 * This is the check that matters for it — a `file://` page cannot fetch
 * anything, so it proves the fonts, styles and script really are inlined
 * rather than merely referenced.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = resolve(ROOT, 'TimetableGenerator.html')

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
}

const run = async () => {
  const preinstalled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
  const browser = await chromium.launch(existsSync(preinstalled) ? { executablePath: preinstalled } : {})
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })

  const errors = []
  const requests = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('request', (r) => !r.url().startsWith('file://') && requests.push(r.url()))

  await page.goto(`file://${FILE}`)
  await page.waitForSelector('.sheet svg', { timeout: 30000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(500)

  const texts = await page.locator('.sheet svg text').count()
  check('the sheet renders off the disk', texts > 100, `${texts} text runs`)

  check('nothing is fetched from the network', requests.length === 0, requests.slice(0, 2).join(', '))

  // Metrics come from the embedded font binaries, so a wrong or missing font
  // would show up as a different column count or a collapsed layout.
  const status = await page.locator('.canvas-status').innerText()
  check('the layout engine measured real fonts', /2 col/.test(status), status.replace(/\s+/g, ' ').trim())

  await page.getByRole('button', { name: 'Artboard' }).click()
  await page.selectOption('.group select', { label: 'Shelter panel, wide' })
  await page.waitForTimeout(500)
  const wide = await page.locator('.canvas-status').innerText()
  check('reflow works', /5 col/.test(wide), wide.replace(/\s+/g, ' ').trim())

  await page.screenshot({ path: join(ROOT, 'proof-out', 'single-file.png') })
  check('no errors on the console', errors.length === 0, errors.slice(0, 2).join(' | '))

  console.log(failures === 0 ? '\nSingle-file build works.' : `\n${failures} check(s) failed.`)
  await browser.close()
  if (failures > 0) process.exitCode = 1
}

await run()
