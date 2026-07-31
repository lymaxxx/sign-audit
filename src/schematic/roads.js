// A purely decorative background "streets" layer for the schematic view.
//
// This is deliberately NOT geography — it's built entirely from the
// schematic's own diagram-space node positions, the same way the rest of the
// schematic ignores real distances in favour of layout clarity. A road
// segment can be very short even if the real streets it loosely evokes are
// long, because the two things it connects happen to have landed close
// together in the schematic layout.

// Gabriel graph: connect two points when no third point lies inside the
// circle that has them as its diameter. A simple, well-behaved proximity
// mesh — enough to read as "streets between nearby corridors" without any
// crossing-minimisation machinery of its own.
function gabrielConnectors(points, maxDist) {
  const n = points.length
  const out = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = points[j].x - points[i].x
      const dy = points[j].y - points[i].y
      const d = Math.hypot(dx, dy)
      if (d < 1e-6 || d > maxDist) continue
      const mx = (points[i].x + points[j].x) / 2
      const my = (points[i].y + points[j].y) / 2
      const r2 = (d / 2) ** 2
      let blocked = false
      for (let k = 0; k < n; k++) {
        if (k === i || k === j) continue
        const ddx = points[k].x - mx
        const ddy = points[k].y - my
        if (ddx * ddx + ddy * ddy < r2) {
          blocked = true
          break
        }
      }
      if (!blocked) out.push({ i, j })
    }
  }
  return out
}

// Above this many nodes the O(n^3) Gabriel check gets expensive enough that
// a settings tweak would visibly lag; the roads toggle is disabled past it.
export const ROADS_MAX_NODES = 260

export function buildRoadNetwork(graph, positions, edgeLength) {
  const n = graph.nodes.length
  if (n < 2 || n > ROADS_MAX_NODES) return []

  const points = graph.nodes.map((node) => positions.get(node.stopId))
  const edgeSet = new Set(graph.edges.map((e) => e.key))

  const segments = []
  // Corridor underlay: a simplified road wherever a transit line actually runs.
  for (const e of graph.edges) {
    segments.push({ a: points[e.u], b: points[e.v], key: `c-${e.key}` })
  }

  // Cross-street connectors between nearby, otherwise-unconnected corridors.
  const connectors = gabrielConnectors(points, edgeLength * 2.5)
  for (const { i, j } of connectors) {
    const key = i < j ? `${i}|${j}` : `${j}|${i}`
    if (edgeSet.has(key)) continue
    segments.push({ a: points[i], b: points[j], key: `x-${key}` })
  }

  return segments
}
