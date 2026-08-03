/**
 * Restricting a drawing to one rectangle of interest.
 *
 * A signage package is usually one sheet per building, but the DXF exported
 * from it routinely carries the whole site — neighbouring blocks, a key plan,
 * a title block, sometimes several floors side by side. Auditing one entrance
 * lobby then means scrolling past thousands of entities that are not part of
 * the job, and the sign list fills with signs from buildings someone else is
 * responsible for.
 *
 * Cropping happens at the *entity* level, before anything is baked or
 * detected, rather than by clipping the rendered SVG. That way the sign list,
 * the layer list, the fitted bounds and the exported CSV all agree with what
 * is on screen: there is one definition of "in scope" and everything
 * downstream inherits it for free.
 */

import { apply, insertMatrix } from './geometry.js'

/** Do two axis-aligned boxes overlap at all? */
function overlaps(box, crop) {
  return box.minX <= crop.maxX && box.maxX >= crop.minX && box.minY <= crop.maxY && box.maxY >= crop.minY
}

function growToPoint(box, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return
  if (x < box.minX) box.minX = x
  if (y < box.minY) box.minY = y
  if (x > box.maxX) box.maxX = x
  if (y > box.maxY) box.maxY = y
}

/**
 * A cheap world-space box for one entity.
 *
 * Deliberately approximate — it reads the coordinate-bearing fields common to
 * every entity type rather than replaying the full geometry, because this runs
 * once per entity on files with tens of thousands of them and only has to be
 * good enough to decide "near the crop box or nowhere near it". Curves are
 * covered by their control/centre points plus radius, which can overstate the
 * box slightly; overstating keeps an entity that might be relevant, which is
 * the safe direction to err.
 *
 * @returns {object|null} box, or null when the entity carries no usable
 *   coordinates at all (in which case the caller keeps it — dropping something
 *   we failed to understand would silently lose drawing content).
 */
export function entityBox(entity, blocks) {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }

  if (entity.type === 'INSERT') {
    // A block reference's extent is its contents, so measure the definition
    // and place it — an INSERT's own position can sit far outside the
    // geometry it draws (see the note in link.js about callout tables).
    const block = blocks?.[entity.name]
    const m = insertMatrix(entity, block?.position)
    let any = false
    for (const child of block?.entities ?? []) {
      const childBox = entityBox(child, blocks)
      if (!childBox) continue
      any = true
      for (const [x, y] of [
        [childBox.minX, childBox.minY],
        [childBox.maxX, childBox.maxY],
        [childBox.minX, childBox.maxY],
        [childBox.maxX, childBox.minY],
      ]) {
        const p = apply(m, x, y)
        growToPoint(box, p.x, p.y)
      }
    }
    if (!any) {
      const p = entity.position ?? { x: 0, y: 0 }
      growToPoint(box, p.x, p.y)
    }
    return Number.isFinite(box.minX) ? box : null
  }

  for (const v of entity.vertices ?? []) growToPoint(box, v.x, v.y)
  for (const p of entity.points ?? []) growToPoint(box, p.x, p.y)
  for (const p of entity.controlPoints ?? []) growToPoint(box, p.x, p.y)
  for (const loop of entity.loops ?? []) {
    for (const v of loop.vertices ?? []) growToPoint(box, v.x, v.y)
    for (const edge of loop.edges ?? []) {
      growToPoint(box, edge.x1, edge.y1)
      growToPoint(box, edge.x2, edge.y2)
      if (edge.type !== 'line') growToPoint(box, edge.x, edge.y)
    }
  }
  if (entity.center) {
    const r = entity.radius ?? 0
    growToPoint(box, entity.center.x - r, entity.center.y - r)
    growToPoint(box, entity.center.x + r, entity.center.y + r)
  }
  for (const p of [entity.position, entity.startPoint, entity.endPoint]) {
    if (p) growToPoint(box, p.x, p.y)
  }

  return Number.isFinite(box.minX) ? box : null
}

/** Normalise a user-dragged rectangle into min/max form. */
export function normaliseBox(a, b) {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  }
}

/** Is a crop box big enough to be a deliberate selection rather than a stray tap? */
export function isUsableBox(box) {
  if (!box) return false
  return box.maxX - box.minX > 0 && box.maxY - box.minY > 0
}

/**
 * A shallow copy of the parsed document with model-space entities outside the
 * box removed.
 *
 * Block *definitions* are passed through untouched: a block is a template that
 * may be inserted both inside and outside the region, so what gets cropped is
 * the placements, not the definitions.
 *
 * @param {object} dxf parsed document
 * @param {object|null} box world-space crop rectangle, or null for no crop
 */
export function cropDxf(dxf, box) {
  if (!box || !isUsableBox(box)) return dxf
  const entities = (dxf.entities ?? []).filter((entity) => {
    const entityBounds = entityBox(entity, dxf.blocks)
    // Keep anything we could not measure rather than dropping it blind.
    if (!entityBounds) return true
    return overlaps(entityBounds, box)
  })
  return { ...dxf, entities }
}
