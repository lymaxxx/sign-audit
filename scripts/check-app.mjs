import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

/**
 * Drives the running app the way a person would.
 *
 * Typechecking says the code is consistent; this says the thing works — that
 * dragging a footer item moves it, that undo puts it back, and that "export
 * all" really writes one PDF per stop.
 */

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'proof-out')
const URL = process.env.APP_URL ?? 'http://localhost:5173/'

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
}

const run = async () => {
  await mkdir(OUT, { recursive: true })
  const preinstalled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
  const browser = await chromium.launch(existsSync(preinstalled) ? { executablePath: preinstalled } : {})
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true })
  const page = await context.newPage()

  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('favicon') && errors.push(m.text()))

  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('.sheet svg', { timeout: 20000 })
  await page.evaluate(() => document.fonts.ready)

  // --- the sheet renders -------------------------------------------------
  const times = await page.locator('.sheet svg text').count()
  check('the sheet draws departures', times > 100, `${times} text runs`)

  // --- flow responds to the artboard -------------------------------------
  const columnsNow = async () => (await page.locator('.canvas-status span').nth(1).innerText()).trim()
  const portrait = await columnsNow()
  await page.getByRole('button', { name: 'Artboard' }).click()
  await page.selectOption('.group select', { label: 'Shelter panel, wide' })
  await page.waitForTimeout(400)
  const wide = await columnsNow()
  check('a wider panel reflows into more columns', portrait !== wide, `${portrait} → ${wide}`)
  await page.selectOption('.group select', { label: 'A4 portrait' })
  await page.waitForTimeout(300)

  // --- vector editing ----------------------------------------------------
  await page.getByRole('button', { name: 'Header & footer' }).click()
  const before = await page.locator('.overlay-item').count()
  await page.getByRole('button', { name: '+ Text' }).first().click()
  await page.waitForTimeout(250)
  const after = await page.locator('.overlay-item').count()
  check('adding a header item puts a handle on the canvas', after === before + 1, `${before} → ${after}`)

  const item = page.locator('.overlay-item').last()
  const start = await item.boundingBox()
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(start.x + start.width / 2 + 120, start.y + start.height / 2 + 40, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(250)

  const moved = await page.locator('.overlay-item').last().boundingBox()
  check('dragging an item moves it', Math.abs(moved.x - start.x) > 40, `moved ${Math.round(moved.x - start.x)}px`)
  await page.screenshot({ path: join(OUT, 'app-06-vector-drag.png') })

  await page.keyboard.press('Control+z')
  await page.waitForTimeout(300)
  const undone = await page.locator('.overlay-item').last().boundingBox()
  check('undo puts it back in one step', Math.abs(undone.x - start.x) < 6, `off by ${Math.round(undone.x - start.x)}px`)

  // --- footer height pushes the schedule up ------------------------------
  const contentBefore = await page.locator('.canvas-status span').nth(2).innerText()
  const heightInput = page.locator('.group', { hasText: 'Footer band' }).locator('input[type=number]').first()
  await heightInput.fill('120')
  await heightInput.blur()
  await page.waitForTimeout(500)
  const contentAfter = await page.locator('.canvas-status span').nth(2).innerText()
  check('a taller footer forces the schedule to shrink', contentBefore !== contentAfter, `${contentBefore} → ${contentAfter}`)
  await heightInput.fill('14')
  await heightInput.blur()
  await page.waitForTimeout(400)

  // --- batch export ------------------------------------------------------
  const downloads = []
  page.on('download', (d) => downloads.push(d))

  await page.getByRole('button', { name: /Export all/ }).click()
  await page.waitForSelector('.progress-card h3', { timeout: 60000 })
  const summary = await page.locator('.progress-card h3').innerText()
  await page.screenshot({ path: join(OUT, 'app-07-batch.png') })

  check('batch export reports one sheet per stop', /Exported 6 sheets/.test(summary), summary)
  await page.waitForTimeout(1200)
  check('batch export actually wrote the files', downloads.length === 6, `${downloads.length} downloads`)

  const names = downloads.map((d) => d.suggestedFilename())
  check('files are named, not all called "download"', names.every((n) => n.endsWith('.pdf') && n !== 'download'), names.slice(0, 3).join(', '))
  check('every stop gets its own file', new Set(names).size === names.length)

  check('no console errors along the way', errors.length === 0, errors.slice(0, 2).join(' | '))

  console.log(failures === 0 ? '\nAll app checks passed.' : `\n${failures} check(s) failed.`)
  await browser.close()
  if (failures > 0) process.exitCode = 1
}

await run()
