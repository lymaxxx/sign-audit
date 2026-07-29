/**
 * The one thing both renderers understand.
 *
 * `layout()` turns a document into a flat list of these, in millimetres, with
 * every style reference already resolved. The SVG preview and the PDF writer
 * each walk the same list, which is what makes the screen and the press agree
 * rather than merely resemble one another.
 */

export interface TextPrimitive {
  type: 'text'
  x: number
  /** Baseline, not the top of the line box. */
  y: number
  text: string
  family: string
  weight: number
  italic: boolean
  /** Resolved type size in millimetres. */
  sizeMm: number
  color: string
}

export interface RectPrimitive {
  type: 'rect'
  x: number
  y: number
  w: number
  h: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  radius?: number
}

export interface LinePrimitive {
  type: 'line'
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  width: number
}

export interface PathPrimitive {
  type: 'path'
  /** Path data in its own coordinate system, placed by `x`, `y` and `scale`.
   *  Kept unbaked so the PDF writer can hand it straight to its own path
   *  drawing, which takes an origin and a scale rather than absolute data. */
  d: string
  x: number
  y: number
  scale: number
  fill?: string
  stroke?: string
  strokeWidth?: number
}

export interface ImagePrimitive {
  type: 'image'
  x: number
  y: number
  w: number
  h: number
  /** Inline SVG markup, or a data URI. */
  source: string
  format: 'svg' | 'raster'
}

export type Primitive =
  | TextPrimitive
  | RectPrimitive
  | LinePrimitive
  | PathPrimitive
  | ImagePrimitive

/** What a layout pass produced, and how comfortably it fitted. */
export interface LayoutDiagnostics {
  /** Combined block scale and auto-fit scale actually used. */
  scale: number
  /** Auto-fit factor alone, 1 when nothing had to be shrunk. */
  fitScale: number
  columns: number
  rows: number
  /** True when the content still does not fit at the smallest allowed size. */
  overflow: boolean
  /** Height the content wanted, against the height it had. */
  contentHeight: number
  availableHeight: number
  blockCount: number
}

/**
 * Something the layout placed by its own rules that the editor still has to
 * offer a grip on.
 *
 * The pictogram is positioned against the measured height of the text beside
 * it, so the canvas cannot work out where it landed without redoing the
 * layout. Handing the box back means the thing being dragged is exactly the
 * thing that was drawn.
 */
export interface LayoutHandle {
  id: string
  zone: 'header' | 'footer'
  kind: 'pictogram'
  x: number
  y: number
  w: number
  h: number
}

export interface Page {
  /** Trim size in millimetres. */
  width: number
  height: number
  bleed: number
  primitives: Primitive[]
  /** Boxes the editor can offer handles for. Empty for a plain render. */
  handles: LayoutHandle[]
  diagnostics: LayoutDiagnostics
}

/** Bounding box of a set of primitives, for fitting and for hit-testing. */
export const boundsOf = (prims: Primitive[]): { x: number; y: number; w: number; h: number } => {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  const grow = (x: number, y: number) => {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }

  for (const p of prims) {
    switch (p.type) {
      case 'text':
        grow(p.x, p.y - p.sizeMm)
        grow(p.x, p.y)
        break
      case 'rect':
      case 'image':
        grow(p.x, p.y)
        grow(p.x + p.w, p.y + p.h)
        break
      case 'line':
        grow(p.x1, p.y1)
        grow(p.x2, p.y2)
        break
      case 'path':
        break
    }
  }

  if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
