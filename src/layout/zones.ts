import type { LayoutContext } from './block'
import { colorOf, text as emitText, styleOf } from './block'
import { wrapText } from './fonts'
import type { LayoutHandle, Primitive } from './primitives'
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

/**
 * What is left for the schedule once both bands are taken out — and, where
 * the project has any, the shared content blocks above the footer.
 *
 * Subtracting rather than overlaying is what guarantees the schedule never
 * runs under any of them.
 */
export const contentArea = (
  artboard: { width: number; height: number },
  margins: { top: number; right: number; bottom: number; left: number },
  header: ZoneConfig,
  footer: ZoneConfig,
  insertSpace = 0,
): Rect => {
  const x = margins.left
  const w = Math.max(0, artboard.width - margins.left - margins.right)
  const headerSpace = header.height + (header.height > 0 ? header.contentGap : 0)
  const footerSpace = footer.height + (footer.height > 0 ? footer.contentGap : 0)
  const y = margins.top + headerSpace
  const h = Math.max(
    0,
    artboard.height - margins.top - margins.bottom - headerSpace - footerSpace - insertSpace,
  )
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
export const drawArtwork = (
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

/**
 * A region the text has to keep clear of — the pictogram, in practice.
 *
 * Lines that overlap it vertically are pushed right and set narrower; lines
 * below it get the whole width back. Without this the mark's indent applied
 * to every line, so a two-line title left a column of white beneath a mark
 * only tall enough to displace the first line.
 */
interface WrapAround {
  /** How far to push a line that sits beside the mark. */
  indent: number
  /** Bottom edge of the mark, in sheet millimetres. */
  until: number
}

const drawTextItem = (
  ctx: LayoutContext,
  item: Extract<VectorItem, { kind: 'text' }>,
  box: Rect,
  tokens: TokenValues,
  scale: number,
  wrapAround?: WrapAround,
): DrawnText => {
  const body = substituteTokens(item.text, tokens)
  if (!body.trim()) return { prims: [], height: 0 }

  const zoneCtx: LayoutContext = { ...ctx, scale }
  const style = styleOf(zoneCtx, item.role)
  const lineH = ctx.book.lineHeight(style, scale)
  const baseline = ctx.book.baselineOffset(style, scale)

  // Wrapping has to be measured against the narrower width, or a line broken
  // for the full width would overrun the mark once it is indented. Every line
  // that could sit beside the mark is therefore wrapped short; the ones that
  // end up below it are simply set wider than they were broken for, which
  // costs nothing but a slightly early break.
  const indent = wrapAround?.indent ?? 0
  const lines = wrapText(ctx.book, body, style, scale, Math.max(1, box.w - indent))
  const blockHeight = lines.length * lineH

  let top = box.y
  if (item.valign === 'middle') top = box.y + (box.h - blockHeight) / 2
  else if (item.valign === 'bottom') top = box.y + box.h - blockHeight

  /** Where a given line starts, and how wide it may be. */
  const lineBox = (i: number): { x: number; w: number } => {
    if (!wrapAround) return { x: box.x, w: box.w }
    const lineTop = top + i * lineH
    const beside = lineTop < wrapAround.until
    return beside
      ? { x: box.x + wrapAround.indent, w: box.w - wrapAround.indent }
      : { x: box.x, w: box.w }
  }

  const anchorFor = (x: number, w: number): number =>
    item.align === 'left' ? x : item.align === 'center' ? x + w / 2 : x + w

  const out: Primitive[] = []

  // The frame hugs the text that is actually there, not the item's drag box,
  // so a one-line stop name does not sit in a box sized for three.
  const frame = item.frame
  if (frame?.show) {
    const widest = Math.max(...lines.map((l) => ctx.book.measure(l, style, scale)), 0)
    const p = frame.padding
    const first = lineBox(0)
    const anchorX = anchorFor(first.x, first.w)
    const frameX = item.align === 'left' ? first.x : item.align === 'center' ? anchorX - widest / 2 : anchorX - widest
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
    const { x, w } = lineBox(i)
    out.push(...emitText(zoneCtx, line, item.role, anchorFor(x, w), top + i * lineH + baseline, item.align))
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

export interface ZoneResult {
  prims: Primitive[]
  /** Boxes the editor needs a grip on, in sheet millimetres. */
  handles: LayoutHandle[]
}

/** Render one band: background, its items in z-order, then its divider. */
export const layoutZone = (
  ctx: LayoutContext,
  zone: ZoneConfig,
  box: Rect,
  tokens: TokenValues,
  which: 'header' | 'footer',
  artboard: { width: number; height: number; bleed: number },
): ZoneResult => {
  if (zone.height <= 0) return { prims: [], handles: [] }
  const out: Primitive[] = []
  const handles: LayoutHandle[] = []

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

  // A mark to the left of the text, with the text set clear of it, so the two
  // read as one unit rather than as art that happens to be nearby.
  const pictogram = zone.pictogram
  const hasMark = pictogram.show && Boolean(pictogram.source)
  const markWidth = hasMark ? pictogram.size + pictogram.gap : 0

  const textItems = zone.items.filter((i): i is Extract<VectorItem, { kind: 'text' }> => i.kind === 'text')
  const others = zone.items.filter((i) => i.kind !== 'text')

  interface LaidText {
    prims: Primitive[]
    top: number
    height: number
  }

  /**
   * Lay the zone's text out against a given wrap region.
   *
   * Where the mark sits depends on how tall the text turned out, and how the
   * text sets depends on where the mark sits. The indent is the same either
   * way, though, so line breaks do not move between passes: the first settles
   * the height, the second places the lines against the mark's real band.
   */
  const layText = (band?: WrapAround): LaidText => {
    const prims: Primitive[] = []
    let top = innerY
    let height = 0

    if (zone.stack) {
      let cursor = innerY
      for (const item of textItems) {
        const width = Math.max(0, Math.min(item.w, innerW))
        const drawn = drawTextItem(ctx, item, { x: innerX, y: cursor, w: width, h: item.h }, tokens, zone.scale, band)
        if (drawn.height === 0) continue
        prims.push(...drawn.prims)
        cursor += drawn.height + zone.stackGap
      }
      height = Math.max(0, cursor - innerY - zone.stackGap)
    } else {
      for (const item of textItems) {
        const rect = resolveItemRect(item, zone, box)
        const drawn = drawTextItem(ctx, item, rect, tokens, zone.scale, band)
        prims.push(...drawn.prims)
        top = Math.min(top, rect.y)
        height = Math.max(height, rect.y + drawn.height - top)
      }
    }
    return { prims, top, height }
  }

  // Every line indented is both the settling pass and, on its own, the
  // unwrapped behaviour a short title still wants.
  const fullIndent: WrapAround | undefined = hasMark ? { indent: markWidth, until: Infinity } : undefined
  const settled = layText(fullIndent)

  let laid = settled
  if (hasMark) {
    // Not clamped at zero: a mark taller than the text should overhang it
    // evenly, which is what centring means, and a nudge may deliberately take
    // it outside the zone and past the page margin.
    const alignOffset =
      pictogram.align === 'middle'
        ? (settled.height - pictogram.size) / 2
        : pictogram.align === 'bottom'
          ? settled.height - pictogram.size
          : 0

    const markX = innerX + pictogram.offsetX
    const markY = settled.top + alignOffset + pictogram.offsetY

    if (pictogram.wrapText) {
      laid = layText({ indent: markWidth, until: markY + pictogram.size })
    }

    out.push(
      ...drawArtwork(pictogram.source, pictogram.format, {
        x: markX,
        y: markY,
        w: pictogram.size,
        h: pictogram.size,
      }),
    )
    handles.push({
      id: `${which}-pictogram`,
      zone: which,
      kind: 'pictogram',
      x: markX,
      y: markY,
      w: pictogram.size,
      h: pictogram.size,
    })
  }

  const stackedPrims = laid.prims

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

  return { prims: out, handles }
}
