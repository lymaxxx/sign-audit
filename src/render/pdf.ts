import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import type { FontBook } from '../layout/fonts'
import { fontKey } from '../layout/fonts'
import type { Page, Primitive } from '../layout/primitives'
import { mmToPt } from '../model/units'

/**
 * The press renderer.
 *
 * Consumes the same primitive list the preview does, so nothing is laid out
 * twice and nothing can drift between the two. Only the coordinate system
 * changes: millimetres with y running down become points with y running up.
 */

export interface PdfOptions {
  /** Convert glyphs to filled outlines. Heavier files and no text search, but
   *  nothing is left for a RIP to substitute. */
  outlineText?: boolean
  /** Draw the trim marks the layout emitted, and set the boxes to match. */
  title?: string
  author?: string
  subject?: string
}

const parseHex = (hex: string): { r: number; g: number; b: number } => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { r: 0, g: 0, b: 0 }
  const n = parseInt(m[1]!, 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

const color = (hex: string) => {
  const { r, g, b } = parseHex(hex)
  return rgb(r, g, b)
}

/** Rounded rectangle in millimetres, y running down, origin at its top left. */
const roundedRectPath = (w: number, h: number, radius: number): string => {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  return (
    `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} ` +
    `V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} ` +
    `H ${r} A ${r} ${r} 0 0 1 0 ${h - r} ` +
    `V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`
  )
}

/**
 * One page's coordinate frame.
 *
 * The layout puts the trim box origin at the top left. A PDF page includes the
 * bleed and counts up from the bottom, so both axes need shifting.
 */
class Frame {
  constructor(
    private readonly bleed: number,
    private readonly trimHeight: number,
  ) {}

  x(mm: number): number {
    return mmToPt(mm + this.bleed)
  }

  y(mm: number): number {
    return mmToPt(this.trimHeight - mm + this.bleed)
  }

  len(mm: number): number {
    return mmToPt(mm)
  }
}

const drawText = async (
  pdfPage: PDFPage,
  prim: Extract<Primitive, { type: 'text' }>,
  frame: Frame,
  fonts: Map<string, PDFFont>,
  book: FontBook,
  outline: boolean,
): Promise<void> => {
  if (outline) {
    // opentype returns outlines in the same millimetre space and the same
    // y-down convention pdf-lib's path drawing expects, so the path only needs
    // the frame and the unit scale applied.
    const font = book.resolve(prim.family, prim.weight, prim.italic)
    const path = font.font.getPath(prim.text, 0, 0, prim.sizeMm, { kerning: true })
    pdfPage.drawSvgPath(path.toPathData(3), {
      x: frame.x(prim.x),
      y: frame.y(prim.y),
      color: color(prim.color),
      scale: mmToPt(1),
    })
    return
  }

  const key = fontKey(prim.family, prim.weight, prim.italic)
  const embedded = fonts.get(key)
  if (!embedded) return

  pdfPage.drawText(prim.text, {
    x: frame.x(prim.x),
    y: frame.y(prim.y),
    size: frame.len(prim.sizeMm),
    font: embedded,
    color: color(prim.color),
  })
}

const drawPrimitive = async (
  pdfPage: PDFPage,
  prim: Primitive,
  frame: Frame,
  fonts: Map<string, PDFFont>,
  book: FontBook,
  outline: boolean,
): Promise<void> => {
  switch (prim.type) {
    case 'text':
      await drawText(pdfPage, prim, frame, fonts, book, outline)
      break

    case 'rect':
      if (prim.radius && prim.radius > 0) {
        // pdf-lib's rectangles have square corners only, so a rounded badge
        // goes down as a path — otherwise the PDF would not match the preview.
        pdfPage.drawSvgPath(roundedRectPath(prim.w, prim.h, prim.radius), {
          x: frame.x(prim.x),
          y: frame.y(prim.y),
          scale: mmToPt(1),
          ...(prim.fill ? { color: color(prim.fill) } : {}),
          ...(prim.stroke
            ? { borderColor: color(prim.stroke), borderWidth: frame.len(prim.strokeWidth ?? 0.2) }
            : {}),
        })
      } else {
        pdfPage.drawRectangle({
          x: frame.x(prim.x),
          // drawRectangle measures up from its own bottom edge.
          y: frame.y(prim.y + prim.h),
          width: frame.len(prim.w),
          height: frame.len(prim.h),
          ...(prim.fill ? { color: color(prim.fill) } : {}),
          ...(prim.stroke
            ? { borderColor: color(prim.stroke), borderWidth: frame.len(prim.strokeWidth ?? 0.2) }
            : {}),
        })
      }
      break

    case 'line':
      pdfPage.drawLine({
        start: { x: frame.x(prim.x1), y: frame.y(prim.y1) },
        end: { x: frame.x(prim.x2), y: frame.y(prim.y2) },
        thickness: frame.len(prim.width),
        color: color(prim.color),
      })
      break

    case 'path':
      pdfPage.drawSvgPath(prim.d, {
        x: frame.x(prim.x),
        y: frame.y(prim.y),
        scale: mmToPt(prim.scale),
        ...(prim.fill ? { color: color(prim.fill) } : {}),
        ...(prim.stroke
          ? { borderColor: color(prim.stroke), borderWidth: frame.len(prim.strokeWidth ?? 0.2) }
          : {}),
      })
      break

    case 'image': {
      if (prim.format !== 'raster') break
      const doc = pdfPage.doc
      try {
        const isPng = prim.source.startsWith('data:image/png')
        const embedded = isPng ? await doc.embedPng(prim.source) : await doc.embedJpg(prim.source)
        pdfPage.drawImage(embedded, {
          x: frame.x(prim.x),
          y: frame.y(prim.y + prim.h),
          width: frame.len(prim.w),
          height: frame.len(prim.h),
        })
      } catch {
        // An unreadable logo should cost one image, not the whole run.
      }
      break
    }
  }
}

/**
 * Write pages to a PDF.
 *
 * Fonts are embedded as subsets, and the trim and bleed boxes are declared so
 * a printer knows where the sheet is meant to be cut.
 */
export const renderPdf = async (
  book: FontBook,
  pages: Page[],
  opts: PdfOptions = {},
): Promise<Uint8Array> => {
  // pdf-lib re-stamps Producer and ModDate on save unless this is off, which
  // would quietly discard whatever we set below.
  const doc = await PDFDocument.create({ updateMetadata: false })
  doc.registerFontkit(fontkit)

  if (opts.title) doc.setTitle(opts.title)
  if (opts.author) doc.setAuthor(opts.author)
  if (opts.subject) doc.setSubject(opts.subject)
  // Creator is the application; Producer is whatever writes the bytes, and
  // pdf-lib stamps its own name there on save regardless of what we ask for.
  doc.setCreator('Timetable Generator')
  doc.setCreationDate(new Date())
  doc.setModificationDate(new Date())

  // Embed only the cuts the pages actually use, once for the whole document.
  const fonts = new Map<string, PDFFont>()
  if (!opts.outlineText) {
    const needed = new Set<string>()
    for (const page of pages) {
      for (const prim of page.primitives) {
        if (prim.type === 'text') needed.add(fontKey(prim.family, prim.weight, prim.italic))
      }
    }
    for (const cut of book.all()) {
      if (!needed.has(cut.key)) continue
      fonts.set(cut.key, await doc.embedFont(cut.data, { subset: true }))
    }
  }

  for (const page of pages) {
    const bleed = page.bleed
    const pdfPage = doc.addPage([mmToPt(page.width + bleed * 2), mmToPt(page.height + bleed * 2)])
    const frame = new Frame(bleed, page.height)

    if (bleed > 0) {
      pdfPage.setTrimBox(mmToPt(bleed), mmToPt(bleed), mmToPt(page.width), mmToPt(page.height))
      pdfPage.setBleedBox(0, 0, mmToPt(page.width + bleed * 2), mmToPt(page.height + bleed * 2))
    }

    for (const prim of page.primitives) {
      await drawPrimitive(pdfPage, prim, frame, fonts, book, opts.outlineText ?? false)
    }
  }

  return doc.save()
}

/** Filename for one stop's sheet, from a pattern the user controls. */
export const formatFilename = (
  pattern: string,
  values: { stop: string; code: string; date: string; index: number },
): string => {
  const replaced = pattern
    .replace(/\{stop\}/g, values.stop)
    .replace(/\{code\}/g, values.code)
    .replace(/\{date\}/g, values.date)
    .replace(/\{index\}/g, String(values.index).padStart(3, '0'))

  // Keep it safe for every filesystem the export might land on.
  const safe = replaced.replace(/[/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim()
  return safe.toLowerCase().endsWith('.pdf') ? safe : `${safe}.pdf`
}
