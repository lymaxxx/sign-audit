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

  it('pushes the content area down by the header/footer content gap', () => {
    const tpl = createDefaultTemplate()
    const before = contentArea(tpl.artboard, tpl.artboard.margins, tpl.zones.header, tpl.zones.footer)

    tpl.zones.header.contentGap = 8
    tpl.zones.footer.contentGap = 5
    const after = contentArea(tpl.artboard, tpl.artboard.margins, tpl.zones.header, tpl.zones.footer)

    expect(after.y).toBeCloseTo(before.y + 8, 5)
    expect(after.h).toBeCloseTo(before.h - 13, 5)
  })

  it('does not add a content gap for a band that is not shown', () => {
    const tpl = createDefaultTemplate()
    tpl.zones.header.height = 0
    tpl.zones.header.contentGap = 20
    const before = contentArea(tpl.artboard, tpl.artboard.margins, tpl.zones.header, tpl.zones.footer)
    expect(before.y).toBeCloseTo(tpl.artboard.margins.top, 5)
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

describe('night routes', () => {
  // A fresh copy per test: these mark a route as a night route, and the
  // shared demo timetable above must stay untouched for every other test.
  const nightSheet = (): Page => {
    const own = makeDemoTimetable()
    const nightRoute = own.routes[own.routes.length - 1]!
    nightRoute.isNightRoute = true

    const tpl = createDefaultTemplate()
    const stop = own.stops[0]!
    const blocks = buildSheetBlocks(own, stop.id, tpl)
    return layoutSheet(book, tpl, { stop, blocks, date: '1 Jan 2026' })
  }

  it('keeps the night list below the day grid, clear of the footer', () => {
    const page = nightSheet()
    const area = contentArea(
      createDefaultTemplate().artboard,
      createDefaultTemplate().artboard.margins,
      createDefaultTemplate().zones.header,
      createDefaultTemplate().zones.footer,
    )
    expect(page.diagnostics.contentHeight <= area.h + 0.01 || page.diagnostics.overflow).toBe(true)
  })

  it('prints the heading above the night list', () => {
    const page = nightSheet()
    // Tracked text (the heading's default style) is emitted one glyph per
    // primitive, so join everything in emission order rather than looking
    // for the whole label as a single run.
    const joined = page.primitives
      .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
      .map((p) => p.text)
      .join('')
      .toLowerCase()
    expect(joined).toContain(createDefaultTemplate().block.labels.nightRoutes.toLowerCase())
  })

  it('does not stretch a lone night route to fill the row on its own', () => {
    // Splitting the block out into its own single-column flow used to hand it
    // the whole content width, blowing its type size — and its height — up
    // far past what the day grid uses.
    const page = nightSheet()
    const withoutSplit = sheet()
    expect(page.diagnostics.scale).toBeLessThanOrEqual(withoutSplit.diagnostics.scale * 1.2)
  })

  it('folds night routes into the day grid on a wide panel with room to spare', () => {
    // One big day route on a wide panel leaves whole columns unused; night
    // routes read fine sharing them rather than forced underneath, where they
    // used to overflow a panel that plainly had space for them.
    const own = makeDemoTimetable()
    for (const route of own.routes.slice(1)) route.isNightRoute = true

    const tpl = createDefaultTemplate()
    tpl.artboard.width = 420
    tpl.artboard.height = 297
    const stop = own.stops[0]!
    const blocks = buildSheetBlocks(own, stop.id, tpl)
    const page = layoutSheet(book, tpl, { stop, blocks, date: '1 Jan 2026' })

    expect(page.diagnostics.overflow).toBe(false)
    expect(page.diagnostics.columns).toBeGreaterThan(1)
    const joined = page.primitives
      .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
      .map((p) => p.text)
      .join('')
      .toLowerCase()
    expect(joined).not.toContain(tpl.block.labels.nightRoutes.toLowerCase())
  })

  it('keeps the split list — even overflowing — when there is no side room to fold into', () => {
    // A narrow panel where the day network alone already fills the only
    // column there is: folding would not help, so the separate list stays.
    const own = makeDemoTimetable()
    own.routes[own.routes.length - 1]!.isNightRoute = true

    const tpl = createDefaultTemplate()
    tpl.artboard.width = 100
    tpl.artboard.height = 200
    const stop = own.stops[0]!
    const blocks = buildSheetBlocks(own, stop.id, tpl)
    const page = layoutSheet(book, tpl, { stop, blocks, date: '1 Jan 2026' })

    expect(page.diagnostics.columns).toBe(1)
    const joined = page.primitives
      .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
      .map((p) => p.text)
      .join('')
      .toLowerCase()
    expect(joined).toContain(tpl.block.labels.nightRoutes.toLowerCase())
  })
})
