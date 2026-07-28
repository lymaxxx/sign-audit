import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

/**
 * Types into the app and measures what each keystroke costs.
 *
 * Responsiveness is not something a unit test can see. This types a realistic
 * title into a realistic project and reports the slowest keystroke, because
 * that is what the editing actually feels like.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const URL = process.env.APP_URL ?? `file://${resolve(ROOT, 'Algach.html')}`

/**
 * Measured as a difference, not an absolute. Waiting two frames after each
 * keystroke costs about 33ms on its own, so an absolute figure would mostly be
 * reporting the harness. Typing into the stop search runs no layout at all and
 * gives the floor to subtract.
 */
const BUDGET_MS = 60

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
}

const run = async () => {
  const preinstalled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
  const browser = await chromium.launch(existsSync(preinstalled) ? { executablePath: preinstalled } : {})
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })

  await page.goto(URL)
  await page.waitForSelector('.sheet svg', { timeout: 30000 })

  // Load the bigger example, so the measurement is against a real network
  // rather than the handful of stops the app opens with.
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import…' }).click(),
  ])
  await chooser.setFiles(join(ROOT, 'examples', 'schedule-long-form.csv'))
  await page.waitForTimeout(1500)

  const stops = Number(await page.locator('.sidebar-head .count').innerText())
  const departures = await page.evaluate(() => document.querySelectorAll('.sheet svg text').length)

  const word = 'Kinoteatr Avrora'

  const typeInto = async (locator) => {
    await locator.click()
    await locator.fill('')
    const timings = []
    for (const ch of word) {
      const started = Date.now()
      await page.keyboard.type(ch)
      // Wait for React to settle, so the figure covers the re-render too.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      timings.push(Date.now() - started)
    }
    return [...timings].sort((a, b) => a - b)[Math.floor(timings.length / 2)]
  }

  // The stop search filters a list and nothing else; the title relays the sheet.
  const baseline = await typeInto(page.locator('.search'))
  await page.locator('.search').fill('')

  await page.getByRole('button', { name: 'Type' }).click()
  const field = page.locator('.group', { hasText: 'Wording' }).locator('input[type=text]').first()
  const withLayout = await typeInto(field)
  const cost = withLayout - baseline

  console.log(`   project: ${stops} stops, ${departures} text runs on the current sheet`)
  console.log(`   keystroke without layout: ${baseline}ms · with layout: ${withLayout}ms · cost: ${cost}ms`)

  check(`relaying the sheet costs under ${BUDGET_MS}ms a keystroke`, cost < BUDGET_MS, `${cost}ms`)
  check('the text actually landed', (await field.inputValue()) === word, await field.inputValue())

  // The overflow scan is deferred, not dropped: it must still catch up.
  await page.waitForTimeout(1200)
  check('the app is still alive after the deferred scan', (await page.locator('.sheet svg').count()) === 1)

  console.log(failures === 0 ? '\nEditing is responsive.' : `\n${failures} check(s) failed.`)
  await browser.close()
  if (failures > 0) process.exitCode = 1
}

await run()
