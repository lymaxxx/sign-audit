import type { LayoutContext } from './block'
import { colorOf, text as emitText, styleOf } from './block'
import { wrapText } from './fonts'
import type { Primitive } from './primitives'
import type { Rect } from '../model/units'
import type { VectorItem, ZoneConfig } from '../model/template'
import { artworkPrimitives, parseArtwork } from './svgArt'

/**
 * Header and footer are reserved bands, not overlays.
 *
 * `contentArea` subtracts them from the sheet, so raising the footer height
 * pushes the schedule up instead of letting art and departures collide. That
 * one subtraction is the whole guarantee.
 */

export interface TokenValues {
  stop: string
  direction: string
  terminals: string
  routes: string
  date: string
  /** Expanded from the template's own title wording, so header items can
   *  reference it instead of repeating the tokens. */
  title: string
  subtitle: string
}

export const substituteTokens = (template: string, tokens: TokenValues): string =>
  template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in tokens ? tokens[key as keyof TokenValues] : whole,
  )

/** Where a zone's box sits on the sheet, inside the margins. */
export const zoneRect = (
  artboard: { width: number; height: number },
  margins: { top: number; right: number; bottom: number; left: number },
  zone: ZoneConfig,
  which: 'header' | 'footer',
): Rect => {
  const x = margins.left
  const w = Math.max(0, artboard.width - margins.left - margins.right)
  const y = which === 'header' ? margins.top : artboard.height - margins.bottom - zone.height
  return { x, y, w, h: zone.height }
}

/** What is left for the schedule once both bands are taken out. */
export const contentArea = (
  artboard: { width: number; height: number },
  margins: { top: number; right: number; bottom: number; left: number },
  header: ZoneConfig,
  footer: ZoneConfig,
): Rect => {
  const x = margins.left
  const w = Math.max(0, artboard.width - margins.left - margins.right)
  const headerSpace = header.height + (header.height > 0 ? header.contentGap : 0)
  const footerSpace = footer.height + (footer.height > 0 ? footer.contentGap : 0)
  const y = margins.top + headerSpace
  const h = Math.max(0, artboard.height - margins.top - margins.bottom - headerSpace - footerSpace)
  return { x, y, w, h }
}

/** Resolve an item's anchored position into an absolute box on the sheet. */
export const resolveItemRect = (item: VectorItem, zone: ZoneConfig, box: Rect): Rect => {
  const p = zone.padding
  const innerX = box.x + p.left
  const innerY = box.y + p.top
  const innerW = Math.max(0, box.w - p.left - p.right)
  const innerH = Math.max(0, box.h - p.top - p.bottom)

  let x: number
  if (item.anchorX === 'left') x = innerX + item.x
  else if (item.anchorX === 'right') x = innerX + innerW - item.x - item.w
  else x = innerX + innerW / 2 - item.w / 2 + item.x

  let y: number
  if (item.anchorY === 'top') y = innerY + item.y
  else if (item.anchorY === 'bottom') y = innerY + innerH - item.y - item.h
  else y = innerY + innerH / 2 - item.h / 2 + item.y

  return { x, y, w: item.w, h: item.h }
}

interface DrawnText {
  prims: Primitive[]
  /** What the text actually occupied, which is what a stack advances by. */
  height: number
}


/**
 * Place a mark in a box.
 *
 * Vector art is converted to paths rather than nested as an SVG document,
 * because the PDF writer draws paths and would otherwise drop the artwork
 * silently — a logo that survives the preview and vanishes from the print is
 * worse than one that never appeared.
 */
const drawArtwork = (
  source: string,
  format: 'svg' | 'raster',
  box: Rect,
  tint?: string,
): Primitive[] => {
  if (!source) return []
  if (format !== 'svg') {
    return [{ type: 'image', x: box.x, y: box.y, w: box.w, h: box.h, source, format }]
  }
  return artworkPrimitives(parseArtwork(source), box, tint)
}

const drawTextItem = (
  ctx: LayoutContext,
  item: Extract<VectorItem, { kind: 'text' }>,
  box: Rect,
  tokens: TokenValues,
  scale: number,
): DrawnText => {
  const body = substituteTokens(item.text, tokens)
  if (!body.trim()) return { prims: [], height: 0 }

  const zoneCtx: LayoutContext = { ...ctx, scale }
  const style = styleOf(zoneCtx, item.role)
  const lines = wrapText(ctx.book, body, style, scale, box.w)
  const lineH = ctx.book.lineHeight(style, scale)
  const baseline = ctx.book.baselineOffset(style, scale)
  const blockHeight = lines.length * lineH

  let top = box.y
  if (item.valign === 'middle') top = box.y + (box.h - blockHeight) / 2
  else if (item.valign === 'bottom') top = box.y + box.h - blockHeight

  const anchorX = item.align === 'left' ? box.x : item.align === 'center' ? box.x + box.w / 2 : box.x + box.w

  const out: Primitive[] = []

  // The frame hugs the text that is actually there, not the item's drag box,
  // so a one-line stop name does not sit in a box sized for three.
  const frame = item.frame
  if (frame?.show) {
    const widest = Math.max(...lines.map((l) => ctx.book.measure(l, style, scale)), 0)
    const p = frame.padding
    const frameX = item.align === 'left' ? box.x : item.align === 'center' ? anchorX - widest / 2 : anchorX - widest
    out.push({
      type: 'rect',
      x: frameX - p.left,
      y: top - p.top,
      w: widest + p.left + p.right,
      h: blockHeight + p.top + p.bottom,
      ...(frame.fill !== 'none' ? { fill: colorOf(ctx, frame.fill) } : {}),
      ...(frame.stroke !== 'none'
        ? { stroke: colorOf(ctx, frame.stroke), strokeWidth: frame.strokeWidth }
        : {}),
      radius: frame.radius,
    })
  }

  lines.forEach((line, i) => {
    out.push(...emitText(zoneCtx, line, item.role, anchorX, top + i * lineH + baseline, item.align))
  })

  const frameHeight = frame?.show ? blockHeight + frame.padding.top + frame.padding.bottom : blockHeight
  return { prims: out, height: frameHeight }
}

const drawShapeItem = (
  ctx: LayoutContext,
  item: Extract<VectorItem, { kind: 'shape' }>,
  box: Rect,
): Primitive[] => {
  if (item.shape === 'line') {
    return [
      {
        type: 'line',
        x1: box.x,
        y1: box.y + box.h / 2,
        x2: box.x + box.w,
        y2: box.y + box.h / 2,
        color: item.stroke === 'none' ? colorOf(ctx, 'rule') : colorOf(ctx, item.stroke),
        width: item.strokeWidth,
      },
    ]
  }
  return [
    {
      type: 'rect',
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      ...(item.fill !== 'none' ? { fill: colorOf(ctx, item.fill) } : {}),
      ...(item.stroke !== 'none'
        ? { stroke: colorOf(ctx, item.stroke), strokeWidth: item.strokeWidth }
        : {}),
      radius: item.radius,
    },
  ]
}

const drawPatternItem = (
  item: Extract<VectorItem, { kind: 'pattern' }>,
  box: Rect,
): Primitive[] => {
  if (item.tileWidth <= 0) return []
  const count = Math.ceil(box.w / item.tileWidth)
  const art = parseArtwork(item.source)
  const out: Primitive[] = []
  for (let i = 0; i < count; i++) {
    const x = box.x + i * item.tileWidth
    const w = Math.min(item.tileWidth, box.x + box.w - x)
    if (w <= 0) break
    out.push(...artworkPrimitives(art, { x, y: box.y, w, h: box.h }))
  }
  return out
}

/** Render one band: background, its items in z-order, then its divider. */
export const layoutZone = (
  ctx: LayoutContext,
  zone: ZoneConfig,
  box: Rect,
  tokens: TokenValues,
  which: 'header' | 'footer',
  artboard: { width: number; height: number; bleed: number },
): Primitive[] => {
  if (zone.height <= 0) return []
  const out: Primitive[] = []

  if (zone.background !== 'none') {
    // The fill reads as a printed band, not a box drawn inside the margins: it
    // runs edge to edge and out to the outer side of its zone (up for a
    // header, down for a footer), swallowing the page margin and the bleed
    // rather than stopping at them. The side facing the content keeps the
    // zone's own edge, since that is the boundary the flow measures against.
    const bleed = artboard.bleed
    const outerY = which === 'header' ? -bleed : box.y
    const outerH = which === 'header' ? box.y + box.h + bleed : artboard.height - box.y + bleed
    out.push({ type: 'rect', x: -bleed, y: outerY, w: artboard.width + bleed * 2, h: outerH, fill: colorOf(ctx, zone.background) })
  }

  const p = zone.padding
  const innerX = box.x + p.left
  const innerY = box.y + p.top
  const innerW = Math.max(0, box.w - p.left - p.right)

  // A mark to the left of the text, with the text indented past it, so the two
  // read as one unit rather than as art that happens to be nearby.
  const pictogram = zone.pictogram
  const markWidth = pictogram.show && pictogram.source ? pictogram.size + pictogram.gap : 0

  const textItems = zone.items.filter((i): i is Extract<VectorItem, { kind: 'text' }> => i.kind === 'text')
  const others = zone.items.filter((i) => i.kind !== 'text')

  const stackedPrims: Primitive[] = []
  let stackTop = innerY
  let stackHeight = 0

  if (zone.stack) {
    let cursor = innerY
    for (const item of textItems) {
      const width = Math.max(0, Math.min(item.w, innerW - markWidth))
      const drawn = drawTextItem(ctx, item, { x: innerX + markWidth, y: cursor, w: width, h: item.h }, tokens, zone.scale)
      if (drawn.height === 0) continue
      stackedPrims.push(...drawn.prims)
      cursor += drawn.height + zone.stackGap
    }
    stackHeight = Math.max(0, cursor - innerY - zone.stackGap)
  } else {
    for (const item of textItems) {
      const rect = resolveItemRect(item, zone, box)
      const drawn = drawTextItem(ctx, item, { ...rect, x: rect.x + markWidth }, tokens, zone.scale)
      stackedPrims.push(...drawn.prims)
      stackTop = Math.min(stackTop, rect.y)
      stackHeight = Math.max(stackHeight, rect.y + drawn.height - stackTop)
    }
  }

  if (markWidth > 0) {
    const offset =
      pictogram.align === 'middle'
        ? Math.max(0, (stackHeight - pictogram.size) / 2)
        : pictogram.align === 'bottom'
          ? Math.max(0, stackHeight - pictogram.size)
          : 0
    out.push(
      ...drawArtwork(pictogram.source, pictogram.format, {
        x: innerX,
        y: stackTop + offset,
        w: pictogram.size,
        h: pictogram.size,
      }),
    )
  }

  out.push(...stackedPrims)

  for (const item of others) {
    const rect = resolveItemRect(item, zone, box)
    switch (item.kind) {
      case 'shape':
        out.push(...drawShapeItem(ctx, item, rect))
        break
      case 'pattern':
        out.push(...drawPatternItem(item, rect))
        break
      case 'image':
        out.push(...drawArtwork(item.source, item.format, rect, item.tint ? colorOf(ctx, item.tint) : undefined))
        break
    }
  }

  if (zone.divider.show) {
    const y = which === 'header' ? box.y + box.h : box.y
    out.push({
      type: 'line',
      x1: box.x,
      y1: y,
      x2: box.x + box.w,
      y2: y,
      color: colorOf(ctx, zone.divider.color),
      width: zone.divider.thickness,
    })
  }

  return out
}
