/**
 * The layout engine works in millimetres end to end. Type sizes are the one
 * exception: they are authored in points, because that is how anyone setting
 * type thinks about them, and converted at measurement time.
 */

export const MM_PER_INCH = 25.4
export const PT_PER_INCH = 72

export const ptToMm = (pt: number): number => (pt * MM_PER_INCH) / PT_PER_INCH
export const mmToPt = (mm: number): number => (mm * PT_PER_INCH) / MM_PER_INCH

/** Round to a sane precision so golden tests are not hostage to float noise. */
export const round = (v: number, places = 4): number => {
  const f = 10 ** places
  return Math.round(v * f) / f
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h })

/** Shrink a rect by per-side insets. */
export const inset = (
  r: Rect,
  top: number,
  right: number,
  bottom: number,
  left: number,
): Rect => ({
  x: r.x + left,
  y: r.y + top,
  w: Math.max(0, r.w - left - right),
  h: Math.max(0, r.h - top - bottom),
})

export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

export const insets = (top: number, right = top, bottom = top, left = right): Insets => ({
  top,
  right,
  bottom,
  left,
})
