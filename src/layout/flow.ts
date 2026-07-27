import { layoutRouteBlock, scaleForWidth, type LayoutContext, type RouteBlockInput } from './block'
import type { Primitive } from './primitives'
import type { Rect } from '../model/units'
import { REFERENCE_BLOCK_WIDTH, type MasterTemplate } from '../model/template'

/**
 * How route blocks fill the sheet.
 *
 * The column count is arithmetic, not a set of special cases: a tall narrow
 * panel divides into one column and stacks blocks down it, a long horizontal
 * panel divides into several and runs them across, a square lands in between.
 * Nothing here knows what "portrait" means.
 */

export interface FlowGeometry {
  columns: number
  /** Width each block is actually drawn at. */
  blockWidth: number
  /** Scale implied by that width, before any auto-fit shrink. */
  blockScale: number
  /** Left edge of the first column within the content area. */
  offsetX: number
}

export const computeFlow = (
  tpl: MasterTemplate,
  contentWidth: number,
  blockCount = Infinity,
): FlowGeometry => {
  const { columns: configured, blockWidth: nominal, columnGap, stretch, align } = tpl.flow

  let columns: number
  if (configured === 'auto') {
    columns = Math.max(1, Math.floor((contentWidth + columnGap) / (Math.max(1, nominal) + columnGap)))
    // More columns than blocks would leave the far side of a long panel bare.
    // Capping here lets the blocks widen to fill it instead.
    columns = Math.max(1, Math.min(columns, blockCount))
  } else {
    columns = Math.max(1, Math.round(configured))
  }

  const filled = (contentWidth - (columns - 1) * columnGap) / columns
  // Stretched, the nominal width only decides how many columns there are.
  // Unstretched, it is the width, so trimming it shrinks type continuously.
  const blockWidth = stretch ? filled : Math.min(nominal, filled)

  const used = columns * blockWidth + (columns - 1) * columnGap
  const slack = Math.max(0, contentWidth - used)
  const offsetX = align === 'center' ? slack / 2 : align === 'right' ? slack : 0

  return { columns, blockWidth, blockScale: scaleForWidth(blockWidth), offsetX }
}

/** Can these blocks be dealt into `k` ordered columns, no taller than `cap`
 *  and no more than `perColumn` blocks deep? */
const fitsInColumns = (
  heights: number[],
  gap: number,
  k: number,
  cap: number,
  perColumn: number,
): boolean => {
  let columns = 1
  let current = 0
  let count = 0
  for (const h of heights) {
    if (h > cap) return false
    const grown = current === 0 ? h : current + gap + h
    if (grown <= cap && count < perColumn) {
      current = grown
      count++
    } else {
      columns++
      if (columns > k) return false
      current = h
      count = 1
    }
  }
  return true
}

const dealIntoColumns = (heights: number[], gap: number, cap: number, perColumn: number): number[][] => {
  const out: number[][] = [[]]
  let current = 0
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i]!
    const group = out[out.length - 1]!
    const grown = current === 0 ? h : current + gap + h
    if (group.length === 0 || (grown <= cap && group.length < perColumn)) {
      group.push(i)
      current = grown
    } else {
      out.push([i])
      current = h
    }
  }
  return out
}

/**
 * Balance blocks across columns while keeping them in order.
 *
 * Reading runs down a column and then over to the next, the way the reference
 * sheets are set, so the order blocks arrive in is preserved and only the
 * break points move.
 */
export const balanceColumns = (heights: number[], columns: number, gap: number): number[][] => {
  if (heights.length === 0) return []
  if (columns <= 1) return [heights.map((_, i) => i)]

  // Spread before stacking. With spare columns going, a block belongs beside
  // its neighbour rather than under it, so no column takes more than its
  // even share.
  const perColumn = Math.max(1, Math.ceil(heights.length / columns))

  // `hi` always admits a solution and `lo` is the floor no arrangement can
  // beat. Narrow the gap between them.
  let lo = Math.max(...heights)
  let hi = heights.reduce((a, b) => a + b, 0) + gap * (heights.length - 1)

  // Bounded, and stopping on an absolute tolerance rather than on `lo < hi`:
  // once the two are adjacent doubles their midpoint can round back to `hi`,
  // and a `while` loop then spins forever without either bound moving.
  for (let i = 0; i < 60 && hi - lo > 1e-4; i++) {
    const mid = (lo + hi) / 2
    if (fitsInColumns(heights, gap, columns, mid, perColumn)) hi = mid
    else lo = mid
  }

  return dealIntoColumns(heights, gap, hi, perColumn)
}

export interface ContentResult {
  prims: Primitive[]
  /** Tallest column, which is what has to clear the content area. */
  height: number
  columns: number
  rows: number
}

/** Lay every block into the content area at the context's current scale. */
export const layoutContent = (
  ctx: LayoutContext,
  blocks: RouteBlockInput[],
  area: Rect,
  geometry: FlowGeometry,
): ContentResult => {
  if (blocks.length === 0) {
    return { prims: [], height: 0, columns: geometry.columns, rows: 0 }
  }

  const { columnGap, rowGap } = ctx.tpl.flow

  // Measured once at this scale; the result is reused to place them.
  const measured = blocks.map((b) => layoutRouteBlock(ctx, b, 0, 0, geometry.blockWidth))
  const heights = measured.map((m) => m.height)
  const groups = balanceColumns(heights, geometry.columns, rowGap)

  const prims: Primitive[] = []
  let tallest = 0
  let deepest = 0

  groups.forEach((group, col) => {
    const x = area.x + geometry.offsetX + col * (geometry.blockWidth + columnGap)
    let y = area.y
    group.forEach((index, positionInColumn) => {
      if (positionInColumn > 0) y += rowGap
      const box = layoutRouteBlock(ctx, blocks[index]!, x, y, geometry.blockWidth)
      prims.push(...box.prims)
      y += box.height
    })
    tallest = Math.max(tallest, y - area.y)
    deepest = Math.max(deepest, group.length)
  })

  return { prims, height: tallest, columns: groups.length, rows: deepest }
}

export interface FitResult extends ContentResult {
  fitScale: number
  overflow: boolean
}

/**
 * Shrink type and spacing until the sheet holds, within the floor the template
 * allows.
 *
 * Block width and column count are left alone — they are the user's decision —
 * so shrinking cannot set off a reflow that changes the answer underneath the
 * search.
 */
export const fitContent = (
  ctx: LayoutContext,
  blocks: RouteBlockInput[],
  area: Rect,
  geometry: FlowGeometry,
): FitResult => {
  const at = (fitScale: number) =>
    layoutContent({ ...ctx, scale: geometry.blockScale * fitScale }, blocks, area, geometry)

  const full = at(1)
  if (!ctx.tpl.flow.autoFit || full.height <= area.h) {
    return { ...full, fitScale: 1, overflow: full.height > area.h }
  }

  const floor = Math.min(1, Math.max(0.05, ctx.tpl.flow.minScale))
  const atFloor = at(floor)
  if (atFloor.height > area.h) {
    return { ...atFloor, fitScale: floor, overflow: true }
  }

  let lo = floor
  let hi = 1
  let best = atFloor
  let bestScale = floor

  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2
    const result = at(mid)
    if (result.height <= area.h) {
      best = result
      bestScale = mid
      lo = mid
    } else {
      hi = mid
    }
  }

  return { ...best, fitScale: bestScale, overflow: false }
}

/** Column count a sheet would settle on, for previewing a template change. */
export const columnsFor = (tpl: MasterTemplate, contentWidth: number): number =>
  computeFlow(tpl, contentWidth).columns

export { REFERENCE_BLOCK_WIDTH }
