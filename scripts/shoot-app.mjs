import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

/** Drives the running dev server so the interface can be looked at. */

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'proof-out')
const URL = process.env.APP_URL ?? 'http://localhost:5173/'

const run = async () => {
  await mkdir(OUT, { recursive: true })
  const preinstalled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
  const browser = await chromium.launch(existsSync(preinstalled) ? { executablePath: preinstalled } : {})
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })

  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('.sheet svg', { timeout: 20000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, 'app-01-default.png') })

  // A wide shelter panel: the blocks should run across instead of stacking.
  await page.getByRole('button', { name: 'Artboard' }).click()
  await page.selectOption('.group select', { label: 'Shelter panel, wide' })
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(OUT, 'app-02-wide.png') })

  // Guides on, so the bands and the content area are visible.
  await page.getByText('Guides', { exact: true }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, 'app-03-guides.png') })

  // The type panel, where hour and minute are separate roles.
  await page.getByRole('button', { name: 'Type' }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT, 'app-04-type.png') })

  // A different stop, to show the sheets really differ.
  await page.getByRole('button', { name: 'Artboard' }).click()
  await page.selectOption('.group select', { label: 'A4 portrait' })
  await page.getByText('Первоконная улица').click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(OUT, 'app-05-other-stop.png') })

  console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors')
  await browser.close()
}

await run()
