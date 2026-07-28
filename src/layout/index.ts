import type { FontBook } from './fonts'
import { colorOf, s, styleOf, text, type Box, type LayoutContext, type RouteBlockInput } from './block'
import { computeFlow, fitContent, layoutContent, type FlowGeometry } from './flow'
import { contentArea, layoutZone, substituteTokens, zoneRect, type TokenValues } from './zones'
import type { Page, Primitive } from './primitives'
import type { Rect } from '../model/units'
import type { MasterTemplate } from '../model/template'
import { routeLabel, type Stop } from '../model/types'

export * from './primitives'
export { computeFlow, balanceColumns, fitContent, columnsFor } from './flow'
export { layoutRouteBlock, scaleForWidth } from './block'
export type { LayoutContext, RouteBlockInput } from './block'
export { contentArea, zoneRect, resolveItemRect, substituteTokens } from './zones'
export type { TokenValues } from './zones'

/** One stop's sheet: what to print, before any of it is measured. */
export interface SheetInput {
  stop: Stop
  blocks: RouteBlockInput[]
  /** Rendered into `{date}`; supplied by the caller so a batch export stamps
   *  every sheet with one date rather than drifting across a long run. */
  date: string
  /** Overrides the template's title wording for this stop alone. */
  titleOverride?: string
  subtitleOverride?: string
}

const buildTokens = (input: SheetInput, tpl: MasterTemplate): TokenValues => {
  const terminals = [...new Set(input.blocks.map((b) => b.route.terminal).filter(Boolean))]
  const numbers = input.blocks.map((b) => routeLabel(b.route))

  const base: TokenValues = {
    stop: input.stop.name,
    direction: input.stop.direction ?? '',
    terminals: terminals.join(', '),
    routes: numbers.join(', '),
    date: input.date,
    title: '',
    subtitle: '',
  }

  // Title and subtitle are themselves templates, expanded before the header
  // items that reference them.
  base.title = input.titleOverride ?? substituteTokens(tpl.title.template, base)
  base.subtitle = input.subtitleOverride ?? substituteTokens(tpl.title.subtitleTemplate, base)
  return base
}

/** Trim-box corner marks, drawn out in the bleed where they get cut away. */
const cropMarks = (width: number, height: number, bleed: number): Primitive[] => {
  if (bleed <= 0) return []
  const offset = 1
  const color = '#000000'
  const w = 0.15
  const line = (x1: number, y1: number, x2: number, y2: number): Primitive => ({
    type: 'line',
    x1,
    y1,
    x2,
    y2,
    color,
    width: w,
  })

  return [
    line(-bleed, 0, -offset, 0),
    line(0, -bleed, 0, -offset),
    line(width + offset, 0, width + bleed, 0),
    line(width, -bleed, width, -offset),
    line(-bleed, height, -offset, height),
    line(0, height + offset, 0, height + bleed),
    line(width + offset, height, width + bleed, height),
    line(width, height + offset, width, height + bleed),
  ]
}

/** A rule and a label above the night list, so it reads as its own section
 *  rather than a stray gap at the foot of the day network's grid. Its own
 *  break, rule and typography, independent of how sections inside a block are
 *  spaced and ruled off. */
const nightHeading = (ctx: LayoutContext, box: Rect): Box => {
  const { divider: rule, gapAfterHeading } = ctx.tpl.block.nightSection
  const label = ctx.tpl.block.labels.nightRoutes
  const prims: Primitive[] = []
  let top = box.y

  if (rule.show) {
    prims.push({
      type: 'line',
      x1: box.x,
      y1: top,
      x2: box.x + box.w,
      y2: top,
      color: colorOf(ctx, rule.color),
      width: s(ctx, rule.thickness),
    })
    top += s(ctx, 2)
  }

  if (!label.trim()) return { height: top - box.y + s(ctx, gapAfterHeading), prims }

  const style = styleOf(ctx, 'nightRoutesHeading')
  const lineH = ctx.book.lineHeight(style, ctx.scale)
  const baseline = ctx.book.baselineOffset(style, ctx.scale)
  prims.push(...text(ctx, label, 'nightRoutesHeading', box.x, top + baseline))
  return { height: top - box.y + lineH + s(ctx, gapAfterHeading), prims }
}

interface BlocksResult {
  prims: Primitive[]
  height: number
  columns: number
  rows: number
  fitScale: number
  overflow: boolean
  /** Nominal block scale before the fit shrink, for the "type at N%" readout. */
  blockScale: number
}

/**
 * Lay day and night blocks out as one ordinary grid, night routes last in
 * order — no separate list, no heading, no divider. What a sheet falls back
 * to when there is nowhere sensible to put a distinct night section.
 */
const layoutCombined = (ctx: LayoutContext, blocks: RouteBlockInput[], area: Rect): BlocksResult => {
  const geometry = computeFlow(ctx.tpl, area.w, blocks.length)
  return { ...fitContent(ctx, blocks, area, geometry), blockScale: geometry.blockScale }
}

/**
 * Run night routes as their own list along the foot of the content area,
 * below the day grid.
 *
 * A night line has nothing in common with the daytime service it would
 * otherwise be interleaved with in one grid, so it is laid out as a separate
 * flow beneath it. Both share one auto-fit search, so the day grid and the
 * night list shrink together rather than one holding a size the other cannot
 * afford.
 */
const layoutSplit = (
  ctx: LayoutContext,
  dayBlocks: RouteBlockInput[],
  nightBlocks: RouteBlockInput[],
  area: Rect,
): BlocksResult => {
  const dayGeometry = computeFlow(ctx.tpl, area.w, dayBlocks.length)
  // The night list reads as more of the same sheet, not a second one with its
  // own type size — it takes the day grid's column width and just uses as
  // many of those columns as it needs, rather than stretching a lone night
  // route to fill the whole row the way a lone day route would.
  const { columnGap, align } = ctx.tpl.flow
  const nightColumns = Math.max(1, Math.min(dayGeometry.columns, nightBlocks.length))
  const nightUsed = nightColumns * dayGeometry.blockWidth + (nightColumns - 1) * columnGap
  const nightSlack = Math.max(0, area.w - nightUsed)
  const nightGeometry: FlowGeometry = {
    columns: nightColumns,
    blockWidth: dayGeometry.blockWidth,
    blockScale: dayGeometry.blockScale,
    offsetX: align === 'center' ? nightSlack / 2 : align === 'right' ? nightSlack : 0,
  }
  const blockScale = dayGeometry.blockScale
  const breakGap = ctx.tpl.block.nightSection.gapBefore

  const at = (fitScale: number): BlocksResult & { total: number } => {
    const day = layoutContent({ ...ctx, scale: dayGeometry.blockScale * fitScale }, dayBlocks, area, dayGeometry)
    const nightCtx: LayoutContext = { ...ctx, scale: nightGeometry.blockScale * fitScale }
    const nightY = area.y + day.height + (day.height > 0 ? breakGap : 0)
    const heading = nightHeading(nightCtx, { x: area.x, y: nightY, w: area.w, h: 0 })
    const night = layoutContent(nightCtx, nightBlocks, { ...area, y: nightY + heading.height }, nightGeometry)
    const total = nightY - area.y + heading.height + night.height
    return {
      prims: [...day.prims, ...heading.prims, ...night.prims],
      height: total,
      columns: Math.max(day.columns, night.columns),
      rows: day.rows + night.rows,
      fitScale,
      overflow: total > area.h,
      blockScale,
      total,
    }
  }

  const full = at(1)
  if (!ctx.tpl.flow.autoFit || full.total <= area.h) return full

  const floor = Math.min(1, Math.max(0.05, ctx.tpl.flow.minScale))
  const atFloor = at(floor)
  if (atFloor.total > area.h) return atFloor

  let lo = floor
  let hi = 1
  let best = atFloor
  for (let i = 0; i < 18 && hi - lo > 1e-4; i++) {
    const mid = (lo + hi) / 2
    const result = at(mid)
    if (result.total <= area.h) {
      best = { ...result, overflow: false }
      lo = mid
    } else {
      hi = mid
    }
  }
  return best
}

/**
 * Flow the day network's blocks into the content area, and — where the route
 * list has any — try to run night routes as their own list along the foot of
 * it, falling back to folding them into the day grid instead (still last in
 * order) where the split list does not fit and the panel had columns to
 * spare beside a day network too small to use them all. A wide panel with one
 * big day route should not force its night routes underneath when there is
 * a whole empty column beside it.
 */
const layoutBlocks = (ctx: LayoutContext, blocks: RouteBlockInput[], area: Rect): BlocksResult => {
  const dayBlocks = blocks.filter((b) => !b.route.isNightRoute)
  const nightBlocks = blocks.filter((b) => b.route.isNightRoute)

  if (nightBlocks.length === 0) return layoutCombined(ctx, dayBlocks, area)
  if (dayBlocks.length === 0) return layoutCombined(ctx, nightBlocks, area)

  const split = layoutSplit(ctx, dayBlocks, nightBlocks, area)
  if (!split.overflow) return split

  const { columns: configured, blockWidth: nominal, columnGap } = ctx.tpl.flow
  const naturalColumns =
    configured === 'auto'
      ? Math.max(1, Math.floor((area.w + columnGap) / (Math.max(1, nominal) + columnGap)))
      : Math.max(1, Math.round(configured))

  if (naturalColumns > dayBlocks.length) {
    const combined = layoutCombined(ctx, [...dayBlocks, ...nightBlocks], area)
    if (!combined.overflow) return combined
  }

  return split
}

/**
 * Turn one stop's schedule into positioned geometry.
 *
 * Bands are subtracted first, blocks flow into what is left, and the whole
 * thing shrinks only if it has to. The result is a flat primitive list that
 * the preview and the PDF writer both consume unchanged.
 */
export const layoutSheet = (book: FontBook, tpl: MasterTemplate, input: SheetInput): Page => {
  const { artboard, zones } = tpl
  const ctx: LayoutContext = { book, tpl, scale: 1 }
  const tokens = buildTokens(input, tpl)

  const area = contentArea(artboard, artboard.margins, zones.header, zones.footer)
  const fitted = layoutBlocks(ctx, input.blocks, area)

  const prims: Primitive[] = []

  if (tpl.palette.paper !== 'none') {
    prims.push({
      type: 'rect',
      x: -artboard.bleed,
      y: -artboard.bleed,
      w: artboard.width + artboard.bleed * 2,
      h: artboard.height + artboard.bleed * 2,
      fill: colorOf(ctx, 'paper'),
    })
  }

  prims.push(
    ...layoutZone(
      ctx,
      zones.header,
      zoneRect(artboard, artboard.margins, zones.header, 'header'),
      tokens,
      'header',
      artboard,
    ),
  )
  prims.push(...fitted.prims)
  prims.push(
    ...layoutZone(
      ctx,
      zones.footer,
      zoneRect(artboard, artboard.margins, zones.footer, 'footer'),
      tokens,
      'footer',
      artboard,
    ),
  )

  if (artboard.cropMarks) {
    prims.push(...cropMarks(artboard.width, artboard.height, artboard.bleed))
  }

  return {
    width: artboard.width,
    height: artboard.height,
    bleed: artboard.bleed,
    primitives: prims,
    diagnostics: {
      scale: fitted.blockScale * fitted.fitScale,
      fitScale: fitted.fitScale,
      columns: fitted.columns,
      rows: fitted.rows,
      overflow: fitted.overflow,
      contentHeight: fitted.height,
      availableHeight: area.h,
      blockCount: input.blocks.length,
    },
  }
}
