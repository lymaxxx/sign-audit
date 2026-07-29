import { beforeAll, describe, expect, it } from 'vitest'
import { getFontBook } from './fonts.node'
import type { FontBook } from './fonts'
import { layoutSheet } from './index'
import { layoutRouteBlock } from './block'
import { buildRows } from './rows'
import { contentArea } from './zones'
import { segmentDayTypes } from '../segment'
import { createDefaultTemplate } from '../model/defaults'
import { makeDemoTimetable } from '../model/demo'
import { buildSheetBlocks } from '../model/sheet'
import { parseTimeList } from '../model/time'
import { artworkFor, createInsert, packInserts, type ContentInsert } from '../model/inserts'
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

describe('departure grids across the cell width', () => {
  // A block's nominal width also drives its type size, so a sheet-level
  // measurement cannot separate "wider cell" from "bigger type". These
  // measure one block at a fixed scale, where cell width is the only thing
  // moving.
  //
  // The data is a 30-minute service with the headway ceiling set below it, so
  // it prints as an hour grid rather than being quoted as "every 30" — the
  // shape that was leaving most of a wide cell empty.
  const rules = () => ({ ...createDefaultTemplate().rules, maxHeadwayForInterval: 20 })

  const hourly = parseTimeList(
    Array.from({ length: 15 }, (_, i) => {
      const h = 7 + i
      const mins = h < 10 || h > 18 ? [13, 43] : [11, 41]
      return mins.map((m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`).join(' ')
    }).join(' '),
  )

  const route = { id: 'r9', number: '9', mode: '', terminal: 'Rosia', via: [], notes: [] }

  const measure = (cap: number, width: number) => {
    const tpl = createDefaultTemplate()
    tpl.rules.maxHeadwayForInterval = 20
    tpl.block.maxCellColumns = cap
    const columns = segmentDayTypes([hourly], rules())
    const input = {
      route,
      dayTypes: [{ id: 'd1', label: '' }],
      rows: buildRows(columns, tpl.block, tpl.rules),
    }
    return layoutRouteBlock({ book, tpl, scale: 1 }, input, 0, 0, width)
  }

  it('reads this service as a grid, not a headway', () => {
    expect(segmentDayTypes([hourly], rules())[0]!.some((s) => s?.kind === 'hourly')).toBe(true)
  })

  it('splits an hour grid into columns rather than running it down one', () => {
    expect(measure(3, 180).height).toBeLessThan(measure(1, 180).height)
  })

  it('never gets taller by being allowed another column', () => {
    // Filling each column to the average and letting the remainder fall
    // through used to leave the last column carrying the rounding, so four
    // columns came out taller than three.
    const heights = [1, 2, 3, 4, 5].map((cap) => measure(cap, 300).height)
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]!).toBeLessThanOrEqual(heights[i - 1]! + 0.01)
    }
  })

  it('never gets taller by being given more width', () => {
    const heights = [90, 140, 200, 300].map((w) => measure(4, w).height)
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]!).toBeLessThanOrEqual(heights[i - 1]! + 0.01)
    }
  })

  it('keeps every departure when the grid splits', () => {
    const texts = (cap: number) =>
      measure(cap, 300)
        .prims.filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .sort()
    expect(texts(3)).toEqual(texts(1))
  })
})

describe('shared content blocks', () => {
  const ART = '<path d="M0 0 H10 V10 H0 Z" fill="#e8402a"/>'

  const block = (over: Partial<ContentInsert> = {}): ContentInsert => ({
    ...createInsert(over.id ?? 'b1', over.name ?? 'Fares'),
    fallback: { source: ART, format: 'svg' },
    ...over,
  })

  const sheet2 = (inserts: ContentInsert[], tune: (t: MasterTemplate) => void = () => {}): Page => {
    const tpl = createDefaultTemplate()
    tune(tpl)
    const blocks = buildSheetBlocks(timetable, 's1', tpl)
    const stop = timetable.stops.find((s) => s.id === 's1')!
    return layoutSheet(book, tpl, { stop, blocks, date: '1 Jan 2026', inserts, templateId: 'tpl' })
  }

  it('takes its height out of the schedule rather than drawing over it', () => {
    const without = sheet2([])
    const withOne = sheet2([block({ height: 40 })])
    expect(withOne.diagnostics.availableHeight).toBeLessThan(without.diagnostics.availableHeight)
    expect(without.diagnostics.availableHeight - withOne.diagnostics.availableHeight).toBeGreaterThanOrEqual(40)
  })

  it('leaves the sheet alone when it has none', () => {
    expect(sheet2([]).diagnostics.availableHeight).toBe(
      sheet2([block({ enabled: false })]).diagnostics.availableHeight,
    )
  })

  it('puts blocks side by side when the width allows, and wraps when it does not', () => {
    const wide = packInserts([block({ width: 60 }), block({ id: 'b2', width: 60 })], 186, 5)
    expect(wide.rows).toHaveLength(1)

    const narrow = packInserts([block({ width: 120 }), block({ id: 'b2', width: 120 })], 186, 5)
    expect(narrow.rows).toHaveLength(2)
    expect(narrow.height).toBeGreaterThan(wide.height)
  })

  it('draws the artwork above the footer and below the schedule', () => {
    const page = sheet2([block({ height: 30 })])
    const art = page.primitives.filter((p) => p.type === 'path')
    expect(art.length).toBeGreaterThan(0)

    const tpl = createDefaultTemplate()
    const area = contentArea(tpl.artboard, tpl.artboard.margins, tpl.zones.header, tpl.zones.footer, 30 + 14)
    const footerTop = tpl.artboard.height - tpl.artboard.margins.bottom - tpl.zones.footer.height
    for (const p of art) {
      expect(p.y).toBeGreaterThanOrEqual(area.y + area.h)
      expect(p.y).toBeLessThan(footerTop)
    }
  })

  it('drops the least important block before letting the schedule overflow', () => {
    // Distinct artwork so the survivor can be told apart in the output.
    const KEEP = 'M0 0 H10 V10 H0 Z'
    const SHED = 'M1 1 H9 V9 H1 Z'
    // Full width so the two stack rather than sharing a row — side by side,
    // dropping one would not shorten the band at all and there would be no
    // size at which exactly one fits. Modest heights for the same reason:
    // blocks tall enough to swamp the sheet go from both to neither at once.
    const keep = block({
      id: 'keep',
      name: 'Fares',
      width: 180,
      height: 25,
      priority: 0,
      fallback: { source: `<path d="${KEEP}"/>`, format: 'svg' },
    })
    const shed = block({
      id: 'shed',
      name: 'Advert',
      width: 180,
      height: 25,
      priority: 1,
      fallback: { source: `<path d="${SHED}"/>`, format: 'svg' },
    })

    const survivors = (height: number) => {
      const page = sheet2([keep, shed], (t) => {
        t.artboard.height = height
        t.flow.minScale = 0.95 // nowhere to shrink out of trouble
      })
      const ds = page.primitives
        .filter((p): p is Extract<typeof p, { type: 'path' }> => p.type === 'path')
        .map((p) => p.d)
      return { keep: ds.some((d) => d.includes('H10')), shed: ds.some((d) => d.includes('H9')) }
    }

    // With room for both, both are on the sheet.
    expect(survivors(600)).toEqual({ keep: true, shed: true })

    // The invariant that matters, at every size: the advert never outlives the
    // fares. Squeezing the sheet may drop one or both, but never the wrong one.
    const seen = new Set<string>()
    for (let height = 400; height >= 200; height -= 5) {
      const { keep: k, shed: s } = survivors(height)
      expect(s && !k).toBe(false)
      seen.add(`${k}${s}`)
    }
    // And it really does shed them one at a time rather than all at once.
    expect(seen.has('truefalse')).toBe(true)
  })

  it('shows a template its own artwork, falling back to the shared one', () => {
    const shared = { source: ART, format: 'svg' as const }
    const own = { source: '<path d="M0 0 H5 V5 H0 Z"/>', format: 'svg' as const }
    const insert = block({ fallback: shared, variants: { other: own } })

    expect(artworkFor(insert, 'other')).toBe(own)
    expect(artworkFor(insert, 'tpl')).toBe(shared)
    expect(artworkFor(block({ fallback: undefined, variants: {} }), 'tpl')).toBeUndefined()
  })
})

describe('the header pictogram', () => {
  const MARK = '<svg viewBox="0 0 10 10"><path d="M0 0 H10 V10 H0 Z"/></svg>'

  const withMark = (tune: (t: MasterTemplate) => void = () => {}): Page => {
    const tpl = createDefaultTemplate()
    tpl.artboard.width = 210
    tpl.artboard.height = 297
    tpl.zones.header.height = 46
    const mark = tpl.zones.header.pictogram
    mark.show = true
    mark.source = MARK
    mark.size = 20
    mark.gap = 4
    // A title long enough to take several lines beside a 20mm mark.
    tpl.title.template = 'Saint Bernard Hospital and Europort Road Interchange Terminal'
    tune(tpl)
    const blocks = buildSheetBlocks(timetable, 's1', tpl)
    const stop = timetable.stops.find((s) => s.id === 's1')!
    return layoutSheet(book, tpl, { stop, blocks, date: '1 Jan 2026' })
  }

  /** Distinct left edges of the header's text lines, top to bottom. */
  const headerLineStarts = (page: Page): number[] => {
    const byLine = new Map<number, number>()
    for (const p of page.primitives) {
      if (p.type !== 'text' || p.y > 46) continue
      const key = Math.round(p.y * 100)
      byLine.set(key, Math.min(byLine.get(key) ?? Infinity, p.x))
    }
    return [...byLine.entries()].sort((a, b) => a[0] - b[0]).map(([, x]) => x)
  }

  it('hands the canvas a handle for the mark it drew', () => {
    const page = withMark()
    expect(page.handles).toHaveLength(1)
    expect(page.handles[0]!.kind).toBe('pictogram')
    expect(page.handles[0]!.zone).toBe('header')
    expect(page.handles[0]!.w).toBe(20)
  })

  it('lets a negative nudge carry the mark outside the page margin', () => {
    const inside = withMark().handles[0]!
    const nudged = withMark((t) => void (t.zones.header.pictogram.offsetX = -20)).handles[0]!
    expect(nudged.x).toBeCloseTo(inside.x - 20, 5)
    // Past the trim edge entirely, which the old clamping made impossible.
    expect(nudged.x).toBeLessThan(0)
  })

  it('centres a mark taller than the text instead of pinning it to the top', () => {
    // The offset used to be clamped at zero, so a mark taller than the text
    // it was centring against simply sat at the top.
    const short = withMark((t) => {
      t.title.template = 'Rosia'
      t.zones.header.pictogram.align = 'middle'
      t.zones.header.pictogram.size = 30
    })
    const top = withMark((t) => {
      t.title.template = 'Rosia'
      t.zones.header.pictogram.align = 'top'
      t.zones.header.pictogram.size = 30
    })
    expect(short.handles[0]!.y).toBeLessThan(top.handles[0]!.y)
  })

  // Small enough that the title runs past its bottom edge, which is the only
  // arrangement where wrapping and indenting differ at all.
  const shortMark = (t: MasterTemplate) => void (t.zones.header.pictogram.size = 9)

  it('indents every line when wrapping is off', () => {
    const starts = headerLineStarts(
      withMark((t) => {
        shortMark(t)
        t.zones.header.pictogram.wrapText = false
      }),
    )
    expect(starts.length).toBeGreaterThan(1)
    expect(new Set(starts.map((x) => Math.round(x * 100))).size).toBe(1)
  })

  it('lets the lines below the mark run back to the full width when wrapping is on', () => {
    const starts = headerLineStarts(
      withMark((t) => {
        shortMark(t)
        t.zones.header.pictogram.wrapText = true
      }),
    )
    expect(starts.length).toBeGreaterThan(1)
    // The first line sits beside the mark; something below it does not.
    expect(Math.min(...starts)).toBeLessThan(starts[0]!)
  })

  it('keeps the wrapped text clear of the mark', () => {
    const page = withMark((t) => void (t.zones.header.pictogram.wrapText = true))
    const mark = page.handles[0]!
    for (const p of page.primitives) {
      if (p.type !== 'text' || p.y > 46) continue
      // A line whose band overlaps the mark must start past its right edge.
      const overlaps = p.y - p.sizeMm < mark.y + mark.h && p.y > mark.y
      if (overlaps) expect(p.x).toBeGreaterThanOrEqual(mark.x + mark.w - 0.01)
    }
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
