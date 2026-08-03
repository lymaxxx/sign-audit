// Turns laid-out node positions into everything the SVG renderer draws:
// parallel-offset line paths, stop markers, direction arrows, labels, badges.

import { edgeDirectionality } from './graph.js'
import { arrowAnchors, offsetPolyline, roundedPath, textWidth, unit } from './geometry.js'
import { buildRoadNetwork } from './roads.js'

const DEG = 180 / Math.PI

export function buildSchematic(project, graph, positions, settings) {
  const s = settings
  const gap = s.lineGap
  const routeOrder = new Map(project.routes.map((r, i) => [r.id, i]))
  const routeById = new Map(project.routes.map((r) => [r.id, r]))

  // Fixed slot per route on every shared corridor, so parallel lines keep the
  // same relative order across the whole map.
  for (const edge of graph.edges) {
    const ordered = edge.routeIds
      .slice()
      .sort((a, b) => (routeOrder.get(a) ?? 0) - (routeOrder.get(b) ?? 0))
    edge.slots = new Map(ordered.map((id, i) => [id, i]))
    edge.orderedRoutes = ordered
  }
  const edgeAt = new Map()
  for (const edge of graph.edges) edgeAt.set(edge.key, edge)

  const pos = (nodeIndex) => {
    const node = graph.nodes[nodeIndex]
    const p = positions.get(node.stopId)
    return { x: p.x, y: p.y }
  }

  const routes = []
  const arrows = []
  // Marker anchor for each stop, per route, so a single-line stop sits on its
  // own line rather than on the (empty) corridor centre.
  const stopAnchors = new Map()

  for (const route of project.routes) {
    if (route.visible === false) continue
    const paths = []
    const badges = []
    // One run for the shared corridor plus one per genuinely divergent
    // branch — see mergeRouteDirections. A stop only one direction calls at
    // stays on the corridor and gets an arrow on its marker instead.
    const merged = graph.corridors?.get(route.id)
    if (!merged) continue
    const runs = [
      ...merged.corridor.map((stopIds) => ({ stopIds, dirKey: 'fwd', branch: false })),
      ...merged.branches.map((b) => ({ ...b, branch: true })),
    ]

    for (let runIndex = 0; runIndex < runs.length; runIndex++) {
      const run = runs[runIndex]
      const dirKey = run.dirKey
      if (run.stopIds.length < 2) continue

      const seq = run.stopIds
        .map((id) => graph.index.get(id))
        .filter((v) => v !== undefined)
      const collapsed = seq.filter((v, i) => i === 0 || v !== seq[i - 1])
      if (collapsed.length < 2) continue

      const rawPoints = collapsed.map(pos)
      const offsets = []
      const segEdges = []
      for (let i = 0; i < collapsed.length - 1; i++) {
        const a = collapsed[i]
        const b = collapsed[i + 1]
        const key = a < b ? `${a}|${b}` : `${b}|${a}`
        const edge = edgeAt.get(key)
        segEdges.push(edge)
        if (!edge) {
          offsets.push(0)
          continue
        }
        const slot = edge.slots.get(route.id) ?? 0
        const base = (slot - (edge.orderedRoutes.length - 1) / 2) * gap
        offsets.push(a === edge.u ? base : -base)
      }

      const points = offsetPolyline(rawPoints, offsets)
      paths.push({
        d: roundedPath(points, s.cornerRadius, s.cornerFullness),
        dirKey,
        oneWay: run.branch,
        key: `${route.id}-${dirKey}-${runIndex}`,
      })

      // remember where this route passes each of its stops
      collapsed.forEach((nodeIndex, i) => {
        const stopId = graph.nodes[nodeIndex].stopId
        if (!stopAnchors.has(stopId)) stopAnchors.set(stopId, [])
        const prev = points[i - 1]
        const next = points[i + 1]
        const ref = next || prev
        const angle = ref
          ? Math.atan2(
              (next ? next.y : points[i].y) - (next ? points[i].y : prev.y),
              (next ? next.x : points[i].x) - (next ? points[i].x : prev.x),
            ) * DEG
          : 0
        stopAnchors.get(stopId).push({
          routeId: route.id,
          x: points[i].x,
          y: points[i].y,
          angle,
          // 'fwd'/'bwd' here means "this route only calls here in that
          // direction" — the marker draws a small arrow for it.
          serves: run.branch ? 'both' : merged.serves.get(stopId) || 'both',
          color: route.color,
        })
      })

      // one-way sections get direction arrows
      if (s.arrows.show) {
        for (let i = 0; i < collapsed.length - 1; i++) {
          const edge = segEdges[i]
          if (!edge) continue
          const dirMode = edgeDirectionality(edge, route.id)
          if (dirMode === 'both' || !dirMode) continue
          for (const anchor of arrowAnchors(points[i], points[i + 1], s.arrows.spacing)) {
            arrows.push({
              ...anchor,
              color: route.color,
              key: `${route.id}-${runIndex}-${i}-${anchor.x.toFixed(1)}`,
            })
          }
        }
      }

      // Only the corridor gets terminus badges — a divergent branch rejoins
      // the line, it isn't where the route starts or finishes.
      if (s.badges.show && !run.branch) {
        for (const end of [0, points.length - 1]) {
          const other = end === 0 ? points[1] : points[points.length - 2]
          const u = unit(other.x, other.y, points[end].x, points[end].y)
          badges.push({
            x: points[end].x + u.x * (s.badges.size * 1.6),
            y: points[end].y + u.y * (s.badges.size * 1.6),
            key: `${route.id}-${runIndex}-${end}`,
          })
        }
      }
    }

    if (paths.length) {
      routes.push({
        id: route.id,
        color: route.color,
        number: route.number,
        name: route.name,
        paths,
        badges,
      })
    }
  }

  // ---- stop markers
  const markers = []
  for (const node of graph.nodes) {
    const anchors = stopAnchors.get(node.stopId) || []
    const routeCount = node.routeIds.length
    const isInterchange = routeCount > 1
    const p = positions.get(node.stopId)
    const angle = anchors.length
      ? averageAngle(anchors.map((a) => a.angle))
      : 0
    const own = anchors[0]
    markers.push({
      stopId: node.stopId,
      name: node.name,
      kind: node.kind,
      isInterchange,
      routeCount,
      routeIds: node.routeIds,
      colors: node.routeIds.map((id) => routeById.get(id)?.color || '#333'),
      x: isInterchange || !own ? p.x : own.x,
      y: isInterchange || !own ? p.y : own.y,
      centerX: p.x,
      centerY: p.y,
      angle,
      span: Math.max(0, (routeCount - 1) * gap),
      terminus: node.degree === 1,
      anchors,
      // Anchors whose route only calls here in one direction — each draws a
      // small arrow beside the marker instead of splitting the line.
      oneWayAnchors: anchors.filter((a) => a.serves && a.serves !== 'both'),
    })
  }

  // Label placement always runs (even with labels hidden) because the chosen
  // side is also what points the stop tick marks — a station still needs a
  // "toward the label" direction whether or not the text itself is drawn.
  const labelPositions = placeLabels(markers, routes, s)
  const tickAngleByStop = new Map(labelPositions.map((l) => [l.stopId, l.angle]))
  for (const m of markers) m.tickAngle = tickAngleByStop.get(m.stopId) ?? PREFERRED_DIRECTIONS.right.angle

  const labels = s.labels.show ? labelPositions : []
  const bounds = computeBounds(markers, labels, routes, s)
  const roads = s.roads?.show ? buildRoadNetwork(graph, positions, s.edgeLength) : []

  return { routes, markers, arrows, labels, bounds, roads }
}

function averageAngle(angles) {
  let sx = 0
  let sy = 0
  for (const a of angles) {
    // treat as undirected: fold onto a half-circle so opposite directions agree
    const r = ((a * 2) / DEG)
    sx += Math.cos(r)
    sy += Math.sin(r)
  }
  return (Math.atan2(sy, sx) * DEG) / 2
}

const LABEL_DIRECTIONS = [
  { dx: 1, dy: 0, anchor: 'start' },
  { dx: -1, dy: 0, anchor: 'end' },
  { dx: 0, dy: -1, anchor: 'middle' },
  { dx: 0, dy: 1, anchor: 'middle' },
  { dx: 0.7071, dy: -0.7071, anchor: 'start' },
  { dx: 0.7071, dy: 0.7071, anchor: 'start' },
  { dx: -0.7071, dy: -0.7071, anchor: 'end' },
  { dx: -0.7071, dy: 0.7071, anchor: 'end' },
]

// One consistent default side, so most labels (and the tick marks that point
// at them) end up facing the same way — a big part of a schematic's rhythm.
// Only overridden per-station when that side is actually blocked.
export const PREFERRED_DIRECTIONS = {
  right: { dx: 1, dy: 0, angle: 0 },
  left: { dx: -1, dy: 0, angle: 180 },
  above: { dx: 0, dy: -1, angle: -90 },
  below: { dx: 0, dy: 1, angle: 90 },
}

// Greedy label placement: important stops choose first, each label takes the
// least-cluttered free slot around its marker.
function placeLabels(markers, routes, s) {
  const cell = 7
  const occupied = new Set()
  const mark = (x, y) => occupied.add(`${Math.round(x / cell)},${Math.round(y / cell)}`)

  for (const route of routes) {
    for (const path of route.paths) {
      for (const p of samplePath(path.d, cell)) mark(p.x, p.y)
    }
    for (const b of route.badges) {
      const w = s.badges.size * (1 + route.number.length * 0.68)
      for (let dx = -w / 2; dx <= w / 2; dx += cell) {
        for (let dy = -s.badges.size; dy <= s.badges.size; dy += cell) mark(b.x + dx, b.y + dy)
      }
    }
  }
  for (const m of markers) {
    const r = (m.isInterchange ? s.interchangeStop.size : s.regularStop.size) + m.span / 2
    for (let dx = -r; dx <= r; dx += cell) {
      for (let dy = -r; dy <= r; dy += cell) mark(m.x + dx, m.y + dy)
    }
  }

  const preferred = PREFERRED_DIRECTIONS[s.labels?.preferredSide] || PREFERRED_DIRECTIONS.right
  const size = s.labels.size
  const placed = []
  const order = markers
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      const ia = (a.m.isInterchange ? 2 : 0) + (a.m.terminus ? 1 : 0)
      const ib = (b.m.isInterchange ? 2 : 0) + (b.m.terminus ? 1 : 0)
      return ib - ia || a.i - b.i
    })

  for (const { m } of order) {
    const text = truncate(m.name, s.labels.maxChars)
    const w = textWidth(text, size)
    const h = size * 1.15
    // A one-direction-only arrow sits out along the tick, between marker and
    // label, so the label has to start beyond it.
    const arrowRoom =
      s.stopArrows?.show && m.oneWayAnchors.length
        ? s.stopArrows.size * (1.3 + 2.2 * (m.oneWayAnchors.length - 1)) + s.stopArrows.size
        : 0
    const clearance =
      (m.isInterchange ? s.interchangeStop.size + m.span / 2 : s.regularStop.size) +
      6 +
      arrowRoom
    let best = null
    for (const push of [0, size * 1.1, size * 2.4, size * 4]) {
      for (const dir of LABEL_DIRECTIONS) {
        const reach = clearance + push
        const cx = m.x + dir.dx * (reach + (dir.dx ? w / 2 : 0))
        const cy = m.y + dir.dy * (reach + h / 2)
        const rect = { x: cx - w / 2, y: cy - h / 2, w, h }
        let cost = push * 0.05
        // penalise clashes with lines/markers
        for (let gx = rect.x; gx <= rect.x + rect.w; gx += cell) {
          for (let gy = rect.y; gy <= rect.y + rect.h; gy += cell) {
            if (occupied.has(`${Math.round(gx / cell)},${Math.round(gy / cell)}`)) cost += 7
          }
        }
        // overlapping another label is punished by how much it overlaps, so
        // a graze costs little but a real collision is rejected outright
        for (const p of placed) {
          const ox = Math.min(rect.x + rect.w, p.rect.x + p.rect.w) - Math.max(rect.x, p.rect.x)
          const oy = Math.min(rect.y + rect.h, p.rect.y + p.rect.h) - Math.max(rect.y, p.rect.y)
          if (ox > 0 && oy > 0) cost += 40 + (ox * oy) / cell
        }
        // prefer labels sitting off the side of the corridor
        const perp = Math.abs(Math.cos(((m.angle + 90) / DEG) - Math.atan2(dir.dy, dir.dx)))
        cost += (1 - perp) * 2.5
        // bias toward one consistent side across the whole diagram — only
        // lost when a real collision cost outweighs it
        if (dir.dx === preferred.dx && dir.dy === preferred.dy) cost -= 0.8
        if (!best || cost < best.cost) {
          best = { cost, rect, dir, cx, cy, text }
        }
      }
      if (best && best.cost < 1.5) break
    }
    if (!best) continue
    placed.push({
      stopId: m.stopId,
      text: best.text,
      x: best.dir.dx === 0 ? m.x : best.cx - (best.dir.dx > 0 ? best.rect.w / 2 : -best.rect.w / 2),
      y: best.cy,
      anchor: best.dir.anchor,
      angle: Math.atan2(best.dir.dy, best.dir.dx) * DEG,
      rect: best.rect,
      bold:
        s.labels.bold === 'all' || (s.labels.bold === 'interchange' && m.isInterchange),
    })
  }
  return placed
}

function truncate(text, max) {
  if (!max || text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

// Cheap sampling of an SVG path's control points (we only need approximate
// occupancy, so the anchor points of each command are enough).
function samplePath(d, step) {
  const nums = d.match(/-?\d+(\.\d+)?/g)
  if (!nums) return []
  const pts = []
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push({ x: Number(nums[i]), y: Number(nums[i + 1]) })
  }
  const out = []
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const n = Math.max(1, Math.ceil(len / step))
    for (let k = 0; k <= n; k++) {
      out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })
    }
  }
  return out
}

function computeBounds(markers, labels, routes, s) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const grow = (x, y) => {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  for (const m of markers) {
    const r = (m.isInterchange ? s.interchangeStop.size : s.regularStop.size) + m.span / 2
    grow(m.x - r, m.y - r)
    grow(m.x + r, m.y + r)
  }
  for (const l of labels) {
    grow(l.rect.x, l.rect.y)
    grow(l.rect.x + l.rect.w, l.rect.y + l.rect.h)
  }
  for (const route of routes) {
    for (const b of route.badges) {
      grow(b.x - s.badges.size * 1.6, b.y - s.badges.size * 1.6)
      grow(b.x + s.badges.size * 1.6, b.y + s.badges.size * 1.6)
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 }
  const pad = 40
  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  }
}
