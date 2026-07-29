import type { FontBook } from './fonts'
import { wrapText } from './fonts'
import type { Primitive, TextPrimitive } from './primitives'
import type { BlockRow } from './rows'
import type { Section } from '../segment'
import { routeLabel, type DayType, type Route } from '../model/types'
import { formatHour, formatMinute, formatTime, hourOf, type Minutes } from '../model/time'
import { REFERENCE_BLOCK_WIDTH, resolveColor, type MasterTemplate, type StyleRole } from '../model/template'

export interface LayoutContext {
  book: FontBook
  tpl: MasterTemplate
  /** Nominal block scale multiplied by any auto-fit shrink. */
  scale: number
}

export interface Box {
  height: number
  prims: Primitive[]
}

const EMPTY: Box = { height: 0, prims: [] }

/** Scale a template dimension authored at the reference block width. */
export const s = (ctx: LayoutContext, v: number): number => v * ctx.scale

export const styleOf = (ctx: LayoutContext, role: StyleRole) => ctx.tpl.styles[role]

export const colorOf = (ctx: LayoutContext, ref: string): string => resolveColor(ref, ctx.tpl.palette)

const applyTransform = (text: string, transform: 'none' | 'uppercase' | 'lowercase'): string => {
  if (transform === 'uppercase') return text.toUpperCase()
  if (transform === 'lowercase') return text.toLowerCase()
  return text
}

/**
 * Emit one run of text at a baseline.
 *
 * Tracked text is emitted glyph by glyph at measured positions rather than
 * leaning on a renderer-side letter-spacing property, so the SVG and the PDF
 * place every glyph on the same coordinate.
 */
export const text = (
  ctx: LayoutContext,
  content: string,
  role: StyleRole,
  x: number,
  baseline: number,
  align: 'left' | 'center' | 'right' = 'left',
): Primitive[] => {
  const style = styleOf(ctx, role)
  const body = applyTransform(content, style.transform)
  if (!body) return []

  const sizeMm = ctx.book.sizeMm(style, ctx.scale)
  const font = ctx.book.resolveStyle(style)
  const width = ctx.book.measure(body, style, ctx.scale)
  const left = align === 'left' ? x : align === 'center' ? x - width / 2 : x - width

  const base = {
    type: 'text' as const,
    family: font.family,
    weight: font.weight,
    italic: font.italic,
    sizeMm,
    color: colorOf(ctx, style.color),
  }

  if (style.tracking === 0) {
    return [{ ...base, x: left, y: baseline, text: body } satisfies TextPrimitive]
  }

  const advances = ctx.book.advances(body, style, ctx.scale)
  const chars = [...body]
  const out: Primitive[] = []
  let cursor = left
  for (let i = 0; i < chars.length; i++) {
    out.push({ ...base, x: cursor, y: baseline, text: chars[i]! })
    cursor += advances[i]! + style.tracking * sizeMm
  }
  return out
}

/** Height of one line in a role, and where its baseline sits inside it. */
const lineMetrics = (ctx: LayoutContext, role: StyleRole) => {
  const style = styleOf(ctx, role)
  return {
    height: ctx.book.lineHeight(style, ctx.scale),
    baseline: ctx.book.baselineOffset(style, ctx.scale),
  }
}

/** Lay a wrapped paragraph into a column. */
const paragraph = (
  ctx: LayoutContext,
  content: string,
  role: StyleRole,
  x: number,
  y: number,
  w: number,
  maxLines = Infinity,
): Box => {
  if (!content.trim()) return EMPTY
  const style = styleOf(ctx, role)
  const lines = wrapText(ctx.book, applyTransform(content, style.transform), style, ctx.scale, w).slice(
    0,
    maxLines,
  )
  const { height, baseline } = lineMetrics(ctx, role)
  const prims: Primitive[] = []
  lines.forEach((line, i) => {
    prims.push(...text(ctx, line, role, x, y + i * height + baseline))
  })
  return { height: lines.length * height, prims }
}

/* ------------------------------------------------------------------ cells */

/** Gap between departures in a list, as a fraction of the type size. */
const TIME_GAP_EM = 0.42
/** Gap between an hour and its minutes. */
const HOUR_GAP_EM = 0.5
/** Gap between minutes within an hour. */
const MINUTE_GAP_EM = 0.45

/**
 * How many departures a flat list puts on one line.
 *
 * A flat list is already its own answer to using the cell's width — it wraps
 * left to right across the whole of it, so there is nothing here for
 * `maxCellColumns` to cap. That setting governs the hour grid, where a
 * repeated hour-and-minutes block is what gets dealt into columns.
 */
const timesPerRow = (ctx: LayoutContext, cellWidth: number, itemWidth: number, gap: number): number => {
  const configured = ctx.tpl.block.timesPerRow
  if (configured !== 'auto') return Math.max(1, configured)
  return Math.max(1, Math.floor((cellWidth + gap) / (itemWidth + gap)))
}

/** A flat list of departures, wrapped into as many columns as the cell allows. */
const timesCell = (ctx: LayoutContext, times: Minutes[], x: number, y: number, w: number): Box => {
  if (times.length === 0) return EMPTY
  const role: StyleRole = 'time'
  const style = styleOf(ctx, role)
  const sizeMm = ctx.book.sizeMm(style, ctx.scale)
  const opts = { postMidnightAsHour24: ctx.tpl.rules.postMidnightAsHour24 }

  // Tabular figures mean every departure is the same width, so one measurement
  // sets the whole grid.
  const itemW = ctx.book.measure('00:00', style, ctx.scale)
  const gap = sizeMm * TIME_GAP_EM
  const perRow = timesPerRow(ctx, w, itemW, gap)
  const { height: lineH, baseline } = lineMetrics(ctx, role)

  const prims: Primitive[] = []
  times.forEach((t, i) => {
    const col = i % perRow
    const row = Math.floor(i / perRow)
    prims.push(...text(ctx, formatTime(t, opts), role, x + col * (itemW + gap), y + row * lineH + baseline))
  })

  return { height: Math.ceil(times.length / perRow) * lineH, prims }
}

/**
 * Deal a run of hours into `count` columns, balanced by the number of lines
 * each takes, and read down a column before moving to the next.
 *
 * Balancing by line count rather than by hour count matters: an hour with six
 * departures wraps onto two lines, and splitting purely by hour would leave
 * one column visibly longer than its neighbour.
 */
const dealIntoCellColumns = <T>(items: T[], linesOf: (item: T) => number, count: number): T[][] => {
  if (count <= 1 || items.length === 0) return [items]

  // A ceiling share, not an average: filling each column to the average and
  // letting the remainder fall through leaves the last column carrying
  // everything the rounding shed, which is how four columns ended up taller
  // than three.
  const total = items.reduce((sum, item) => sum + linesOf(item), 0)
  const perColumn = Math.ceil(total / count)

  const groups: T[][] = [[]]
  let used = 0

  for (const item of items) {
    const lines = linesOf(item)
    const current = groups[groups.length - 1]!
    const onLastColumn = groups.length === count
    const wouldOverfill = current.length > 0 && used + lines > perColumn

    if (wouldOverfill && !onLastColumn) {
      groups.push([item])
      used = lines
      continue
    }
    current.push(item)
    used += lines
  }
  return groups
}

/** Departures grouped by hour: a heavy hour against light minutes. */
const hourlyCell = (ctx: LayoutContext, times: Minutes[], x: number, y: number, w: number): Box => {
  if (times.length === 0) return EMPTY

  const hourStyle = styleOf(ctx, 'hour')
  const minuteStyle = styleOf(ctx, 'minute')
  const opts = { postMidnightAsHour24: ctx.tpl.rules.postMidnightAsHour24 }

  const hourW = ctx.book.measure('00', hourStyle, ctx.scale)
  const minuteW = ctx.book.measure('00', minuteStyle, ctx.scale)
  const minuteSize = ctx.book.sizeMm(minuteStyle, ctx.scale)
  const hourGap = ctx.book.sizeMm(hourStyle, ctx.scale) * HOUR_GAP_EM
  const minuteGap = minuteSize * MINUTE_GAP_EM

  // Rows are as tall as the taller of the two roles, so heavy hours and light
  // minutes sit on a shared baseline.
  const lineH = Math.max(ctx.book.lineHeight(hourStyle, ctx.scale), ctx.book.lineHeight(minuteStyle, ctx.scale))
  const baseline = Math.max(
    ctx.book.baselineOffset(hourStyle, ctx.scale),
    ctx.book.baselineOffset(minuteStyle, ctx.scale),
  )

  const byHour = new Map<number, Minutes[]>()
  for (const t of times) {
    const h = hourOf(t)
    const list = byHour.get(h)
    if (list) list.push(t)
    else byHour.set(h, [t])
  }
  const hours = [...byHour.entries()].sort((a, b) => a[0] - b[0])

  // How many minutes the busiest hour has to show. Sizing a column against
  // that keeps every hour on one line where the cell can afford it, which is
  // what makes the leftover width worth spending on another column.
  const busiest = Math.max(...hours.map(([, list]) => list.length))
  const roomForMinutes = Math.max(minuteW, w - hourW - hourGap)
  const fitsAcross = Math.max(1, Math.floor((roomForMinutes + minuteGap) / (minuteW + minuteGap)))
  const perRow = Math.min(busiest, fitsAcross)

  const columnW = hourW + hourGap + perRow * (minuteW + minuteGap) - minuteGap
  const columnGap = s(ctx, ctx.tpl.block.cellColumnGap)
  const cap = Math.max(1, Math.round(ctx.tpl.block.maxCellColumns))
  const columns = Math.max(
    1,
    Math.min(cap, hours.length, Math.floor((w + columnGap) / (columnW + columnGap))),
  )

  const linesOf = ([, list]: [number, Minutes[]]) => Math.ceil(list.length / perRow)
  const groups = dealIntoCellColumns(hours, linesOf, columns)

  const prims: Primitive[] = []
  let tallest = 0

  groups.forEach((group, columnIndex) => {
    const left = x + columnIndex * (columnW + columnGap)
    const minutesLeft = left + hourW + hourGap
    let cursorY = y

    for (const [hour, list] of group) {
      prims.push(...text(ctx, formatHour(hour * 60, opts), 'hour', left, cursorY + baseline))
      list.forEach((t, i) => {
        prims.push(
          ...text(
            ctx,
            formatMinute(t),
            'minute',
            minutesLeft + (i % perRow) * (minuteW + minuteGap),
            cursorY + Math.floor(i / perRow) * lineH + baseline,
          ),
        )
      })
      cursorY += Math.ceil(list.length / perRow) * lineH
    }

    tallest = Math.max(tallest, cursorY - y)
  })

  return { height: tallest, prims }
}

/** A headway: one large figure, with its unit beneath. */
const intervalCell = (ctx: LayoutContext, section: Section, x: number, y: number, _w: number): Box => {
  if (section.kind !== 'interval') return EMPTY
  const { intervalSeparator: sep, intervalAverageThreshold, intervalAveragePrefix } = ctx.tpl.block
  const spread = section.max - section.min
  // A couple of minutes either way is not worth making a rider subtract: a
  // tight range reads as one averaged figure, and only a genuinely wide one
  // is printed as the range it actually is.
  const value =
    section.min === section.max
      ? `${section.min}`
      : spread <= intervalAverageThreshold
        ? `${intervalAveragePrefix}${Math.round((section.min + section.max) / 2)}`
        : `${section.min}${sep}${section.max}`

  const valueLine = lineMetrics(ctx, 'intervalValue')
  const unitLine = lineMetrics(ctx, 'intervalUnit')

  const prims: Primitive[] = [
    ...text(ctx, value, 'intervalValue', x, y + valueLine.baseline),
    ...text(ctx, ctx.tpl.block.intervalUnit, 'intervalUnit', x, y + valueLine.height + unitLine.baseline),
  ]

  return { height: valueLine.height + unitLine.height, prims }
}

const cell = (ctx: LayoutContext, section: Section | null, x: number, y: number, w: number): Box => {
  if (!section) return EMPTY
  switch (section.kind) {
    case 'interval':
      return intervalCell(ctx, section, x, y, w)
    case 'hourly':
      return hourlyCell(ctx, section.times, x, y, w)
    case 'times':
      return timesCell(ctx, section.times, x, y, w)
  }
}

/* ------------------------------------------------------------------ block */

interface ColumnGeometry {
  labelWidth: number
  cellWidth: number
  cellX: (index: number) => number
}

const columnGeometry = (ctx: LayoutContext, x: number, w: number, dayCount: number): ColumnGeometry => {
  const b = ctx.tpl.block
  const labelWidth = dayCount === 0 ? 0 : s(ctx, b.labelWidth)
  const labelGap = labelWidth > 0 ? s(ctx, b.labelGap) : 0
  const dayGap = s(ctx, b.dayTypeGap)
  const available = Math.max(0, w - labelWidth - labelGap)
  const cellWidth = dayCount > 0 ? (available - (dayCount - 1) * dayGap) / dayCount : available
  return {
    labelWidth,
    cellWidth,
    cellX: (i) => x + labelWidth + labelGap + i * (cellWidth + dayGap),
  }
}

/** Badge, headsign and street list. */
const routeHeader = (ctx: LayoutContext, route: Route, x: number, y: number, w: number): Box => {
  const b = ctx.tpl.block
  const badge = b.badge
  const prims: Primitive[] = []
  let top = y

  if (badge.topRule.show) {
    const thickness = s(ctx, badge.topRule.thickness)
    prims.push({
      type: 'rect',
      x,
      y: top,
      w,
      h: thickness,
      fill: route.color ?? colorOf(ctx, 'accent'),
    })
    top += thickness + s(ctx, 1.5)
  }

  const badgeW = badge.shape === 'none' ? 0 : s(ctx, badge.width)
  const badgeH = badge.shape === 'none' ? 0 : s(ctx, badge.height)
  const badgeFill =
    badge.fill === 'none' ? undefined : badge.fill === 'route' ? (route.color ?? colorOf(ctx, 'accent')) : colorOf(ctx, 'accent')

  if (badge.shape !== 'none') {
    if (badgeFill) {
      prims.push({
        type: 'rect',
        x,
        y: top,
        w: badgeW,
        h: badgeH,
        fill: badgeFill,
        radius: badge.shape === 'pill' ? badgeH / 2 : badge.shape === 'square' ? 0 : s(ctx, badge.radius),
      })
    }
    const numberStyle = styleOf(ctx, 'routeNumber')
    const numberColor = badge.inkOnPaper || !badgeFill ? colorOf(ctx, numberStyle.color) : ctx.tpl.palette.paper
    const numberSize = ctx.book.sizeMm(numberStyle, ctx.scale)
    const font = ctx.book.resolveStyle(numberStyle)
    const label = routeLabel(route)
    const numberWidth = ctx.book.measure(label, numberStyle, ctx.scale)
    // Optically centre the numeral on the cap height rather than the em box.
    const capCentre = top + badgeH / 2 + (numberSize * font.ascent) / 2 - numberSize * 0.09
    prims.push({
      type: 'text',
      x: x + badgeW / 2 - numberWidth / 2,
      y: capCentre,
      text: label,
      family: font.family,
      weight: font.weight,
      italic: font.italic,
      sizeMm: numberSize,
      color: numberColor,
    })
  }

  const textLeft = badgeW > 0 ? x + badgeW + s(ctx, 4) : x
  const textWidth = Math.max(0, w - (textLeft - x))

  // Measured first, then placed. A one-line headsign beside a tall badge would
  // otherwise sit at the badge's top edge with the rest of the badge's height
  // as empty paper beneath it, and the rule below it further still.
  const dest = paragraph(ctx, route.terminal, 'destination', textLeft, 0, textWidth, 3)
  const via =
    b.showViaList && route.via.length > 0
      ? paragraph(ctx, route.via.join(', '), 'viaList', textLeft, 0, textWidth, 3)
      : EMPTY
  const viaGap = via.height > 0 ? s(ctx, 0.8) : 0
  const textHeight = dest.height + viaGap + via.height

  // Centred against the badge where it is shorter; otherwise the text leads.
  const textTop = top + Math.max(0, (badgeH - textHeight) / 2)

  const shift = (box: Box, dy: number): Primitive[] =>
    box.prims.map((prim) => (prim.type === 'text' ? { ...prim, y: prim.y + dy } : prim))

  prims.push(...shift(dest, textTop))
  if (via.height > 0) prims.push(...shift(via, textTop + dest.height + viaGap))

  const textBottom = textTop + textHeight

  // The badge and the text sit side by side, so the header is as tall as
  // whichever runs longer — and no taller.
  return { height: Math.max(top + badgeH, textBottom) - y, prims }
}

export interface RouteBlockInput {
  route: Route
  dayTypes: DayType[]
  rows: BlockRow[]
}

/**
 * Lay out one route's block at a given width.
 *
 * Everything inside is derived from `ctx.scale`, so halving the nominal block
 * width in the master template halves the type, the gutters and the rules
 * together rather than leaving a small block full of large numbers.
 */
export const layoutRouteBlock = (
  ctx: LayoutContext,
  input: RouteBlockInput,
  x: number,
  y: number,
  w: number,
): Box => {
  const b = ctx.tpl.block
  const prims: Primitive[] = []
  const padLeft = s(ctx, b.padding.left)
  const padRight = s(ctx, b.padding.right)
  const innerX = x + padLeft
  const innerW = Math.max(0, w - padLeft - padRight)

  let cursor = y + s(ctx, b.padding.top)

  const header = routeHeader(ctx, input.route, innerX, cursor, innerW)
  prims.push(...header.prims)
  cursor += header.height

  const geo = columnGeometry(ctx, innerX, innerW, input.dayTypes.length)

  if (b.headerRule.show) {
    cursor += s(ctx, b.headerGap)
    const thickness = s(ctx, b.headerRule.thickness)
    prims.push({
      type: 'line',
      x1: innerX,
      y1: cursor,
      x2: innerX + innerW,
      y2: cursor,
      color: colorOf(ctx, b.headerRule.color),
      width: thickness,
    })
    cursor += thickness + s(ctx, b.headerGap)
  } else {
    cursor += s(ctx, b.headerGap)
  }

  // Column headings, only when a block actually distinguishes kinds of day.
  if (b.showColumnHeaders && input.dayTypes.length > 1) {
    const line = lineMetrics(ctx, 'columnHeader')
    if (b.columnHeaderFill !== 'none') {
      prims.push({
        type: 'rect',
        x: innerX,
        y: cursor,
        w: innerW,
        h: line.height,
        fill: colorOf(ctx, b.columnHeaderFill),
      })
    }
    input.dayTypes.forEach((d, i) => {
      prims.push(...text(ctx, d.label, 'columnHeader', geo.cellX(i), cursor + line.baseline))
    })
    cursor += line.height + s(ctx, 1.4)
  }

  const ruleThickness = s(ctx, b.sectionRule.thickness)
  const sectionGap = s(ctx, b.sectionGap)

  input.rows.forEach((row, index) => {
    if (index > 0) {
      cursor += sectionGap
      if (b.sectionRule.show) {
        prims.push({
          type: 'line',
          x1: innerX,
          y1: cursor,
          x2: innerX + innerW,
          y2: cursor,
          color: colorOf(ctx, b.sectionRule.color),
          width: ruleThickness,
        })
        cursor += ruleThickness + sectionGap
      }
    }

    const labelBox = row.label
      ? paragraph(ctx, row.label, 'rowLabel', innerX, cursor, geo.labelWidth, 3)
      : EMPTY
    prims.push(...labelBox.prims)

    let tallest = labelBox.height
    row.cells.forEach((section, i) => {
      const box = cell(ctx, section, geo.cellX(i), cursor, geo.cellWidth)
      prims.push(...box.prims)
      if (box.height > tallest) tallest = box.height
    })
    cursor += tallest
  })

  if (input.route.notes.length > 0) {
    cursor += sectionGap
    const notes = paragraph(ctx, input.route.notes.join('  '), 'note', innerX, cursor, innerW)
    prims.push(...notes.prims)
    cursor += notes.height
  }

  cursor += s(ctx, b.padding.bottom)
  return { height: cursor - y, prims }
}

/** Scale implied by a block width, relative to the width styles were authored at. */
export const scaleForWidth = (blockWidth: number): number => blockWidth / REFERENCE_BLOCK_WIDTH
