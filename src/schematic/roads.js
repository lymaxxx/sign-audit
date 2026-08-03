// The background street layer for the schematic view.
//
// These are the *real* streets — fetched from OSM with their names and actual
// geometry — but warped into diagram space so they follow the schematic rather
// than the map. Both halves of that matter. A backdrop drawn straight from
// geography wouldn't line up with a diagram that has deliberately moved every
// stop; a backdrop invented from the diagram alone (as the first version did,
// using a proximity mesh between stops) is just straight lines between stops,
// which says nothing about the street pattern.
//
// The warp is anchored on the stops, the one thing that exists in both spaces:
// each has a projected geographic position and a schematic position. Fit a
// similarity transform to those pairs, then bend whatever that couldn't
// explain by an inverse-distance blend of the leftover error at nearby stops.
// A street then bends where the diagram bends near it and keeps its own shape
// in between — recognisably the real road, simplified and distorted.

import { simplifyPolyline } from './geometry.js'

export const STREETS_MAX_VERTICES = 14000

// How many nearby stops contribute to a vertex's local correction. Enough to
// blend smoothly, few enough that a street stays local to what's around it.
const NEIGHBOURS = 8

// Best-fit scale + rotation + translation taking one point set onto another
// (Procrustes / Kabsch in 2D, closed form). This absorbs the bulk of the
// difference between geography and diagram — including the layout's own
// arbitrary scale — so the residuals left for the warp stay small and local.
export function fitSimilarity(from, to) {
  const n = Math.min(from.length, to.length)
  if (!n) return null
  let fx = 0
  let fy = 0
  let tx = 0
  let ty = 0
  for (let i = 0; i < n; i++) {
    fx += from[i].x
    fy += from[i].y
    tx += to[i].x
    ty += to[i].y
  }
  fx /= n
  fy /= n
  tx /= n
  ty /= n

  let dot = 0
  let cross = 0
  let normFrom = 0
  for (let i = 0; i < n; i++) {
    const ax = from[i].x - fx
    const ay = from[i].y - fy
    const bx = to[i].x - tx
    const by = to[i].y - ty
    dot += ax * bx + ay * by
    cross += ax * by - ay * bx
    normFrom += ax * ax + ay * ay
  }
  if (normFrom < 1e-9) return null
  // a and b are scale*cos and scale*sin of the fitted rotation
  const a = dot / normFrom
  const b = cross / normFrom
  return (p) => ({
    x: tx + a * (p.x - fx) - b * (p.y - fy),
    y: ty + b * (p.x - fx) + a * (p.y - fy),
  })
}

// Builds the geo -> diagram mapping from the stops. Null when there aren't
// enough of them to pin anything down.
export function buildWarp(graph, positions) {
  const geo = []
  const dia = []
  for (const node of graph.nodes) {
    const p = positions.get(node.stopId)
    if (!p) continue
    geo.push({ x: node.gx, y: node.gy })
    dia.push(p)
  }
  if (geo.length < 3) return null

  const similarity = fitSimilarity(geo, dia)
  if (!similarity) return null

  // What the similarity alone couldn't account for, at each stop.
  const anchors = geo.map((g, i) => {
    const s = similarity(g)
    return { x: s.x, y: s.y, rx: dia[i].x - s.x, ry: dia[i].y - s.y }
  })

  // Keeps the weights well-conditioned when a vertex lands on top of a stop.
  let spread = 0
  for (const a of anchors) spread += Math.hypot(a.x - anchors[0].x, a.y - anchors[0].y)
  const epsilon = Math.max(1, (spread / anchors.length) * 0.02) ** 2

  return (point) => {
    const s = similarity(point)
    // nearest few anchors by squared distance
    const near = []
    for (const a of anchors) {
      const d2 = (a.x - s.x) ** 2 + (a.y - s.y) ** 2
      if (near.length < NEIGHBOURS) {
        near.push({ a, d2 })
        if (near.length === NEIGHBOURS) near.sort((p, q) => p.d2 - q.d2)
      } else if (d2 < near[NEIGHBOURS - 1].d2) {
        near[NEIGHBOURS - 1] = { a, d2 }
        near.sort((p, q) => p.d2 - q.d2)
      }
    }
    let wsum = 0
    let rx = 0
    let ry = 0
    for (const { a, d2 } of near) {
      const w = 1 / (d2 + epsilon)
      wsum += w
      rx += a.rx * w
      ry += a.ry * w
    }
    if (!wsum) return s
    return { x: s.x + rx / wsum, y: s.y + ry / wsum }
  }
}

const CLASS_RANK = {
  motorway: 3,
  trunk: 3,
  primary: 3,
  secondary: 2,
  tertiary: 2,
  residential: 1,
  unclassified: 1,
  living_street: 1,
}

// Warps every fetched street into diagram space and simplifies it.
// `detail` (0..1) sets how much of the surveyed wiggle survives.
export function buildStreetLayer(streets, graph, positions, options = {}) {
  const { detail = 0.5, edgeLength = 92 } = options
  if (!streets?.length || !graph.nodes.length || !graph.project) return []
  const warp = buildWarp(graph, positions)
  if (!warp) return []

  // Coarser detail -> larger tolerance, scaled off the diagram's own edge
  // length so it means the same thing whatever the map's size.
  const tolerance = edgeLength * (0.02 + (1 - detail) * 0.22)

  const out = []
  let vertices = 0
  for (const way of streets) {
    if (vertices >= STREETS_MAX_VERTICES) {
      if (out.length) out[0].truncated = true
      break
    }
    // graph.project puts streets in exactly the plane the stops' gx/gy live
    // in, which is what makes the two comparable at all.
    const warped = way.coords.map((ll) => warp(graph.project(ll)))
    const points = simplifyPolyline(warped, tolerance)
    if (points.length < 2) continue
    let length = 0
    for (let i = 1; i < points.length; i++) {
      length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    }
    // A street the warp has squashed to a stub carries no information and
    // just adds noise behind the lines.
    if (length < edgeLength * 0.3) continue
    vertices += points.length
    out.push({
      id: way.id,
      name: way.name,
      rank: CLASS_RANK[way.cls] || 1,
      points,
      length,
    })
  }
  return out
}

// One label per street name, on its longest piece — a street split across a
// dozen OSM ways should read as one street, not be labelled a dozen times.
export function pickStreetLabels(roads, minLength) {
  const best = new Map()
  for (const road of roads) {
    if (!road.name || road.length < minLength) continue
    const current = best.get(road.name)
    if (!current || road.length > current.length) best.set(road.name, road)
  }
  return [...best.values()]
}
