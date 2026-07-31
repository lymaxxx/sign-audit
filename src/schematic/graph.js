// Turns the project (stops + route stop-sequences) into the graph the
// schematic layout and renderer work with.

import { projector } from '../lib/geo.js'
import { displayStopName } from '../state/project.js'

export function edgeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`
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
    return { nodes: [], edges: [], adj: [], triples: [], index: new Map(), empty: true }
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

  const addEdge = (a, b, routeId, dirKey) => {
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
    e.uses.push({ routeId, dirKey, forward: a === e.u })
    if (!e.routeIds.includes(routeId)) e.routeIds.push(routeId)
  }

  const triples = []
  for (const route of project.routes) {
    if (route.visible === false) continue
    for (const dirKey of ['fwd', 'bwd']) {
      const dir = route.dirs[dirKey]
      if (!dir || dir.stopIds.length < 2) continue
      const seq = dir.stopIds.map((id) => index.get(id)).filter((v) => v !== undefined)
      for (let k = 0; k < seq.length; k++) {
        const n = nodes[seq[k]]
        if (!n.routeIds.includes(route.id)) n.routeIds.push(route.id)
      }
      for (let k = 1; k < seq.length; k++) addEdge(seq[k - 1], seq[k], route.id, dirKey)
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

  return { nodes, edges, adj, triples, index, empty: edges.length === 0 }
}

// Ordered route slots for an edge, so parallel lines keep a consistent side.
export function edgeRouteOrder(edge, routeOrder) {
  return edge.routeIds.slice().sort((a, b) => (routeOrder.get(a) ?? 0) - (routeOrder.get(b) ?? 0))
}

// True when a route traverses this edge in one direction only — those sections
// get direction arrows in the schematic.
//
// A route that has only been drawn one way is not "one-way": it simply has no
// return leg yet, and the line is understood to work both ways. Only routes
// with both directions defined can have genuinely one-directional sections,
// and only where the two stop sequences actually differ. Taking a different
// road between the same pair of stops does not count — the schematic cares
// about the stops, not the tarmac.
export function edgeDirectionality(edge, routeId, hasBothDirections) {
  const uses = edge.uses.filter((u) => u.routeId === routeId)
  if (!uses.length) return null
  if (!hasBothDirections) return 'both'
  const usedBy = new Set(uses.map((u) => u.dirKey))
  if (usedBy.size > 1) return 'both'
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
