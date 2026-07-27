import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getFontBook } from '../src/layout/fonts.node'
import { layoutSheet } from '../src/layout'
import { renderPdf } from '../src/render/pdf'
import { createDefaultTemplate } from '../src/model/defaults'
import { makeDemoTimetable } from '../src/model/demo'
import { buildSheetBlocks } from '../src/model/sheet'

/** Writes PDFs for inspection: one with live text, one with outlines, one with bleed. */

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'proof-out')

const run = async () => {
  await mkdir(OUT, { recursive: true })
  const book = await getFontBook()
  const timetable = makeDemoTimetable()

  const sheet = (stopId: string, tune: (t: ReturnType<typeof createDefaultTemplate>) => void = () => {}) => {
    const tpl = createDefaultTemplate()
    tune(tpl)
    const blocks = buildSheetBlocks(timetable, stopId, tpl)
    const stop = timetable.stops.find((s) => s.id === stopId)!
    return layoutSheet(book, tpl, { stop, blocks, date: '1 Jan 2026' })
  }

  const plain = await renderPdf(book, [sheet('s1')], { title: 'Kinoteatr Avrora' })
  await writeFile(join(OUT, 'sheet-text.pdf'), plain)

  const outlined = await renderPdf(book, [sheet('s1')], { outlineText: true })
  await writeFile(join(OUT, 'sheet-outlined.pdf'), outlined)

  const bled = await renderPdf(
    book,
    [
      sheet('s1', (t) => {
        t.artboard.bleed = 5
        t.artboard.cropMarks = true
      }),
    ],
    { title: 'With bleed' },
  )
  await writeFile(join(OUT, 'sheet-bleed.pdf'), bled)

  // Every stop in one file: the batch case, and proof the times really differ.
  const all = timetable.stops.map((s) => sheet(s.id))
  const batch = await renderPdf(book, all, { title: 'All stops' })
  await writeFile(join(OUT, 'all-stops.pdf'), batch)

  console.log('sheet-text.pdf    ', plain.length, 'bytes')
  console.log('sheet-outlined.pdf', outlined.length, 'bytes')
  console.log('sheet-bleed.pdf   ', bled.length, 'bytes')
  console.log('all-stops.pdf     ', batch.length, 'bytes,', all.length, 'pages')
}

await run()
