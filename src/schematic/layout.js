// Schematic (metro-map style) layout.
//
// A hill-climbing optimiser in the spirit of Stott & Rodgers' metro map
// algorithm: start from the real geography, then repeatedly nudge stations to
// nearby candidate positions, keeping a move whenever it lowers a weighted cost
// made of octilinearity (or whatever angle increment is configured), even edge
// lengths, line straightness, node/edge separation and relative-position
// preservation.

import { distToSegment2, segmentsIntersect } from '../lib/geo.js'

function mulberry32(seed) {
  let a = seed >>> 0
  return function rng() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DEG = 180 / Math.PI

function angDiff(a, b) {
  let d = ((a - b) % 360 + 540) % 360 - 180
  return Math.abs(d)
}

function allowedDirections(angleStep) {
  const dirs = []
  const count = Math.max(2, Math.round(360 / angleStep))
  for (let k = 0; k < count; k++) {
    const a = (k * 360) / count
    dirs.push({ deg: a, dx: Math.cos((a * Math.PI) / 180), dy: Math.sin((a * Math.PI) / 180) })
  }
  return dirs
}

function deviationFromAllowed(deg, angleStep) {
  const step = 360 / Math.max(2, Math.round(360 / angleStep))
  const k = Math.round(deg / step)
  return angDiff(deg, k * step)
}

export function* layoutIterator(graph, options = {}) {
  const {
    angleStep = 45,
    iterations = 40,
    edgeLength = 92,
    strictness = 1,
    seed = 1,
    overrides = {},
  } = options

  const nodes = graph.nodes
  const n = nodes.length
  if (!n) return { positions: [], bounds: null }

  const rng = mulberry32(seed * 2654435761)
  const dirs = allowedDirections(angleStep)

  // --- initial placement: geography, scaled so the median edge is `edgeLength`
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  const ox = new Float64Array(n) // original (geographic) positions, for the
  const oy = new Float64Array(n) // relative-position term
  const lengths = graph.edges.map((e) =>
    Math.hypot(nodes[e.u].gx - nodes[e.v].gx, nodes[e.u].gy - nodes[e.v].gy),
  )
  const sorted = lengths.slice().sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] || 1
  const scale = edgeLength / Math.max(1e-6, median)
  for (let i = 0; i < n; i++) {
    xs[i] = nodes[i].gx * scale
    ys[i] = nodes[i].gy * scale
    ox[i] = xs[i]
    oy[i] = ys[i]
  }

  const fixed = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const o = overrides[nodes[i].stopId]
    if (o) {
      xs[i] = o[0]
      ys[i] = o[1]
      fixed[i] = 1
    }
  }

  // --- precomputed structure
  const incident = graph.adj.map((list) => list.map((a) => a))
  graph.edges.forEach((e, i) => {
    e.id = i
  })
  const tripleRefs = Array.from({ length: n }, () => [])
  for (const t of graph.triples) {
    for (const idx of t) tripleRefs[idx].push(t)
  }
  const originalAngle = new Map()
  for (const e of graph.edges) {
    originalAngle.set(
      e.id,
      Math.atan2(oy[e.v] - oy[e.u], ox[e.v] - ox[e.u]) * DEG,
    )
  }

  const ideal = edgeLength
  const minNodeDist = edgeLength * 0.82
  const minNodeEdge = edgeLength * 0.55
  const W = {
    angle: 4 * strictness,
    length: 1.1,
    // a coarse angle grid needs more freedom to move away from true bearings
    relative: 1.4 * Math.min(1, 45 / angleStep),
    straight: 1.3,
    nodeNode: 3.2,
    nodeEdge: 2.2,
    crossing: 4,
  }

  // --- spatial hash over node positions, rebuilt every iteration
  const cell = edgeLength
  let buckets = new Map()
  const bucketKey = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`
  function rebuildIndex() {
    buckets = new Map()
    for (let i = 0; i < n; i++) {
      const k = bucketKey(xs[i], ys[i])
      let arr = buckets.get(k)
      if (!arr) buckets.set(k, (arr = []))
      arr.push(i)
    }
  }
  function nearbyNodes(x, y, radiusCells = 2) {
    const cx = Math.floor(x / cell)
    const cy = Math.floor(y / cell)
    const out = []
    for (let dx = -radiusCells; dx <= radiusCells; dx++) {
      for (let dy = -radiusCells; dy <= radiusCells; dy++) {
        const arr = buckets.get(`${cx + dx},${cy + dy}`)
        if (arr) out.push(...arr)
      }
    }
    return out
  }

  function edgeAngleCost(i, j, x, y, edge) {
    const dx = xs[j] - x
    const dy = ys[j] - y
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) return W.angle * 4 + W.length * 4
    const deg = Math.atan2(dy, dx) * DEG
    const dev = deviationFromAllowed(deg, angleStep) / (angleStep / 2)
    let cost = W.angle * dev * dev

    const r = len / ideal
    const short = Math.max(0, 1 - r)
    const long = Math.max(0, r - 1)
    cost += W.length * (short * short * 2.2 + long * long * 0.22)

    // relative position: keep roughly the same bearing as in reality
    const orig = edge.u === i ? originalAngle.get(edge.id) : originalAngle.get(edge.id) + 180
    const rel = angDiff(deg, orig) / 90
    cost += W.relative * rel * rel
    return cost
  }

  function nodeCost(i, x, y) {
    let cost = 0
    const inc = incident[i]
    for (let a = 0; a < inc.length; a++) {
      cost += edgeAngleCost(i, inc[a].other, x, y, inc[a].edge)
    }

    // straightness of lines running through a station
    for (const t of tripleRefs[i]) {
      const [p, q, r] = t
      const px = p === i ? x : xs[p]
      const py = p === i ? y : ys[p]
      const qx = q === i ? x : xs[q]
      const qy = q === i ? y : ys[q]
      const rx = r === i ? x : xs[r]
      const ry = r === i ? y : ys[r]
      const a1 = Math.atan2(py - qy, px - qx) * DEG
      const a2 = Math.atan2(ry - qy, rx - qx) * DEG
      const turn = (180 - angDiff(a1, a2)) / 180
      cost += W.straight * turn * turn
    }

    // separation from other stations
    const near = nearbyNodes(x, y, 2)
    const seenEdges = new Set()
    for (const m of near) {
      if (m === i) continue
      const d = Math.hypot(xs[m] - x, ys[m] - y)
      if (d < minNodeDist) {
        const t = (minNodeDist - d) / minNodeDist
        cost += W.nodeNode * t * t * 9
      }
      for (const { edge } of incident[m]) {
        if (edge.u === i || edge.v === i) continue
        if (seenEdges.has(edge.id)) continue
        seenEdges.add(edge.id)
        // node/edge clearance
        const d2 = distToSegment2([x, y], [xs[edge.u], ys[edge.u]], [xs[edge.v], ys[edge.v]])
        const dist = Math.sqrt(d2)
        if (dist < minNodeEdge) {
          const t = (minNodeEdge - dist) / minNodeEdge
          cost += W.nodeEdge * t * t * 7
        }
        // crossings with the edges of this node
        for (const { edge: mine, other } of inc) {
          if (mine.u === edge.u || mine.u === edge.v || mine.v === edge.u || mine.v === edge.v)
            continue
          if (
            segmentsIntersect(
              [x, y],
              [xs[other], ys[other]],
              [xs[edge.u], ys[edge.u]],
              [xs[edge.v], ys[edge.v]],
            )
          ) {
            cost += W.crossing
          }
        }
      }
    }

    // keep our own edges clear of nearby stations
    for (const { other } of inc) {
      for (const m of near) {
        if (m === i || m === other) continue
        const dist = Math.sqrt(distToSegment2([xs[m], ys[m]], [x, y], [xs[other], ys[other]]))
        if (dist < minNodeEdge) {
          const t = (minNodeEdge - dist) / minNodeEdge
          cost += W.nodeEdge * t * t * 7
        }
      }
    }
    return cost
  }

  // Big networks get a cheaper candidate set so a redraw still feels instant.
  const thorough = n <= 150
  const order = Array.from({ length: n }, (_, i) => i)

  for (let iter = 0; iter < iterations; iter++) {
    rebuildIndex()
    // shrink the search radius as the layout settles
    const t = iter / Math.max(1, iterations - 1)
    const radii = thorough
      ? [edgeLength * (0.9 - 0.6 * t), edgeLength * (0.45 - 0.3 * t), edgeLength * 0.12]
      : [edgeLength * (0.8 - 0.55 * t), edgeLength * 0.14]

    for (let s = order.length - 1; s > 0; s--) {
      const j = Math.floor(rng() * (s + 1))
      ;[order[s], order[j]] = [order[j], order[s]]
    }

    let moved = 0
    for (const i of order) {
      if (fixed[i]) continue
      let bestX = xs[i]
      let bestY = ys[i]
      let bestCost = nodeCost(i, xs[i], ys[i])
      const startCost = bestCost

      for (const d of dirs) {
        for (const r of radii) {
          const cx = xs[i] + d.dx * r
          const cy = ys[i] + d.dy * r
          const c = nodeCost(i, cx, cy)
          if (c < bestCost - 1e-9) {
            bestCost = c
            bestX = cx
            bestY = cy
          }
        }
      }

      // snap candidates: place the node exactly on an allowed bearing from one
      // of its neighbours — either at the ideal edge length or at the distance
      // it already has, which lets an edge straighten without stretching
      for (const { other } of incident[i]) {
        const current = Math.hypot(xs[i] - xs[other], ys[i] - ys[other])
        for (const dist of thorough ? [ideal, current, (ideal + current) / 2] : [current, ideal]) {
          for (const d of dirs) {
            const cx = xs[other] + d.dx * dist
            const cy = ys[other] + d.dy * dist
            const c = nodeCost(i, cx, cy)
            if (c < bestCost - 1e-9) {
              bestCost = c
              bestX = cx
              bestY = cy
            }
          }
        }
      }

      if (bestCost < startCost - 1e-9) {
        xs[i] = bestX
        ys[i] = bestY
        moved += 1
      }
    }

    yield { iteration: iter + 1, iterations, moved }
    if (moved === 0 && iter > 4) break
  }

  return finalise(graph, xs, ys)
}

function finalise(graph, xs, ys) {
  const n = graph.nodes.length
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, xs[i])
    maxX = Math.max(maxX, xs[i])
    minY = Math.min(minY, ys[i])
    maxY = Math.max(maxY, ys[i])
  }
  const positions = new Map()
  for (let i = 0; i < n; i++) {
    positions.set(graph.nodes[i].stopId, { x: xs[i], y: ys[i] })
  }
  return {
    positions,
    bounds: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY },
  }
}

export function runLayout(graph, options) {
  const it = layoutIterator(graph, options)
  let step = it.next()
  while (!step.done) step = it.next()
  return step.value
}
