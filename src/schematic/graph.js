// Turns the project (stops + route stop-sequences) into the graph the
// schematic layout and renderer work with.

import { projector } from '../lib/geo.js'
import { displayStopName } from '../state/project.js'

export function edgeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

// Longest common subsequence, returned as aligned index pairs.
function lcsPairs(a, b) {
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const pairs = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++
    } else {
      j++
    }
  }
  return pairs
}

// Folds a route's two directions into a single corridor wherever they run the
// same way, so the diagram shows one bidirectional line rather than two.
//
// The two sequences are aligned (after reversing the return one, so both read
// along the corridor). Between each pair of aligned stops there are two runs:
//
//   - one of them empty — the other direction simply doesn't stop there. Those
//     stops stay on the shared corridor and are marked as served one way only;
//     the vehicle still drives past in both directions, so no shortcut edge is
//     created and the line never splits. This is the common case: a stop
//     served outbound only, or a pair of one-way kerbs.
//   - both non-empty — a genuine divergence (a one-way loop through different
//     stops). Only these become separate one-way branches with arrows.
//
// Returns `corridor` as a list of runs (it breaks wherever a divergence takes
// over, so the two anchors of a divergence never get a phantom direct edge
// that nothing actually travels), `branches`, and a per-stop service map. All
// runs are in travel order.
export function mergeRouteDirections(fwdIds, bwdIds) {
  const F = (fwdIds || []).filter((id, i, a) => i === 0 || id !== a[i - 1])
  const rawB = (bwdIds || []).filter((id, i, a) => i === 0 || id !== a[i - 1])
  const serves = new Map()
  const setServes = (id, value) => {
    // "both" always wins: a stop that any run serves in both directions
    // shouldn't be flagged one-way because some other run only touches it once.
    if (value === 'both' || !serves.has(id)) serves.set(id, value)
  }

  if (F.length < 2 || rawB.length < 2) {
    const only = F.length >= 2 ? F : rawB
    for (const id of only) setServes(id, 'both')
    return { corridor: only.length ? [only.slice()] : [], branches: [], serves }
  }

  const B = rawB.slice().reverse()
  const pairs = lcsPairs(F, B)
  if (!pairs.length) {
    // The two directions share no stops at all — nothing to merge.
    for (const id of F) setServes(id, 'fwd')
    for (const id of rawB) setServes(id, 'bwd')
    return {
      corridor: [],
      branches: [
        { dirKey: 'fwd', stopIds: F },
        { dirKey: 'bwd', stopIds: rawB },
      ],
      serves,
    }
  }

  const corridor = []
  const branches = []
  let run = []
  const pushCorridor = (id, value) => {
    setServes(id, value)
    if (run[run.length - 1] === id) return
    run.push(id)
  }
  // A divergence carries the line between its anchors, so the corridor stops
  // at the anchor before it and resumes at the anchor after it.
  const breakCorridor = () => {
    if (run.length) corridor.push(run)
    run = []
  }

  let fi = 0
  let bi = 0
  for (let k = 0; k <= pairs.length; k++) {
    const last = k === pairs.length
    const fEnd = last ? F.length : pairs[k][0]
    const bEnd = last ? B.length : pairs[k][1]
    const gapF = F.slice(fi, fEnd)
    const gapB = B.slice(bi, bEnd)

    if (gapF.length && gapB.length) {
      const before = k === 0 ? null : F[pairs[k - 1][0]]
      const after = last ? null : F[fEnd]
      const wrap = (r) => [...(before ? [before] : []), ...r, ...(after ? [after] : [])]
      for (const id of gapF) setServes(id, 'fwd')
      for (const id of gapB) setServes(id, 'bwd')
      branches.push({ dirKey: 'fwd', stopIds: wrap(gapF) })
      // Branch runs are stored in travel order so arrows point the right way;
      // the return branch was reversed for alignment, so undo that here.
      branches.push({ dirKey: 'bwd', stopIds: wrap(gapB).reverse() })
      breakCorridor()
    } else {
      for (const id of gapF) pushCorridor(id, 'fwd')
      for (const id of gapB) pushCorridor(id, 'bwd')
    }

    if (!last) {
      pushCorridor(F[fEnd], 'both')
      fi = fEnd + 1
      bi = bEnd + 1
    }
  }
  breakCorridor()

  return { corridor: corridor.filter((r) => r.length > 1), branches, serves }
}

export function buildNetworkGraph(project) {
  const usedStopIds = new Set()
  for (const route of project.routes) {
    if (route.visible === false) continue
    for (const dirKey of ['fwd', 'bwd']) {
      const dir = route.dirs[dirKey]
      if (!dir) continue
      for (const id of dir.stopIds) usedStopIds.add(id)
    }
  }

  const stops = project.stops.filter((s) => usedStopIds.has(s.id))
  if (!stops.length) {
    return {
      nodes: [],
      edges: [],
      adj: [],
      triples: [],
      index: new Map(),
      corridors: new Map(),
      empty: true,
    }
  }

  const refLat = stops.reduce((sum, s) => sum + s.lat, 0) / stops.length
  const proj = projector(refLat)

  const index = new Map()
  const nodes = stops.map((stop, i) => {
    index.set(stop.id, i)
    const [x, y] = proj.forward([stop.lat, stop.lon])
    return {
      i,
      stopId: stop.id,
      name: displayStopName(stop),
      linked: (stop.altNames || []).length > 0,
      kind: stop.kind,
      gx: x,
      gy: -y, // screen space: y grows downwards
      x: x,
      y: -y,
      routeIds: [],
      degree: 0,
    }
  })

  const edges = []
  const edgeIndex = new Map()
  const adj = nodes.map(() => [])

  const addEdge = (a, b, routeId, dirKey, oneWay) => {
    if (a === b) return
    const key = edgeKey(a, b)
    let e = edgeIndex.get(key)
    if (!e) {
      e = { key, u: Math.min(a, b), v: Math.max(a, b), uses: [], routeIds: [] }
      edgeIndex.set(key, e)
      edges.push(e)
      adj[a].push({ edge: e, other: b })
      adj[b].push({ edge: e, other: a })
    }
    e.uses.push({ routeId, dirKey, oneWay, forward: a === e.u })
    if (!e.routeIds.includes(routeId)) e.routeIds.push(routeId)
  }

  const triples = []
  const corridors = new Map()
  for (const route of project.routes) {
    if (route.visible === false) continue
    // Both directions collapse into one corridor wherever they run together,
    // so a stop that only one direction calls at no longer splits the line
    // into two (and no longer creates the shortcut edge that skipping it
    // would otherwise imply).
    const merged = mergeRouteDirections(route.dirs.fwd?.stopIds, route.dirs.bwd?.stopIds)
    corridors.set(route.id, merged)

    const runs = [
      ...merged.corridor.map((stopIds) => ({ stopIds, dirKey: 'fwd', oneWay: false })),
      ...merged.branches.map((b) => ({ ...b, oneWay: true })),
    ]
    for (const run of runs) {
      const seq = run.stopIds.map((id) => index.get(id)).filter((v) => v !== undefined)
      if (seq.length < 2) continue
      for (let k = 0; k < seq.length; k++) {
        const n = nodes[seq[k]]
        if (!n.routeIds.includes(route.id)) n.routeIds.push(route.id)
      }
      for (let k = 1; k < seq.length; k++) {
        addEdge(seq[k - 1], seq[k], route.id, run.dirKey, run.oneWay)
      }
      // Straightness targets: a line should run through a stop, not kink at it.
      for (let k = 1; k < seq.length - 1; k++) {
        if (seq[k - 1] === seq[k] || seq[k] === seq[k + 1]) continue
        triples.push([seq[k - 1], seq[k], seq[k + 1]])
      }
    }
  }

  for (let i = 0; i < nodes.length; i++) {
    nodes[i].degree = adj[i].length
    nodes[i].isInterchange = nodes[i].routeIds.length > 1
  }

  return { nodes, edges, adj, triples, index, corridors, empty: edges.length === 0 }
}

// Ordered route slots for an edge, so parallel lines keep a consistent side.
export function edgeRouteOrder(edge, routeOrder) {
  return edge.routeIds.slice().sort((a, b) => (routeOrder.get(a) ?? 0) - (routeOrder.get(b) ?? 0))
}

// True when a route traverses this edge in one direction only — those sections
// get direction arrows in the schematic.
//
// The work of deciding this is done by mergeRouteDirections above, which only
// emits a one-way branch for a genuine divergence: the two directions running
// through *different stops* between the same pair of anchors. A route drawn
// one way only isn't one-way (it just has no return leg yet), taking a
// different road between the same stops isn't one-way (the schematic cares
// about stops, not tarmac), and a stop that only one direction calls at isn't
// one-way either — that's a property of the stop, shown by an arrow on the
// marker rather than by splitting the line.
export function edgeDirectionality(edge, routeId) {
  const uses = edge.uses.filter((u) => u.routeId === routeId)
  if (!uses.length) return null
  if (uses.some((u) => !u.oneWay)) return 'both'
  const forward = uses.some((u) => u.forward)
  const backward = uses.some((u) => !u.forward)
  if (forward && backward) return 'both'
  return forward ? 'forward' : 'backward'
}

// Routes that have a return direction with enough stops to be meaningful.
export function routesWithBothDirections(project) {
  const set = new Set()
  for (const route of project.routes) {
    const fwd = route.dirs.fwd
    const bwd = route.dirs.bwd
    if (fwd?.stopIds.length >= 2 && bwd?.stopIds.length >= 2) set.add(route.id)
  }
  return set
}
