import type { LayoutContext } from './block'
import { colorOf, text as emitText, styleOf } from './block'
import { wrapText } from './fonts'
import type { Primitive } from './primitives'
import type { Rect } from '../model/units'
import type { VectorItem, ZoneConfig } from '../model/template'

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
  const y = margins.top + header.height
  const h = Math.max(0, artboard.height - margins.top - margins.bottom - header.height - footer.height)
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

const drawTextItem = (
  ctx: LayoutContext,
  item: Extract<VectorItem, { kind: 'text' }>,
  box: Rect,
  tokens: TokenValues,
  scale: number,
): Primitive[] => {
  const body = substituteTokens(item.text, tokens)
  if (!body.trim()) return []

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
  return out
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
  const out: Primitive[] = []
  for (let i = 0; i < count; i++) {
    const x = box.x + i * item.tileWidth
    const w = Math.min(item.tileWidth, box.x + box.w - x)
    if (w <= 0) break
    out.push({ type: 'image', x, y: box.y, w, h: box.h, source: item.source, format: 'svg' })
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
): Primitive[] => {
  if (zone.height <= 0) return []
  const out: Primitive[] = []

  if (zone.background !== 'none') {
    out.push({ type: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, fill: colorOf(ctx, zone.background) })
  }

  for (const item of zone.items) {
    const rect = resolveItemRect(item, zone, box)
    switch (item.kind) {
      case 'text':
        out.push(...drawTextItem(ctx, item, rect, tokens, zone.scale))
        break
      case 'shape':
        out.push(...drawShapeItem(ctx, item, rect))
        break
      case 'pattern':
        out.push(...drawPatternItem(item, rect))
        break
      case 'image':
        out.push({
          type: 'image',
          x: rect.x,
          y: rect.y,
          w: rect.w,
          h: rect.h,
          source: item.source,
          format: item.format,
        })
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
