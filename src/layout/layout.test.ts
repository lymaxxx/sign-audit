import { beforeAll, describe, expect, it } from 'vitest'
import { getFontBook } from './fonts.node'
import type { FontBook } from './fonts'
import { layoutSheet } from './index'
import { contentArea } from './zones'
import { createDefaultTemplate } from '../model/defaults'
import { makeDemoTimetable } from '../model/demo'
import { buildSheetBlocks } from '../model/sheet'
import type { MasterTemplate } from '../model/template'
import type { Page } from './primitives'

let book: FontBook
const timetable = makeDemoTimetable()

beforeAll(async () => {
  book = await getFontBook()
})

const sheet = (tune: (t: MasterTemplate) => void = () => {}, stopId = 's1'): Page => {
  const tpl = createDefaultTemplate()
  tune(tpl)
  const blocks = buildSheetBlocks(timetable, stopId, tpl)
  const stop = timetable.stops.find((s) => s.id === stopId)!
  return layoutSheet(book, tpl, { stop, blocks, date: '1 Jan 2026' })
}

const artboard = (w: number, h: number) => (t: MasterTemplate) => {
  t.artboard.width = w
  t.artboard.height = h
}

describe('sheet layout', () => {
  it('stacks blocks down a tall panel', () => {
    const page = sheet(artboard(200, 700))
    expect(page.diagnostics.columns).toBe(1)
    expect(page.diagnostics.rows).toBe(5)
  })

  it('runs blocks across a long panel, one per column', () => {
    const page = sheet(artboard(900, 300))
    expect(page.diagnostics.columns).toBe(5)
    expect(page.diagnostics.rows).toBe(1)
  })

  it('lands between the two on a square panel', () => {
    const page = sheet(artboard(420, 420))
    expect(page.diagnostics.columns).toBeGreaterThan(1)
    expect(page.diagnostics.columns).toBeLessThan(5)
  })

  it('sets larger type where a block gets more room', () => {
    const wide = sheet(artboard(900, 300)).diagnostics.scale
    const narrow = sheet(artboard(210, 297)).diagnostics.scale
    expect(wide).toBeGreaterThan(narrow)
  })

  it('scales a block down proportionally when its nominal width is trimmed', () => {
    // Auto-fit off: this is about the nominal scale the block width implies,
    // not about the rescue shrink layered on top of it.
    const at = (blockWidth: number) =>
      sheet((t) => {
        artboard(210, 297)(t)
        t.flow.autoFit = false
        t.flow.stretch = false
        t.flow.blockWidth = blockWidth
      }).diagnostics.scale

    expect(at(90)).toBeCloseTo(0.9, 5)
    expect(at(45)).toBeCloseTo(0.45, 5)
  })

  it('honours a forced column count', () => {
    const page = sheet((t) => {
      artboard(420, 297)(t)
      t.flow.columns = 3
    })
    expect(page.diagnostics.columns).toBe(3)
  })

  it('keeps content clear of the footer, however tall it gets', () => {
    const tpl = createDefaultTemplate()
    artboard(200, 700)(tpl)
    tpl.zones.footer.height = 200

    const blocks = buildSheetBlocks(timetable, 's1', tpl)
    const stop = timetable.stops[0]!
    const page = layoutSheet(book, tpl, { stop, blocks, date: 'x' })
    const area = contentArea(tpl.artboard, tpl.artboard.margins, tpl.zones.header, tpl.zones.footer)

    expect(page.diagnostics.availableHeight).toBeCloseTo(area.h, 5)
    // Either it fits in what the bands left, or it is flagged. What must never
    // happen is content quietly running on under the footer.
    expect(page.diagnostics.contentHeight <= area.h + 0.01 || page.diagnostics.overflow).toBe(true)
    // The content area stops where the footer begins.
    expect(area.y + area.h).toBeLessThanOrEqual(tpl.artboard.height - tpl.artboard.margins.bottom - 200 + 0.01)
  })

  it('shrinks rather than overflow, and says by how much', () => {
    const page = sheet((t) => {
      artboard(210, 200)(t)
    })
    expect(page.diagnostics.fitScale).toBeLessThan(1)
    expect(page.diagnostics.overflow).toBe(false)
  })

  it('flags a sheet it cannot rescue', () => {
    const page = sheet((t) => {
      artboard(120, 90)(t)
      t.flow.minScale = 0.9
    })
    expect(page.diagnostics.overflow).toBe(true)
  })

  it('draws the same sheet identically twice', () => {
    expect(JSON.stringify(sheet().primitives)).toBe(JSON.stringify(sheet().primitives))
  })

  it('gives neighbouring stops different departure times', () => {
    const textOf = (page: Page) =>
      page.primitives
        .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join(' ')

    // The whole reason every shelter needs its own sheet.
    expect(textOf(sheet(() => {}, 's1'))).not.toBe(textOf(sheet(() => {}, 's4')))
  })

  it('puts the stop name on the sheet', () => {
    const page = sheet()
    const texts = page.primitives
      .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
      .map((p) => p.text)
    expect(texts.some((t) => t.includes('Аврора'))).toBe(true)
  })
})
