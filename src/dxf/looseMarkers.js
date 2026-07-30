/**
 * Sign markers that are not blocks.
 *
 * Multi-sided signs on the reference drawing are sometimes drawn as loose
 * geometry — a circle or a plain rectangle with a point at its centre and the
 * side letters written around it — rather than as a block reference. There is
 * nothing to key on but the shape.
 *
 * Only the position (and, for rectangles, the box itself) is taken. The
 * letters are deliberately **not** read: the count and arrangement vary
 * between drawings, text can sit anywhere relative to the shape, and a wrong
 * guess about how many faces a sign has is worse than no guess, because it
 * silently produces the wrong number of photo slots. The user sets sides
 * explicitly instead.
 */

/** A POINT this close to a shape's centre is taken to be its insertion mark. */
const CENTRE_TOLERANCE = 1e-6

function centreMarked(points, x, y, tolerance) {
  return points.some(
    (p) => Math.abs(p.position.x - x) <= tolerance && Math.abs(p.position.y - y) <= tolerance,
  )
}

/** A CIRCLE's centre and a square box sized to its radius. */
function circleShape(entity) {
  if (entity.type !== 'CIRCLE' || !entity.center) return null
  const radius = entity.radius ?? 0
  return {
    x: entity.center.x,
    y: entity.center.y,
    box: {
      minX: entity.center.x - radius,
      minY: entity.center.y - radius,
      maxX: entity.center.x + radius,
      maxY: entity.center.y + radius,
    },
  }
}

/** A closed 4-vertex LWPOLYLINE/POLYLINE and its box, treated as a rectangle. */
function quadShape(entity) {
  if (entity.type !== 'LWPOLYLINE' && entity.type !== 'POLYLINE') return null
  if (!entity.shape) return null
  const vertices = entity.vertices ?? []
  if (vertices.length !== 4) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const v of vertices) {
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null
    if (v.x < minX) minX = v.x
    if (v.y < minY) minY = v.y
    if (v.x > maxX) maxX = v.x
    if (v.y > maxY) maxY = v.y
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null

  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, box: { minX, minY, maxX, maxY } }
}

const SHAPE_DETECTORS = [circleShape, quadShape]

function shapeOf(entity) {
  for (const detect of SHAPE_DETECTORS) {
    const shape = detect(entity)
    if (shape) return shape
  }
  return null
}

/**
 * @param {object[]} entities model-space entities
 * @param {Set<string>} layers layers to search
 * @returns {Array<{x: number, y: number, box: object, layer: string, hasCentreMark: boolean}>}
 */
export function findLooseMarkers(entities, layers) {
  if (!layers?.size) return []

  const points = entities.filter((e) => e.type === 'POINT' && e.position)
  const markers = []

  for (const entity of entities) {
    if (!layers.has(entity.layer)) continue
    const shape = shapeOf(entity)
    if (!shape) continue

    const span = Math.max(shape.box.maxX - shape.box.minX, shape.box.maxY - shape.box.minY, 0)
    const tolerance = Math.max(span * CENTRE_TOLERANCE, 1e-6)
    markers.push({
      x: shape.x,
      y: shape.y,
      box: shape.box,
      layer: entity.layer,
      hasCentreMark: centreMarked(points, shape.x, shape.y, tolerance),
    })
  }

  return markers
}

/**
 * Layers worth offering as loose-marker sources: those holding circles or
 * closed quadrilaterals that look like markers rather than incidental
 * geometry.
 */
export function looseMarkerLayers(entities) {
  const counts = new Map()
  const points = entities.filter((e) => e.type === 'POINT' && e.position)

  for (const entity of entities) {
    const shape = shapeOf(entity)
    if (!shape) continue
    const marked = centreMarked(points, shape.x, shape.y, 1e-6)
    const layer = entity.layer ?? '0'
    const current = counts.get(layer) ?? { layer, shapes: 0, withCentreMark: 0 }
    current.shapes++
    if (marked) current.withCentreMark++
    counts.set(layer, current)
  }

  return [...counts.values()].sort((a, b) => b.withCentreMark - a.withCentreMark || b.shapes - a.shapes)
}
