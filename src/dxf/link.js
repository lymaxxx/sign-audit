/**
 * Working out which callout on the drawing describes which sign.
 *
 * On a real signage package the physical sign and its data are two separate
 * things: a small rotated symbol where the sign stands, and a table of
 * attributes (`SG#`, `SC`, `LN`, `BLDG#`) parked in clear space, joined by a
 * leader line. Nothing in the DXF says they belong together — the link has to be
 * recovered from geometry.
 *
 * Two things make it work that are easy to get wrong:
 *
 *  1. **Leaders are polylines, not lines.** In the reference drawing every
 *     leader is a three-point LWPOLYLINE dog-leg. Searching only LINE entities
 *     finds nothing.
 *  2. **Measure against drawn extents, not insertion points.** A callout's
 *     insertion point sits at one corner of a table 18,000 units wide, so a
 *     leader that visibly touches it is thousands of units from the insert
 *     position. Comparing insertion points suggests the leaders miss by ~9,400
 *     units; comparing bounding boxes shows they touch exactly.
 *
 * Done properly the pairing is exact — zero distance at both ends — and it
 * resolves cases that no other approach can. Matching a marker's block name to
 * the callout's sign code cannot separate two instances of the same block, and
 * nearest-callout-by-distance mispairs whenever a drawing is dense.
 */

import { apply, insertMatrix } from './geometry.js'

/** How far an endpoint may sit outside a box and still count as touching it. */
const TOUCH_SLOP = 1

/**
 * World-space bounding box of a block reference's *drawn* geometry.
 *
 * Takes the flattened insert record produced by `buildPlan`, which already
 * carries the composed world transform, so nesting is handled for free.
 *
 * One level deep into the block: nested references contribute their insertion
 * point rather than their contents, which is enough for a callout or a sign
 * symbol and keeps this cheap enough to run for every instance on a large
 * drawing.
 */
export function instanceBounds(insert, blocks) {
  const block = blocks?.[insert.blockName ?? insert.name]
  const m = insert.matrix ?? insertMatrix(insert, block?.position)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  const add = (x, y) => {
    const p = apply(m, x, y)
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }

  for (const entity of block?.entities ?? []) {
    for (const v of entity.vertices ?? []) add(v.x, v.y)
    for (const loop of entity.loops ?? []) {
      for (const v of loop.vertices ?? []) add(v.x, v.y)
      for (const edge of loop.edges ?? []) {
        if (Number.isFinite(edge.x1)) add(edge.x1, edge.y1)
        if (Number.isFinite(edge.x2)) add(edge.x2, edge.y2)
        if (Number.isFinite(edge.x) && edge.type !== 'line') add(edge.x, edge.y)
      }
    }
    if (entity.center) {
      const r = entity.radius ?? 0
      add(entity.center.x - r, entity.center.y - r)
      add(entity.center.x + r, entity.center.y + r)
    }
    const point = entity.position ?? entity.startPoint
    if (point && Number.isFinite(point.x)) add(point.x, point.y)
  }

  if (!Number.isFinite(minX)) {
    // An empty or unresolved block: fall back to its insertion point so it can
    // still take part in pairing rather than dropping out silently.
    const p = insert.position ?? { x: 0, y: 0 }
    return { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y, empty: true }
  }
  return { minX, minY, maxX, maxY, empty: false }
}

/** Distance from a point to a box; zero when inside. */
export function boxDistance(box, p) {
  return Math.hypot(
    Math.max(box.minX - p.x, 0, p.x - box.maxX),
    Math.max(box.minY - p.y, 0, p.y - box.maxY),
  )
}

/**
 * Candidate leaders: any open chain of two or more points.
 *
 * LWPOLYLINE first because that is what CAD actually produces for a leader,
 * then LINE, POLYLINE, LEADER and MULTILEADER for drawings that differ.
 */
export function findLeaders(entities) {
  const leaders = []
  for (const entity of entities) {
    if (!LEADER_TYPES.has(entity.type)) continue
    const pts = entity.vertices
    if (!pts || pts.length < 2) continue
    // A closed polyline is a shape, not a leader.
    if (entity.shape) continue
    const a = pts[0]
    const b = pts[pts.length - 1]
    if (!Number.isFinite(a?.x) || !Number.isFinite(b?.x)) continue
    leaders.push({ entity, ends: [a, b], layer: entity.layer })
  }
  return leaders
}

const LEADER_TYPES = new Set(['LWPOLYLINE', 'LINE', 'POLYLINE', 'LEADER', 'MULTILEADER'])

// Narrower than `LEADER_TYPES` above: used to decide, at bake time, whether an
// entity is worth giving its own hideable bucket (see `flatten.js`). Plain
// LINE is excluded and the chain is capped at a handful of vertices, because
// unlike the pairing search above — which only ever runs over a drawing's
// already-small candidate lists — this predicate is evaluated against every
// entity in the file. Ordinary model-space drafting (walls, site lines) is
// built from exactly the entities this excludes, so the set of matches stays
// small regardless of drawing size; a leader dog-leg is reliably a short,
// open LWPOLYLINE (see the module doc above) and stays matched.
const LEADER_SHAPE_TYPES = new Set(['LWPOLYLINE', 'POLYLINE', 'LEADER', 'MULTILEADER'])
const MAX_LEADER_SHAPE_VERTICES = 4

export function isLeaderShape(entity) {
  if (!LEADER_SHAPE_TYPES.has(entity.type)) return false
  const pts = entity.vertices
  if (!pts || pts.length < 2 || pts.length > MAX_LEADER_SHAPE_VERTICES) return false
  if (entity.shape) return false
  return Number.isFinite(pts[0]?.x) && Number.isFinite(pts[pts.length - 1]?.x)
}

/**
 * Pair each marker with the callout its leader reaches.
 *
 * @param {Array<{id: string, box: object}>} markers
 * @param {Array<{id: string, box: object, hasName: boolean}>} tags
 * @param {ReturnType<typeof findLeaders>} leaders
 * @returns {Map<string, string>} marker id -> tag id
 */
export function pairByLeader(markers, tags, leaders) {
  const pairs = new Map()

  for (const leader of leaders) {
    // Direction is not consistent between leaders, so try the chain both ways.
    for (const [fromEnd, toEnd] of [
      [leader.ends[0], leader.ends[1]],
      [leader.ends[1], leader.ends[0]],
    ]) {
      const marker = markers.find((m) => boxDistance(m.box, fromEnd) <= TOUCH_SLOP)
      if (!marker || pairs.has(marker.id)) continue

      const touching = tags.filter((t) => boxDistance(t.box, toEnd) <= TOUCH_SLOP)
      if (!touching.length) continue

      // A callout is often a stack of overlapping blocks — a head carrying the
      // codes and a message box carrying the text — so several boxes can
      // contain the same endpoint. Prefer whichever one actually has the
      // naming attribute.
      const chosen = touching.find((t) => t.hasName) ?? touching[0]
      pairs.set(marker.id, chosen.id)
      break
    }
  }

  return pairs
}

/**
 * Which leader entities actually connect a selected marker to a selected tag —
 * the ones whose line should disappear along with the tag's rectangle, so a
 * dangling stub is not left pointing at nothing once the tag is hidden.
 *
 * Deliberately not the same pass as `pairByLeader`: every leader touching both
 * a marker and a tag counts here, not just the first one claimed per marker,
 * because this drives what to hide from the drawing, not what to name a sign.
 */
export function networkLeaderHandles(markers, tags, leaders) {
  const handles = new Set()
  for (const leader of leaders) {
    if (!leader.entity?.handle) continue
    const [a, b] = leader.ends
    const touchesMarker = markers.some(
      (m) => boxDistance(m.box, a) <= TOUCH_SLOP || boxDistance(m.box, b) <= TOUCH_SLOP,
    )
    if (!touchesMarker) continue
    const touchesTag = tags.some(
      (t) => boxDistance(t.box, a) <= TOUCH_SLOP || boxDistance(t.box, b) <= TOUCH_SLOP,
    )
    if (!touchesTag) continue
    handles.add(leader.entity.handle)
  }
  return handles
}

/**
 * Fallback for markers no leader reached: the nearest callout on the same layer.
 * Deliberately conservative — it returns a distance so the caller can decide
 * whether the guess is close enough to trust.
 */
export function nearestTag(marker, tags, sameLayerOnly = true) {
  const centre = {
    x: (marker.box.minX + marker.box.maxX) / 2,
    y: (marker.box.minY + marker.box.maxY) / 2,
  }
  let best = null
  for (const tag of tags) {
    if (sameLayerOnly && tag.layer && marker.layer && tag.layer !== marker.layer) continue
    if (!tag.hasName) continue
    const distance = boxDistance(tag.box, centre)
    if (!best || distance < best.distance) best = { tag, distance }
  }
  return best
}
