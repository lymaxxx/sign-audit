/**
 * Sign markers that are not blocks.
 *
 * Multi-sided signs on the reference drawing are sometimes drawn as loose
 * geometry — a circle, a closed rectangle, or four separate lines forming a
 * rectangle, with a point at its centre and the side letters written around
 * it — rather than as a block reference. There is nothing to key on but the
 * shape.
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

// Per-entity detectors: each classifies a single entity in isolation.
// `rectanglesFromLines` below is different — a rectangle built from four
// separate LINE entities can only be recognised by looking at several
// entities together — so it is merged in separately by both callers rather
// than living in this list.
const SHAPE_DETECTORS = [circleShape, quadShape]

function shapeOf(entity) {
  for (const detect of SHAPE_DETECTORS) {
    const shape = detect(entity)
    if (shape) return shape
  }
  return null
}

function segmentBounds(segments) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [a, b] of segments) {
    for (const p of [a, b]) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
  }
  return { minX, minY, maxX, maxY }
}

/** Walk a degree-2 cycle starting at `start`, returning node ids in order. */
function orderCycle(start, adjacency, edges) {
  const order = [start]
  let previous = null
  let current = start
  for (let step = 0; step < 3; step++) {
    const neighbors = adjacency[current].map((e) => {
      const [a, b] = edges[e]
      return a === current ? b : a
    })
    const next = neighbors.find((n) => n !== previous) ?? neighbors[0]
    order.push(next)
    previous = current
    current = next
  }
  return order
}

/**
 * Reject anything that isn't actually a rectangle before accepting it — a
 * stray closed loop of four unrelated lines elsewhere in a dense drawing is
 * possible, and reading a sign where there isn't one is worse than missing a
 * real one. Opposite sides must be close to equal length and every corner
 * close to a right angle.
 */
function rectangleBox(points) {
  const sides = points.map((p, i) => {
    const q = points[(i + 1) % 4]
    return { dx: q.x - p.x, dy: q.y - p.y, len: Math.hypot(q.x - p.x, q.y - p.y) }
  })
  if (sides.some((s) => s.len < 1e-9)) return null

  const relativeDiff = (a, b) => Math.abs(a.len - b.len) / Math.max(a.len, b.len)
  if (relativeDiff(sides[0], sides[2]) > 0.05 || relativeDiff(sides[1], sides[3]) > 0.05) return null

  for (let i = 0; i < 4; i++) {
    const incoming = sides[(i + 3) % 4]
    const outgoing = sides[i]
    // Cosine of the angle between the two edges meeting at this corner —
    // close to zero for a right angle, whichever way the loop winds.
    const cos = (incoming.dx * outgoing.dx + incoming.dy * outgoing.dy) / (incoming.len * outgoing.len)
    if (Math.abs(cos) > 0.17) return null // roughly 80°-100°
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

/** Closed 4-edge loops within one layer's LINE segments, validated as rectangles. */
function closedQuadsFromSegments(segments) {
  if (segments.length < 4) return []

  const bounds = segmentBounds(segments)
  // Endpoints from two independently-drawn lines meeting at the same corner
  // are never bit-for-bit identical once exported, so they are matched with a
  // tolerance relative to the shapes' own extent, the same way `centreMarked`
  // matches a POINT to a shape's centre.
  const tolerance = Math.max(Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 1e-6, 1e-6)

  const nodes = []
  const nodeOf = (p) => {
    for (let i = 0; i < nodes.length; i++) {
      if (Math.abs(nodes[i].x - p.x) <= tolerance && Math.abs(nodes[i].y - p.y) <= tolerance) return i
    }
    nodes.push({ x: p.x, y: p.y })
    return nodes.length - 1
  }

  const edges = segments.map(([a, b]) => [nodeOf(a), nodeOf(b)])
  const adjacency = nodes.map(() => [])
  edges.forEach(([a, b], index) => {
    adjacency[a].push(index)
    adjacency[b].push(index)
  })

  const seen = new Set()
  const boxes = []
  for (let start = 0; start < nodes.length; start++) {
    if (seen.has(start)) continue
    const componentNodes = new Set()
    const componentEdges = new Set()
    const queue = [start]
    seen.add(start)
    while (queue.length) {
      const n = queue.pop()
      componentNodes.add(n)
      for (const e of adjacency[n]) {
        componentEdges.add(e)
        const [a, b] = edges[e]
        const other = a === n ? b : a
        if (!seen.has(other)) {
          seen.add(other)
          queue.push(other)
        }
      }
    }

    // A rectangle drawn as four lines is exactly four nodes, four edges, each
    // node touching exactly two edges — a simple closed quadrilateral. Any
    // branching (a node touched by a third line) or a longer/shorter loop is
    // left alone rather than guessed at.
    if (componentNodes.size !== 4 || componentEdges.size !== 4) continue
    if (![...componentNodes].every((n) => adjacency[n].length === 2)) continue

    const box = rectangleBox(orderCycle(start, adjacency, edges).map((id) => nodes[id]))
    if (box) boxes.push(box)
  }
  return boxes
}

/**
 * Rectangles built from four separate LINE entities forming a closed loop —
 * the same convention as `quadShape` above, just without a single polyline
 * tying the four sides together. Grouped by layer both to scope the shape
 * search sensibly and because the result needs a layer to report.
 */
function rectanglesFromLines(entities) {
  const byLayer = new Map()
  for (const entity of entities) {
    if (entity.type !== 'LINE') continue
    const [a, b] = entity.vertices ?? []
    if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(b.x)) continue
    const layer = entity.layer ?? '0'
    const list = byLayer.get(layer) ?? []
    list.push([a, b])
    byLayer.set(layer, list)
  }

  const shapes = []
  for (const [layer, segments] of byLayer) {
    for (const box of closedQuadsFromSegments(segments)) {
      shapes.push({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2, box, layer })
    }
  }
  return shapes
}

function markerFrom(shape, layer, points) {
  const span = Math.max(shape.box.maxX - shape.box.minX, shape.box.maxY - shape.box.minY, 0)
  const tolerance = Math.max(span * CENTRE_TOLERANCE, 1e-6)
  return {
    x: shape.x,
    y: shape.y,
    box: shape.box,
    layer,
    hasCentreMark: centreMarked(points, shape.x, shape.y, tolerance),
  }
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
    markers.push(markerFrom(shape, entity.layer, points))
  }

  for (const shape of rectanglesFromLines(entities)) {
    if (!layers.has(shape.layer)) continue
    markers.push(markerFrom(shape, shape.layer, points))
  }

  return markers
}

/**
 * Layers worth offering as loose-marker sources: those holding circles or
 * closed quadrilaterals (as one polyline, or as four separate lines) that
 * look like markers rather than incidental geometry.
 */
export function looseMarkerLayers(entities) {
  const counts = new Map()
  const points = entities.filter((e) => e.type === 'POINT' && e.position)

  const tally = (shape, layer) => {
    const marked = centreMarked(points, shape.x, shape.y, 1e-6)
    const current = counts.get(layer) ?? { layer, shapes: 0, withCentreMark: 0 }
    current.shapes++
    if (marked) current.withCentreMark++
    counts.set(layer, current)
  }

  for (const entity of entities) {
    const shape = shapeOf(entity)
    if (shape) tally(shape, entity.layer ?? '0')
  }
  for (const shape of rectanglesFromLines(entities)) {
    tally(shape, shape.layer)
  }

  return [...counts.values()].sort((a, b) => b.withCentreMark - a.withCentreMark || b.shapes - a.shapes)
}
