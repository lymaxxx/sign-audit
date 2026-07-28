import type { Primitive } from './primitives'
import type { Rect } from '../model/units'

/**
 * Turning imported artwork into the same primitives everything else uses.
 *
 * A logo dropped into a band has to reach the press, not just the preview. The
 * PDF writer draws paths, not SVG documents, so the markup is converted here
 * and both renderers consume the result — which is the same reason the rest of
 * the engine emits primitives rather than drawing twice.
 *
 * This understands the shapes marks are actually drawn with: paths, circles,
 * ellipses, rectangles, lines and polygons. It is not an SVG renderer, and
 * makes no attempt to be one — no gradients, no clipping, no nested transforms.
 */

export interface ParsedArtwork {
  /** The drawing, in its own coordinate system. */
  paths: Array<{ d: string; fill?: string; stroke?: string; strokeWidth?: number }>
  /** That coordinate system's extent. */
  width: number
  height: number
}

const attr = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"|\\b${name}\\s*=\\s*'([^']*)'`).exec(tag)
  return m ? (m[1] ?? m[2]) : undefined
}

const num = (tag: string, name: string, fallback = 0): number => {
  const raw = attr(tag, name)
  const value = raw === undefined ? NaN : Number.parseFloat(raw)
  return Number.isFinite(value) ? value : fallback
}

const ellipsePath = (cx: number, cy: number, rx: number, ry: number): string =>
  `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0 Z`

const roundedRectPath = (x: number, y: number, w: number, h: number, r: number): string => {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  if (radius === 0) return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`
  return (
    `M ${x + radius} ${y} H ${x + w - radius} A ${radius} ${radius} 0 0 1 ${x + w} ${y + radius} ` +
    `V ${y + h - radius} A ${radius} ${radius} 0 0 1 ${x + w - radius} ${y + h} ` +
    `H ${x + radius} A ${radius} ${radius} 0 0 1 ${x} ${y + h - radius} ` +
    `V ${y + radius} A ${radius} ${radius} 0 0 1 ${x + radius} ${y} Z`
  )
}

const pointsPath = (points: string, close: boolean): string => {
  const coords = points.trim().split(/[\s,]+/).map(Number)
  if (coords.length < 4) return ''
  const parts: string[] = [`M ${coords[0]} ${coords[1]}`]
  for (let i = 2; i + 1 < coords.length; i += 2) parts.push(`L ${coords[i]} ${coords[i + 1]}`)
  if (close) parts.push('Z')
  return parts.join(' ')
}

/**
 * Read artwork, keeping the coordinate system it was drawn in.
 *
 * The `viewBox` is the thing that must survive: strip it and a mark drawn on a
 * 100-unit grid is placed as though those were millimetres, which is how a
 * pictogram ends up the size of the sheet.
 */
export const parseArtwork = (markup: string): ParsedArtwork => {
  const root = /<svg\b[^>]*>/i.exec(markup)?.[0] ?? ''
  const viewBox = attr(root, 'viewBox')

  let width = num(root, 'width', 0)
  let height = num(root, 'height', 0)

  if (viewBox) {
    const [, , vw, vh] = viewBox.trim().split(/[\s,]+/).map(Number)
    if (vw && vh) {
      width = vw
      height = vh
    }
  }
  if (!width || !height) {
    width = width || 100
    height = height || 100
  }

  const paths: ParsedArtwork['paths'] = []
  const style = (tag: string) => {
    const fill = attr(tag, 'fill')
    const stroke = attr(tag, 'stroke')
    const strokeWidth = attr(tag, 'stroke-width')
    return {
      // An unstated fill is black in SVG, and a mark with neither fill nor
      // stroke would otherwise come out invisible.
      ...(fill && fill !== 'none' ? { fill } : stroke ? {} : { fill: '#000000' }),
      ...(stroke && stroke !== 'none' ? { stroke } : {}),
      ...(strokeWidth ? { strokeWidth: Number.parseFloat(strokeWidth) } : {}),
    }
  }

  for (const m of markup.matchAll(/<(path|circle|ellipse|rect|line|polygon|polyline)\b[^>]*>/gi)) {
    const tag = m[0]
    const kind = m[1]!.toLowerCase()
    let d = ''

    switch (kind) {
      case 'path':
        d = attr(tag, 'd') ?? ''
        break
      case 'circle': {
        const r = num(tag, 'r')
        if (r > 0) d = ellipsePath(num(tag, 'cx'), num(tag, 'cy'), r, r)
        break
      }
      case 'ellipse':
        d = ellipsePath(num(tag, 'cx'), num(tag, 'cy'), num(tag, 'rx'), num(tag, 'ry'))
        break
      case 'rect':
        d = roundedRectPath(num(tag, 'x'), num(tag, 'y'), num(tag, 'width'), num(tag, 'height'), num(tag, 'rx'))
        break
      case 'line':
        d = `M ${num(tag, 'x1')} ${num(tag, 'y1')} L ${num(tag, 'x2')} ${num(tag, 'y2')}`
        break
      case 'polygon':
        d = pointsPath(attr(tag, 'points') ?? '', true)
        break
      case 'polyline':
        d = pointsPath(attr(tag, 'points') ?? '', false)
        break
    }

    if (d) paths.push({ d, ...style(tag) })
  }

  return { paths, width, height }
}

/**
 * Place artwork into a box on the sheet, letter-boxed to keep its proportions.
 * A tint replaces every colour in the mark, for a logo that has to follow the
 * sheet's own palette.
 */
export const artworkPrimitives = (art: ParsedArtwork, box: Rect, tint?: string): Primitive[] => {
  if (art.paths.length === 0 || art.width <= 0 || art.height <= 0) return []

  const scale = Math.min(box.w / art.width, box.h / art.height)
  const x = box.x + (box.w - art.width * scale) / 2
  const y = box.y + (box.h - art.height * scale) / 2

  return art.paths.map((p) => ({
    type: 'path' as const,
    d: p.d,
    x,
    y,
    scale,
    ...(p.fill ? { fill: tint ?? p.fill } : {}),
    ...(p.stroke ? { stroke: tint ?? p.stroke } : {}),
    ...(p.strokeWidth !== undefined ? { strokeWidth: p.strokeWidth * scale } : {}),
  }))
}
