/**
 * Placing an underlay (a rendered PDF page or a second DXF's geometry) into
 * the plan's world space.
 *
 * `transform.x`/`transform.y` are the world-space position of the underlay's
 * own centre, not a corner or its native origin — every adjustment (drag,
 * scale, rotate) then acts in place around a fixed point instead of also
 * having to recompute a position to stop the thing jumping across the screen.
 */

/** The underlay's own local centre point, in its own local coordinates. */
export function underlayCentre(payload) {
  if (payload.kind === 'image') return { x: payload.width / 2, y: payload.height / 2 }
  const b = payload.bounds
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
}

/**
 * The 2D affine matrix mapping the underlay's local coordinates into world
 * space, as the six values an SVG `matrix()` transform takes.
 *
 * A DXF underlay's local space is already y-up, matching every other
 * coordinate in this app. A rendered PDF page is a raster image, whose local
 * space is y-down (row 0 at the top) — `flip` corrects that so both kinds are
 * placed by the same (x, y, scale, rotation) fields.
 */
export function underlayMatrix(transform, payload) {
  const { x, y, scale, rotation } = transform
  const rad = (rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const flip = payload.kind === 'image' ? -1 : 1

  const a = scale * cos
  const b = scale * sin
  const c = flip * -scale * sin
  const d = flip * scale * cos

  const centre = underlayCentre(payload)
  return { a, b, c, d, e: x - (a * centre.x + c * centre.y), f: y - (b * centre.x + d * centre.y) }
}

/** As a ready-to-use `matrix(...)` SVG transform string. */
export function underlayMatrixString(transform, payload) {
  const { a, b, c, d, e, f } = underlayMatrix(transform, payload)
  return `matrix(${a} ${b} ${c} ${d} ${e} ${f})`
}
