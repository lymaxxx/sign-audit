import type { FontBook } from './fonts'
import { colorOf, type LayoutContext, type RouteBlockInput } from './block'
import { computeFlow, fitContent } from './flow'
import { contentArea, layoutZone, substituteTokens, zoneRect, type TokenValues } from './zones'
import type { Page, Primitive } from './primitives'
import type { MasterTemplate } from '../model/template'
import type { Stop } from '../model/types'

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
  const numbers = input.blocks.map((b) => b.route.number)

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
  const geometry = computeFlow(tpl, area.w, input.blocks.length)
  const fitted = fitContent(ctx, input.blocks, area, geometry)

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
    ...layoutZone(ctx, zones.header, zoneRect(artboard, artboard.margins, zones.header, 'header'), tokens, 'header'),
  )
  prims.push(...fitted.prims)
  prims.push(
    ...layoutZone(ctx, zones.footer, zoneRect(artboard, artboard.margins, zones.footer, 'footer'), tokens, 'footer'),
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
      scale: geometry.blockScale * fitted.fitScale,
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
