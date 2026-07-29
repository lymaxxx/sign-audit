import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getFontBook } from '../src/layout/fonts.node'
import { BUNDLED_FONTS } from '../src/layout/fonts'
import { layoutSheet } from '../src/layout'
import { renderSvg, cssFamily } from '../src/render/svg'
import { createDefaultTemplate } from '../src/model/defaults'
import { makeDemoTimetable } from '../src/model/demo'
import { buildSheetBlocks } from '../src/model/sheet'
import type { MasterTemplate } from '../src/model/template'

/**
 * Renders the demo network across a spread of artboards so the layout can be
 * looked at, not just asserted about. Writes an HTML index that the screenshot
 * step opens.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'proof-out')

/** Embed the real font files so the browser measures what the engine measured. */
const fontFaceCss = async (): Promise<string> => {
  const parts = await Promise.all(
    BUNDLED_FONTS.map(async (cut) => {
      const data = await readFile(join(ROOT, 'fonts', cut.file))
      return (
        `@font-face{font-family:"${cssFamily(cut.family)}";` +
        `font-weight:${cut.weight};font-style:${cut.italic ? 'italic' : 'normal'};` +
        `src:url(data:font/ttf;base64,${data.toString('base64')}) format("truetype");}`
      )
    }),
  )
  return parts.join('')
}

interface Case {
  id: string
  label: string
  apply: (t: MasterTemplate) => void
}

const cases: Case[] = [
  {
    id: 'tall',
    label: 'Tall panel 200×700 — blocks stack in one column',
    apply: (t) => {
      t.artboard.width = 200
      t.artboard.height = 700
    },
  },
  {
    id: 'wide',
    label: 'Wide panel 900×300 — blocks run across',
    apply: (t) => {
      t.artboard.width = 900
      t.artboard.height = 300
    },
  },
  {
    id: 'square',
    label: 'Square panel 420×420',
    apply: (t) => {
      t.artboard.width = 420
      t.artboard.height = 420
    },
  },
  {
    id: 'a4',
    label: 'A4 portrait',
    apply: (t) => {
      t.artboard.width = 210
      t.artboard.height = 297
    },
  },
  {
    id: 'a3-landscape',
    label: 'A3 landscape',
    apply: (t) => {
      t.artboard.width = 420
      t.artboard.height = 297
    },
  },
  {
    id: 'a4-block60',
    label: 'A4, nominal block 60mm — smaller block, more columns',
    apply: (t) => {
      t.artboard.width = 210
      t.artboard.height = 297
      t.flow.blockWidth = 60
    },
  },
  {
    id: 'a4-block45',
    label: 'A4, nominal block 45mm',
    apply: (t) => {
      t.artboard.width = 210
      t.artboard.height = 297
      t.flow.blockWidth = 45
    },
  },
  {
    id: 'a3-forced-3',
    label: 'A3 landscape, columns forced to 3',
    apply: (t) => {
      t.artboard.width = 420
      t.artboard.height = 297
      t.flow.columns = 3
    },
  },
  {
    id: 'tall-bigfooter',
    label: 'Tall panel with a 90mm footer — content must clear it',
    apply: (t) => {
      t.artboard.width = 200
      t.artboard.height = 700
      t.zones.footer.height = 90
      t.zones.footer.background = '#f4f4f5'
    },
  },
]

const run = async () => {
  await mkdir(OUT, { recursive: true })
  const book = await getFontBook()
  const timetable = makeDemoTimetable()
  const css = await fontFaceCss()
  const stopId = 's1'

  const cards: string[] = []
  const summary: string[] = []

  for (const c of cases) {
    const tpl = createDefaultTemplate()
    c.apply(tpl)

    const blocks = buildSheetBlocks(timetable, stopId, tpl)
    const stop = timetable.stops.find((s) => s.id === stopId)!
    const page = layoutSheet(book, tpl, { stop, blocks, date: '1 Jan 2026' })
    const d = page.diagnostics

    // Fonts live in one sidecar stylesheet rather than inside every sheet;
    // inlining them made each file a few megabytes of base64.
    const svg = renderSvg(page)
    await writeFile(join(OUT, `${c.id}.svg`), svg, 'utf8')

    const line =
      `${c.id.padEnd(16)} ${String(tpl.artboard.width).padStart(4)}×${String(tpl.artboard.height).padEnd(4)} ` +
      `cols=${d.columns} rows=${d.rows} scale=${d.scale.toFixed(3)} fit=${d.fitScale.toFixed(3)} ` +
      `content=${d.contentHeight.toFixed(1)}/${d.availableHeight.toFixed(1)}mm` +
      (d.overflow ? '  OVERFLOW' : '')
    summary.push(line)

    cards.push(
      `<figure class="card">` +
        `<figcaption><b>${c.label}</b><br><code>${line.trim()}</code></figcaption>` +
        `<div class="sheet">${svg}</div>` +
        `</figure>`,
    )
  }

  await writeFile(join(OUT, 'fonts.css'), css, 'utf8')

  const html =
    `<!doctype html><meta charset="utf-8"><title>Timetable Generator layout proof</title>` +
    `<link rel="stylesheet" href="fonts.css">` +
    `<style>body{margin:0;padding:24px;background:#18181b;color:#e4e4e7;` +
    `font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}` +
    `.grid{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start}` +
    `.card{margin:0;background:#27272a;padding:12px;border-radius:8px;max-width:none}` +
    `figcaption{margin-bottom:8px;max-width:520px}` +
    `code{color:#a1a1aa}` +
    `.sheet svg{display:block;box-shadow:0 4px 24px rgba(0,0,0,.5)}` +
    `.sheet{max-height:760px;overflow:auto}` +
    `</style><div class="grid">${cards.join('')}</div>`

  await writeFile(join(OUT, 'index.html'), html, 'utf8')

  console.log(summary.join('\n'))
  console.log(`\nWrote ${cases.length} sheets to proof-out/`)
}

await run()
