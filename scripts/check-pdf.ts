import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, PDFName, PDFArray, PDFNumber, PDFDict, PDFRawStream } from 'pdf-lib'
import { mmToPt } from '../src/model/units'

/**
 * Structural checks on the exported PDFs.
 *
 * A sheet that looks right on screen is not evidence the file is printable:
 * the fonts have to be embedded, the trim box has to say where to cut, and
 * "vector text" has to actually be text.
 *
 * Everything is read through the object graph rather than by grepping the
 * bytes — pdf-lib packs objects into compressed streams, so a raw search finds
 * nothing whether or not the font is really in there.
 */

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'proof-out')

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
}

/** Every font program embedded anywhere in the document, by BaseFont name. */
const embeddedFonts = (doc: PDFDocument): string[] => {
  const found: string[] = []
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue
    const type = obj.get(PDFName.of('Type'))
    if (type !== PDFName.of('FontDescriptor')) continue

    const hasProgram = ['FontFile', 'FontFile2', 'FontFile3'].some((k) => {
      const ref = obj.get(PDFName.of(k))
      if (!ref) return false
      const stream = doc.context.lookup(ref)
      return stream instanceof PDFRawStream && stream.contents.length > 0
    })

    const name = obj.get(PDFName.of('FontName'))
    if (hasProgram && name instanceof PDFName) found.push(name.asString())
  }
  return found
}

/** Font resources referenced by any page — present for live text, absent for outlines. */
const referencesFonts = (doc: PDFDocument): boolean =>
  doc.getPages().some((page) => {
    const resources = page.node.get(PDFName.of('Resources'))
    if (!(resources instanceof PDFDict)) return false
    const fonts = resources.get(PDFName.of('Font'))
    const dict = fonts instanceof PDFDict ? fonts : doc.context.lookup(fonts)
    return dict instanceof PDFDict && dict.keys().length > 0
  })

const boxOf = (doc: PDFDocument, index: number, name: string): number[] | null => {
  const raw = doc.getPage(index).node.get(PDFName.of(name))
  if (!(raw instanceof PDFArray)) return null
  return raw.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : NaN))
}

const mm = (pt: number) => pt / mmToPt(1)
const near = (a: number, b: number, tol = 0.5) => Math.abs(a - b) < tol

const run = async () => {
  const text = await PDFDocument.load(await readFile(join(OUT, 'sheet-text.pdf')))
  const outlined = await PDFDocument.load(await readFile(join(OUT, 'sheet-outlined.pdf')))
  const bled = await PDFDocument.load(await readFile(join(OUT, 'sheet-bleed.pdf')))
  const batch = await PDFDocument.load(await readFile(join(OUT, 'all-stops.pdf')))

  const textSize = (await readFile(join(OUT, 'sheet-text.pdf'))).length
  const outlinedSize = (await readFile(join(OUT, 'sheet-outlined.pdf'))).length

  // --- fonts -------------------------------------------------------------
  const fonts = embeddedFonts(text)
  check('text PDF embeds its font programs', fonts.length > 0, `${fonts.length} descriptors`)
  check(
    'embedded fonts are the family it was set in',
    fonts.length > 0 && fonts.some((f) => /Plex/i.test(f)),
    fonts.slice(0, 3).join(', '),
  )
  // Subsetting is checked by weight, not by the conventional six-letter
  // BaseFont tag: pdf-lib names subsets its own way, and the tag's absence
  // says nothing about whether the glyphs were actually pruned.
  check(
    'fonts are subset, not shipped whole',
    textSize < 12 * 200_000 * 0.2,
    `${(textSize / 1024).toFixed(0)}kB for ${fonts.length} cuts, against ~200kB per full face`,
  )
  check('text PDF keeps text as text', referencesFonts(text))

  check('outlined PDF embeds no fonts', embeddedFonts(outlined).length === 0)
  check('outlined PDF references no fonts', !referencesFonts(outlined))
  check(
    'outlining costs size, as it should',
    outlinedSize > textSize,
    `${outlinedSize} vs ${textSize} bytes`,
  )

  // --- page geometry -----------------------------------------------------
  const size = text.getPage(0).getSize()
  check(
    'A4 page is 210×297mm',
    near(mm(size.width), 210) && near(mm(size.height), 297),
    `${mm(size.width).toFixed(1)}×${mm(size.height).toFixed(1)}mm`,
  )

  const bledSize = bled.getPage(0).getSize()
  check(
    'bleed grows the sheet by 5mm on every side',
    near(mm(bledSize.width), 220) && near(mm(bledSize.height), 307),
    `${mm(bledSize.width).toFixed(1)}×${mm(bledSize.height).toFixed(1)}mm`,
  )

  // A PDF box is [llx, lly, urx, ury], so a 210×297 trim inset by 5mm runs to
  // 215×302, not to 210×297.
  const trim = boxOf(bled, 0, 'TrimBox')
  check(
    'TrimBox marks where to cut',
    trim !== null &&
      near(mm(trim[0]!), 5) &&
      near(mm(trim[1]!), 5) &&
      near(mm(trim[2]!), 215) &&
      near(mm(trim[3]!), 302),
    trim ? `${trim.map((v) => mm(v).toFixed(1)).join(', ')} mm` : 'missing',
  )
  check(
    'TrimBox encloses exactly the trim size',
    trim !== null && near(mm(trim[2]! - trim[0]!), 210) && near(mm(trim[3]! - trim[1]!), 297),
    trim ? `${mm(trim[2]! - trim[0]!).toFixed(1)}×${mm(trim[3]! - trim[1]!).toFixed(1)}mm` : '',
  )

  const bleedBox = boxOf(bled, 0, 'BleedBox')
  check(
    'BleedBox covers the whole sheet',
    bleedBox !== null && near(bleedBox[0]!, 0) && near(mm(bleedBox[2]!), 220),
  )
  check('a sheet without bleed declares no TrimBox', boxOf(text, 0, 'TrimBox') === null)

  // --- batch -------------------------------------------------------------
  check('batch PDF has one page per stop', batch.getPageCount() === 6, `${batch.getPageCount()} pages`)
  check('batch PDF names the application that made it', batch.getCreator() === 'Algach', batch.getCreator() ?? 'unset')
  check('title metadata survives', text.getTitle() === 'Kinoteatr Avrora', text.getTitle() ?? 'unset')

  console.log(failures === 0 ? '\nAll PDF checks passed.' : `\n${failures} check(s) failed.`)
  if (failures > 0) process.exitCode = 1
}

await run()
