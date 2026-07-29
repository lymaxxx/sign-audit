import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

/**
 * Imports a file through the picker, the way a person does.
 *
 * The unit tests cover the parsers; this covers the step in front of them —
 * the file dialog — which is where an import can be lost without a single
 * parser ever being called.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const URL = process.env.APP_URL ?? `file://${resolve(ROOT, 'TimetableGenerator.html')}`

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
}

const run = async () => {
  const preinstalled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
  const browser = await chromium.launch(existsSync(preinstalled) ? { executablePath: preinstalled } : {})
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })

  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  await page.goto(URL)
  await page.waitForSelector('.sheet svg', { timeout: 30000 })

  const stopCount = async () => Number(await page.locator('.sidebar-head .count').innerText())
  const before = await stopCount()

  const importFile = async (file) => {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      page.getByRole('button', { name: 'Import…' }).click(),
    ])
    await chooser.setFiles(join(ROOT, 'examples', file))
    // Give the picker's own dismissal fallback longer than its timeout, so a
    // regression that resolves empty shows up here rather than in the field.
    await page.waitForTimeout(1500)
  }

  await importFile('schedule-minimal.csv')
  const afterMinimal = await stopCount()
  check('importing a CSV replaces the stop list', afterMinimal === 1, `${before} → ${afterMinimal} stops`)

  const firstStop = await page.locator('.stop-name').first().innerText()
  check('the imported stop is the one in the file', /Aurora Cinema/.test(firstStop), firstStop.trim())

  const routeChips = await page.locator('.stop .route-chip').allInnerTexts()
  check('its routes came in too', routeChips.join(',') === '8,27,83', routeChips.join(', '))

  await page.waitForSelector('.sheet svg text')
  const texts = await page.locator('.sheet svg text').count()
  check('a sheet is laid out from the imported data', texts > 20, `${texts} text runs`)

  await importFile('schedule-trip-per-row.csv')
  const afterWide = await stopCount()
  check('a trip-per-row file imports as one stop per column', afterWide === 6, `${afterWide} stops`)

  await importFile('schedule-long-form.csv')
  const afterLong = await stopCount()
  check('the long form imports', afterLong === 6, `${afterLong} stops`)

  // Dismissing the picker must leave the project alone, not blank it.
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import…' }).click(),
  ])
  await chooser.setFiles([])
  await page.waitForTimeout(1200)
  check('cancelling the picker changes nothing', (await stopCount()) === afterLong, `${await stopCount()} stops`)

  check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  console.log(failures === 0 ? '\nImport works.' : `\n${failures} check(s) failed.`)
  await browser.close()
  if (failures > 0) process.exitCode = 1
}

await run()
