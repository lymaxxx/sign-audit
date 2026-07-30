/**
 * Sign markers that are not blocks.
 *
 * Multi-sided signs on the reference drawing are drawn as loose geometry — a
 * circle with a point at its centre and the side letters written around it —
 * rather than as a block reference. There is nothing to key on but the shape.
 *
 * Only the position is taken. The letters are deliberately **not** read: the
 * count and arrangement vary between drawings, text can sit anywhere relative
 * to the circle, and a wrong guess about how many faces a sign has is worse
 * than no guess, because it silently produces the wrong number of photo slots.
 * The user sets sides explicitly instead.
 */

/** A POINT this close to a circle's centre is taken to be its insertion mark. */
const CENTRE_TOLERANCE = 1e-6

/**
 * @param {object[]} entities model-space entities
 * @param {Set<string>} layers layers to search
 * @returns {Array<{x: number, y: number, radius: number, layer: string, hasCentreMark: boolean}>}
 */
export function findLooseMarkers(entities, layers) {
  if (!layers?.size) return []

  const points = entities.filter((e) => e.type === 'POINT' && e.position)
  const markers = []

  for (const entity of entities) {
    if (entity.type !== 'CIRCLE' || !entity.center) continue
    if (!layers.has(entity.layer)) continue

    const radius = entity.radius ?? 0
    const tolerance = Math.max(radius * CENTRE_TOLERANCE, 1e-6)
    const hasCentreMark = points.some(
      (p) =>
        Math.abs(p.position.x - entity.center.x) <= tolerance &&
        Math.abs(p.position.y - entity.center.y) <= tolerance,
    )

    markers.push({
      x: entity.center.x,
      y: entity.center.y,
      radius,
      layer: entity.layer,
      hasCentreMark,
    })
  }

  return markers
}

/**
 * Layers worth offering as loose-marker sources: those holding circles that
 * look like markers rather than incidental geometry.
 */
export function looseMarkerLayers(entities) {
  const counts = new Map()
  const points = entities.filter((e) => e.type === 'POINT' && e.position)

  for (const entity of entities) {
    if (entity.type !== 'CIRCLE' || !entity.center) continue
    const marked = points.some(
      (p) =>
        Math.abs(p.position.x - entity.center.x) < 1e-6 &&
        Math.abs(p.position.y - entity.center.y) < 1e-6,
    )
    const layer = entity.layer ?? '0'
    const current = counts.get(layer) ?? { layer, circles: 0, withCentreMark: 0 }
    current.circles++
    if (marked) current.withCentreMark++
    counts.set(layer, current)
  }

  return [...counts.values()].sort((a, b) => b.withCentreMark - a.withCentreMark || b.circles - a.circles)
}
