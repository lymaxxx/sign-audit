// Schematic (metro-map style) layout.
//
// A hill-climbing optimiser in the spirit of Stott & Rodgers' metro map
// algorithm: start from the real geography, then repeatedly nudge stations to
// nearby candidate positions, keeping a move whenever it lowers a weighted cost
// made of octilinearity (or whatever angle increment is configured), even edge
// lengths, line straightness, node/edge separation and relative-position
// preservation.

import { distToSegment2, segmentsIntersect } from '../lib/geo.js'
import { edgeKey } from './graph.js'

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

// Fraction of the run that still accepts uphill moves; after this it's pure
// descent so the result actually settles.
const ANNEAL_FRACTION = 0.45

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

export function deviationFromAllowed(deg, angleStep) {
  const step = 360 / Math.max(2, Math.round(360 / angleStep))
  const k = Math.round(deg / step)
  return angDiff(deg, k * step)
}

// How "clean" a finished layout is: fewer crossings and closer-to-grid
// bearings are both better. Used to pick the best of several random-seed
// attempts (see runBestLayout) — crossings dominate since a stray crossing is
// the single ugliest thing a metro map can have.
export function scoreLayout(graph, positions, angleStep) {
  const P = graph.nodes.map((n) => positions.get(n.stopId))
  let crossings = 0
  const edges = graph.edges
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i]
    for (let j = i + 1; j < edges.length; j++) {
      const b = edges[j]
      if (a.u === b.u || a.u === b.v || a.v === b.u || a.v === b.v) continue
      if (
        segmentsIntersect(
          [P[a.u].x, P[a.u].y],
          [P[a.v].x, P[a.v].y],
          [P[b.u].x, P[b.u].y],
          [P[b.v].x, P[b.v].y],
        )
      ) {
        crossings += 1
      }
    }
  }
  let devSum = 0
  for (const e of edges) {
    const deg = Math.atan2(P[e.v].y - P[e.u].y, P[e.v].x - P[e.u].x) * DEG
    const dev = deviationFromAllowed(deg, angleStep)
    devSum += dev * dev
  }
  return { crossings, devSum, total: crossings * 1e5 + devSum }
}

export function* layoutIterator(graph, options = {}) {
  const {
    angleStep = 45,
    iterations = 40,
    edgeLength = 92,
    strictness = 1,
    fidelity = 0.5,
    seed = 1,
    overrides = {},
    contract = true,
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
  // A contracted chain edge stands in for a whole run of stops, so it needs
  // room for all of them; every other edge just wants `edgeLength`.
  const idealOf = (e) => e.idealLength || edgeLength
  const lengths = graph.edges.map((e) =>
    Math.hypot(nodes[e.u].gx - nodes[e.v].gx, nodes[e.u].gy - nodes[e.v].gy),
  )
  const midOf = (arr) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)] || 1
  const median = midOf(lengths)
  const scale = midOf(graph.edges.map(idealOf)) / Math.max(1e-6, median)
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
    length: 4,
    // a coarse angle grid needs more freedom to move away from true bearings
    relative: fidelity * Math.min(1, 45 / angleStep),
    // Straightness has to be able to outweigh the angle grid, not sit 20x
    // below it. With the old weights every edge could satisfy the grid on its
    // own while the line as a whole zigzagged through a corner at practically
    // every station, which is the opposite of how a transit diagram reads.
    straight: 7,
    // ...and a bend is a bend: this flat charge is what actually minimises the
    // *number* of corners, while `straight` above picks the gentler of two
    // that can't be avoided.
    bend: 2.4,
    // Using fewer distinct bearings reads as tidier, and cardinals read
    // cleaner than diagonals, so break ties toward horizontal/vertical.
    diagonal: 0.4,
    nodeNode: 3.2,
    nodeEdge: 2.2,
    // A stray crossing is the single ugliest thing a metro map can have, so it
    // must never be worth buying to straighten one edge.
    crossing: 24,
  }
  const bendThreshold = 0.03 // ~5 degrees off straight before it counts as a corner

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
    // nearest grid bearing this edge is heading for — diagonals cost a touch
    // more than cardinals so the finished map uses fewer distinct directions
    const step = 360 / Math.max(2, Math.round(360 / angleStep))
    if (Math.abs(((Math.round(deg / step) * step) % 90) % 90) > 1e-6) cost += W.diagonal

    const r = len / idealOf(edge)
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
      if (turn > bendThreshold) cost += W.bend
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

  // --- phase 1: place the skeleton (junctions and termini only)
  //
  // Solving every stop at once means a long run of pass-through stops drags
  // its own junctions around, and the run ends up wandering off the angle
  // grid. Placing the skeleton first — with each run collapsed to one edge
  // that knows how long it has to be — leaves the chains free to be laid out
  // straight and on-grid afterwards.
  let skeletonSolved = false
  if (contract) {
    const contracted = contractGraph(graph, fixed, edgeLength)
    if (contracted) {
      const inner = layoutIterator(contracted.graph, {
        ...options,
        contract: false,
        iterations: Math.max(14, Math.round(iterations * 0.9)),
      })
      let step = inner.next()
      while (!step.done) {
        yield { ...step.value, phase: 'skeleton' }
        step = inner.next()
      }
      const skeleton = step.value.positions
      contracted.graph.nodes.forEach((node, j) => {
        const orig = contracted.fromAnchor[j]
        if (fixed[orig]) return
        const p = skeleton.get(node.stopId)
        if (!p) return
        xs[orig] = p.x
        ys[orig] = p.y
      })
      // Seed each run straight between its (now placed) anchors so the
      // full-graph pass below starts from something sane.
      for (const chain of findChains(graph, fixed)) {
        const a = chain[0]
        const z = chain[chain.length - 1]
        for (let k = 1; k < chain.length - 1; k++) {
          const t = k / (chain.length - 1)
          xs[chain[k]] = xs[a] + (xs[z] - xs[a]) * t
          ys[chain[k]] = ys[a] + (ys[z] - ys[a]) * t
        }
      }
      placeChains(graph, xs, ys, fixed, edgeLength, angleStep)
      contracted.done = true
    }
    skeletonSolved = !!contracted?.done
  }

  // --- phase 2: polish every stop, mostly to resolve collisions
  // Big networks get a cheaper candidate set so a redraw still feels instant.
  const thorough = n <= 150
  const order = Array.from({ length: n }, (_, i) => i)
  // With the skeleton already solved and the runs laid on it, this pass is
  // only here to resolve collisions — it doesn't need the full budget, and
  // spending it would just pull stops back off the grid.
  const polishIterations = skeletonSolved ? Math.max(6, Math.round(iterations * 0.35)) : iterations

  for (let iter = 0; iter < polishIterations; iter++) {
    rebuildIndex()
    // shrink the search radius as the layout settles
    const t = iter / Math.max(1, polishIterations - 1)
    const radii = thorough
      ? [edgeLength * (0.9 - 0.6 * t), edgeLength * (0.45 - 0.3 * t), edgeLength * 0.12]
      : [edgeLength * (0.8 - 0.55 * t), edgeLength * 0.14]

    for (let s = order.length - 1; s > 0; s--) {
      const j = Math.floor(rng() * (s + 1))
      ;[order[s], order[j]] = [order[j], order[s]]
    }

    // Pure descent settles into the first local optimum it finds and then
    // can't improve at all (measurably: it stops moving around iteration 25
    // and 150 iterations are no better than 40). Accepting the occasional
    // uphill move early on lets it climb back out of the mediocre optima that
    // leave a needless zigzag beside an otherwise clean run.
    const temperature = Math.max(0, 1.5 * (1 - t / ANNEAL_FRACTION))

    let moved = 0
    for (const i of order) {
      if (fixed[i]) continue
      const startCost = nodeCost(i, xs[i], ys[i])
      let bestX = xs[i]
      let bestY = ys[i]
      let bestCost = Infinity

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

      const uphill = bestCost - startCost
      const accept =
        uphill < -1e-9 ||
        (temperature > 0 && uphill < temperature * 4 && rng() < Math.exp(-uphill / temperature))
      if (accept && Number.isFinite(bestCost)) {
        xs[i] = bestX
        ys[i] = bestY
        moved += 1
      }
    }

    yield { iteration: iter + 1, iterations: polishIterations, moved }
    if (moved === 0 && iter > 4) break
  }

  placeChains(graph, xs, ys, fixed, edgeLength, angleStep)
  snapNearAlignedAxes(xs, ys, fixed, edgeLength * 0.05)

  return finalise(graph, xs, ys)
}

// A node with exactly two incident edges that both carry the same set of
// routes is a genuine pass-through — nobody changes there, so nothing else in
// the network has a reason to care about its exact position, only that it sits
// on the line in the right order. On a real import most stops are like this
// (43 of 57 on the test network), and leaving each of them to the per-station
// hill-climb is what makes the diagram look hand-drawn: each edge satisfies
// the angle grid on its own while the run as a whole wanders, so ~40% of edges
// end up off-grid.
//
// So the run is placed as a whole instead: find the maximal chains, route each
// one from anchor to anchor along *at most one bend*, both legs on the angle
// grid, and space the stops evenly along it. That is what a metro map actually
// looks like — long straight runs, occasional deliberate corners — and it
// makes every interior stop exactly on-grid and evenly spaced by construction.
export function findChains(graph, fixed) {
  const n = graph.nodes.length
  const adj = graph.adj

  const sameRouteSet = (a, b) => {
    if (a.length !== b.length) return false
    const set = new Set(a)
    return b.every((r) => set.has(r))
  }
  const isPassThrough = (i) => {
    if (fixed[i]) return false
    const inc = adj[i]
    return inc.length === 2 && sameRouteSet(inc[0].edge.routeIds, inc[1].edge.routeIds)
  }

  // Walks from `start` away from `cameFrom`, returning [start, ..., boundary]
  // (the boundary node itself, whatever stopped the walk, is included).
  const walk = (start, cameFrom) => {
    const path = [start]
    const seen = new Set([cameFrom, start])
    let prev = cameFrom
    let cur = start
    while (isPassThrough(cur)) {
      const inc = adj[cur]
      const next = inc[0].other === prev ? inc[1].other : inc[0].other
      if (seen.has(next)) break // closed loop guard
      seen.add(next)
      path.push(next)
      prev = cur
      cur = next
    }
    return path
  }

  const chains = []
  const visited = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (visited[i] || !isPassThrough(i)) continue
    const inc = adj[i]
    const sideA = walk(inc[0].other, i)
    const sideB = walk(inc[1].other, i)
    const chain = [...sideA.slice().reverse(), i, ...sideB]
    for (const idx of chain) if (isPassThrough(idx)) visited[idx] = 1
    if (chain.length < 3) continue
    if (chain[0] === chain[chain.length - 1]) continue // a loop back to itself
    chains.push(chain)
  }
  return chains
}

// Every way of getting from A to Z using at most one turn, with both legs on
// the angle grid. Returns polylines (2 or 3 points).
function gridPaths(ax, ay, zx, zy, dirs, angleStep) {
  const out = []
  const bx = zx - ax
  const by = zy - ay
  const direct = Math.hypot(bx, by)
  if (direct < 1e-6) return out

  const straightDev = deviationFromAllowed(Math.atan2(by, bx) * DEG, angleStep)
  out.push({
    points: [
      { x: ax, y: ay },
      { x: zx, y: zy },
    ],
    bends: 0,
    // A straight run that isn't quite on the grid is still hugely preferable
    // to a detour, so this is a cost rather than a disqualification.
    gridPenalty: (straightDev / (angleStep / 2)) ** 2,
    length: direct,
  })

  for (const d1 of dirs) {
    for (const d2 of dirs) {
      const det = d1.dx * d2.dy - d2.dx * d1.dy
      if (Math.abs(det) < 1e-9) continue
      const t1 = (bx * d2.dy - d2.dx * by) / det
      const t2 = (d1.dx * by - bx * d1.dy) / det
      if (t1 < 1e-6 || t2 < 1e-6) continue
      out.push({
        points: [
          { x: ax, y: ay },
          { x: ax + d1.dx * t1, y: ay + d1.dy * t1 },
          { x: zx, y: zy },
        ],
        bends: 1,
        gridPenalty: 0,
        length: t1 + t2,
        turn: angDiff(d1.deg, d2.deg),
      })
    }
  }
  return out
}

function polylineLength(points) {
  let len = 0
  for (let k = 1; k < points.length; k++) {
    len += Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y)
  }
  return len
}

// Evenly spaces `count` points along a polyline, endpoints included.
function distributeAlong(points, count) {
  const segs = []
  let total = 0
  for (let k = 1; k < points.length; k++) {
    const len = Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y)
    segs.push({ a: points[k - 1], b: points[k], len })
    total += len
  }
  const out = []
  for (let i = 0; i < count; i++) {
    let want = (total * i) / (count - 1)
    let s = 0
    while (s < segs.length - 1 && want > segs[s].len) {
      want -= segs[s].len
      s += 1
    }
    const seg = segs[s]
    const t = seg.len < 1e-9 ? 0 : Math.min(1, want / seg.len)
    out.push({ x: seg.a.x + (seg.b.x - seg.a.x) * t, y: seg.a.y + (seg.b.y - seg.a.y) * t })
  }
  return out
}

// Collapses every chain into a single edge between its two anchors, so the
// solver can place the junctions and termini — the only stops whose position
// carries information — without 40-odd pass-through stops each pulling their
// own way. Solving the skeleton first is what lets the chains come out
// straight and on-grid afterwards: the anchors are positioned knowing how long
// each run needs to be, instead of being dragged wherever the interior stops
// happened to settle.
export function contractGraph(graph, fixed, edgeLength) {
  const chains = findChains(graph, fixed)
  const interior = new Set()
  for (const c of chains) for (let k = 1; k < c.length - 1; k++) interior.add(c[k])
  if (!interior.size) return null

  const toAnchor = new Map()
  const fromAnchor = []
  graph.nodes.forEach((_, i) => {
    if (interior.has(i)) return
    toAnchor.set(i, fromAnchor.length)
    fromAnchor.push(i)
  })
  if (fromAnchor.length < 3) return null

  const nodes = fromAnchor.map((orig, i) => ({ ...graph.nodes[orig], i }))
  const edges = []
  const edgeIndex = new Map()
  const adj = nodes.map(() => [])
  const add = (a, b, idealLength, routeIds) => {
    if (a === b) return
    const key = edgeKey(a, b)
    let e = edgeIndex.get(key)
    if (!e) {
      e = {
        key,
        u: Math.min(a, b),
        v: Math.max(a, b),
        uses: [],
        routeIds: routeIds.slice(),
        idealLength,
      }
      edgeIndex.set(key, e)
      edges.push(e)
      adj[a].push({ edge: e, other: b })
      adj[b].push({ edge: e, other: a })
      return
    }
    // Two runs between the same pair of junctions collapse to one edge here;
    // the longer one sets the length so neither ends up cramped.
    e.idealLength = Math.max(e.idealLength, idealLength)
  }

  // Which anchor you reach by leaving anchor q toward its neighbour p.
  const beyond = new Map()
  for (const c of chains) {
    const a = c[0]
    const z = c[c.length - 1]
    beyond.set(`${a}|${c[1]}`, z)
    beyond.set(`${z}|${c[c.length - 2]}`, a)
    add(toAnchor.get(a), toAnchor.get(z), (c.length - 1) * edgeLength, c[1] !== undefined ? graph.adj[a][0].edge.routeIds : [])
  }
  for (const e of graph.edges) {
    if (interior.has(e.u) || interior.has(e.v)) continue
    add(toAnchor.get(e.u), toAnchor.get(e.v), edgeLength, e.routeIds)
  }

  // A line running straight through a junction should still read straight, so
  // the original straightness targets are remapped onto the skeleton.
  const reach = (from, via) => {
    if (!interior.has(via)) return toAnchor.get(via)
    const far = beyond.get(`${from}|${via}`)
    return far === undefined ? undefined : toAnchor.get(far)
  }
  const triples = []
  const seen = new Set()
  for (const [p, q, r] of graph.triples) {
    if (interior.has(q)) continue
    const P = reach(q, p)
    const R = reach(q, r)
    const Q = toAnchor.get(q)
    if (P === undefined || R === undefined || P === R) continue
    const key = `${P}|${Q}|${R}`
    if (seen.has(key)) continue
    seen.add(key)
    triples.push([P, Q, R])
  }

  return { graph: { nodes, edges, adj, triples, index: new Map(), empty: false }, fromAnchor }
}

export function placeChains(graph, xs, ys, fixed, edgeLength, angleStep) {
  const dirs = allowedDirections(angleStep)
  for (const chain of findChains(graph, fixed)) {
    const A = chain[0]
    const Z = chain[chain.length - 1]
    const interior = chain.length - 2

    let originalLen = 0
    for (let k = 1; k < chain.length; k++) {
      originalLen += Math.hypot(xs[chain[k]] - xs[chain[k - 1]], ys[chain[k]] - ys[chain[k - 1]])
    }
    const direct = Math.hypot(xs[Z] - xs[A], ys[Z] - ys[A])
    if (direct < 1e-6) continue

    let best = null
    for (const cand of gridPaths(xs[A], ys[A], xs[Z], ys[Z], dirs, angleStep)) {
      // Being on the grid is the whole point, so it dominates: a run that has
      // to turn a corner to get there is still far better than a straight one
      // heading off at 23 degrees. The solver placed the anchors without
      // caring about the grid, so a chain between them usually *has* to bend,
      // which makes a modest detour the normal price rather than a failure.
      let cost = cand.gridPenalty * 25 + (cand.length / direct - 1) * 3 + cand.bends * 0.8
      // prefer gentle corners over hairpins
      if (cand.turn !== undefined) cost += ((180 - cand.turn) / 180) ** 2 * 3
      // stay near the shape the solver arrived at, so stop order still reads
      // the way the geography implies
      const placed = distributeAlong(cand.points, chain.length)
      let drift = 0
      for (let k = 1; k < chain.length - 1; k++) {
        drift += Math.hypot(placed[k].x - xs[chain[k]], placed[k].y - ys[chain[k]])
      }
      cost += (drift / Math.max(1, interior) / edgeLength) * 1.5
      // and keep the stops from bunching up
      cost += Math.abs(polylineLength(cand.points) / Math.max(1, chain.length - 1) / edgeLength - 1)
      if (best && cost >= best.cost) continue
      if (!chainPlacementIsSafe(graph, xs, ys, chain, placed, edgeLength)) continue
      best = { cost, placed }
    }
    if (!best) continue
    // Only ever worth doing if it isn't a big detour on what we had.
    if (polylineLength(best.placed) > originalLen * 1.35) continue

    for (let k = 1; k < chain.length - 1; k++) {
      xs[chain[k]] = best.placed[k].x
      ys[chain[k]] = best.placed[k].y
    }
  }
}

function chainPlacementIsSafe(graph, xs, ys, chain, newPos, edgeLength) {
  const chainSet = new Set(chain)
  const minDist = edgeLength * 0.7
  for (let k = 1; k < chain.length - 1; k++) {
    const p = newPos[k]
    for (let j = 0; j < xs.length; j++) {
      if (chainSet.has(j)) continue
      if (Math.hypot(xs[j] - p.x, ys[j] - p.y) < minDist) return false
    }
  }
  for (let k = 1; k < newPos.length; k++) {
    const a = newPos[k - 1]
    const b = newPos[k]
    for (const edge of graph.edges) {
      if (chainSet.has(edge.u) && chainSet.has(edge.v)) continue
      if (
        segmentsIntersect([a.x, a.y], [b.x, b.y], [xs[edge.u], ys[edge.u]], [xs[edge.v], ys[edge.v]])
      ) {
        return false
      }
    }
  }
  return true
}

// Stations the solver placed almost-but-not-quite on the same row or column
// (a fraction of a pixel apart, from floating point drift or two independent
// local optima) are pulled onto that shared line. This is what gives the
// finished map its rhythm — real transit diagrams line stations up along
// shared rows/columns far more often than a per-station optimum would. Pinned
// (manually dragged) stations are never moved, only ever snapped *toward*.
function snapNearAlignedAxes(xs, ys, fixed, epsilon) {
  const n = xs.length
  const movable = []
  for (let i = 0; i < n; i++) if (!fixed[i]) movable.push(i)

  const snapAxis = (arr) => {
    const idx = movable.slice().sort((a, b) => arr[a] - arr[b])
    let start = 0
    for (let i = 1; i <= idx.length; i++) {
      if (i === idx.length || arr[idx[i]] - arr[idx[start]] > epsilon) {
        if (i - start > 1) {
          let sum = 0
          for (let k = start; k < i; k++) sum += arr[idx[k]]
          const avg = sum / (i - start)
          for (let k = start; k < i; k++) arr[idx[k]] = avg
        }
        start = i
      }
    }
  }
  snapAxis(xs)
  snapAxis(ys)
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

// Runs the solver from a few different random shuffles and keeps the one
// with the fewest line crossings (ties broken by angle cleanliness) — a
// single hill-climb can get stuck in a mediocre local optimum, and trying a
// handful more nearly always finds a tidier layout without the user having
// to click "New variation" by hand. Capped to small/medium networks so a big
// import still redraws in about the same time as before.
export function* bestLayoutIterator(graph, options = {}) {
  const { seed = 1, angleStep = 45 } = options
  const n = graph.nodes.length
  const seeds = n > 0 && n <= 150 ? [seed, seed + 7919, seed + 15551] : [seed]
  let best = null

  for (let a = 0; a < seeds.length; a++) {
    const it = layoutIterator(graph, { ...options, seed: seeds[a] })
    let step = it.next()
    while (!step.done) {
      yield {
        attempt: a + 1,
        attempts: seeds.length,
        iteration: step.value.iteration,
        iterations: step.value.iterations,
      }
      step = it.next()
    }
    const result = step.value
    if (!result.positions.size) return result
    const score = scoreLayout(graph, result.positions, angleStep)
    if (!best || score.total < best.score.total) best = { ...result, score }
  }
  return best
}
