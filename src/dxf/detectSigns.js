/**
 * Deciding which things on a drawing are signs, and what they are called.
 *
 * A signage package separates the sign from its data: a small rotated symbol
 * where the sign physically stands, and a table of attributes parked in clear
 * space, joined by a leader line. Neither half is a sign on its own — the
 * symbol has no name, the table has no location.
 *
 * Nothing here guesses silently. Detection is driven by an explicit *recipe*
 * that the import wizard shows and the user can correct, and every function is
 * pure so the wizard can re-run the whole thing on each keystroke and preview
 * the result before anything is committed.
 */

import { newId } from '../util/id.js'
import { findLeaders, instanceBounds, nearestTag, networkLeaderHandles, pairByLeader } from './link.js'
import { findLooseMarkers, looseMarkerLayers } from './looseMarkers.js'

/**
 * Sign type is the layer the marker sits on, verbatim.
 *
 * Layer names carry the classification on a real package — `_DIRECTIONAL_SIGN`,
 * `_IDENTIFICATION_SIGN` — and they are inconsistent enough between drawings
 * (underscores here, spaces there) that tidying them up loses information.
 */
export function signType(layer) {
  const name = (layer ?? '').trim()
  return name || 'Unassigned'
}

/** Uniform scale of a composed transform, used to tell symbols from callouts. */
function matrixScale(matrix) {
  if (!matrix) return 1
  return Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2])) || 1
}

const hasAttributes = (insert) => Object.keys(insert.attribs ?? {}).length > 0

/* ------------------------------------------------------- dynamic blocks */

/**
 * AutoCAD writes each variant of a dynamic block as an anonymous definition
 * named `*U20`, `*U22` and so on. Listing those in the wizard is useless, so
 * each is matched to the named block sharing its attribute signature.
 */
export function resolveDynamicBlockNames(dxf) {
  // Attribute tags identify a block far more reliably than its geometry, so
  // they are tried first. Blocks with no attributes at all — arrow glyphs and
  // the like — fall back to a shape signature, which is only trusted when
  // exactly one named block has it.
  const attribSignature = (block) =>
    (block?.entities ?? [])
      .filter((e) => e.type === 'ATTDEF')
      .map((e) => e.tag)
      .sort()
      .join('|')

  const shapeSignature = (block) => {
    const counts = {}
    for (const entity of block?.entities ?? []) {
      counts[entity.type] = (counts[entity.type] ?? 0) + 1
    }
    return Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, n]) => `${type}*${n}`)
      .join('|')
  }

  const byAttribs = new Map()
  const byShape = new Map()
  for (const [name, block] of Object.entries(dxf.blocks ?? {})) {
    if (name.startsWith('*')) continue
    const attribs = attribSignature(block)
    if (attribs && !byAttribs.has(attribs)) byAttribs.set(attribs, name)

    const shape = shapeSignature(block)
    if (!shape) continue
    // Mark ambiguous signatures rather than picking arbitrarily.
    byShape.set(shape, byShape.has(shape) ? null : name)
  }

  const aliases = new Map()
  for (const [name, block] of Object.entries(dxf.blocks ?? {})) {
    if (!name.startsWith('*U')) continue
    const match =
      byAttribs.get(attribSignature(block)) ?? byShape.get(shapeSignature(block)) ?? null
    if (match) aliases.set(name, match)
  }
  return aliases
}

/* ------------------------------------------------------------- analysis */

/**
 * Everything the wizard needs to describe the drawing and preview a recipe.
 * @param {object} dxf parsed document
 * @param {object} plan output of buildPlan
 */
export function analyseDrawing(dxf, plan) {
  const aliases = resolveDynamicBlockNames(dxf)
  const entities = dxf.entities ?? []

  const inserts = plan.inserts.map((insert) => ({
    ...insert,
    effectiveName: aliases.get(insert.blockName) ?? insert.blockName,
    isVariant: aliases.has(insert.blockName),
    scale: matrixScale(insert.matrix),
    box: instanceBounds(insert, dxf.blocks),
  }))

  // A block can be both: some drawings keep the sign's data on the symbol
  // itself rather than in a separate callout.
  const tagCandidates = inserts.filter(hasAttributes)
  const markerCandidates = inserts

  // Group by effective name so a dynamic block appears once, not five times.
  const blocks = new Map()
  for (const insert of inserts) {
    const name = insert.effectiveName || '(unnamed)'
    let block = blocks.get(name)
    if (!block) {
      block = {
        name,
        count: 0,
        variants: new Set(),
        tags: new Set(),
        layers: new Set(),
        scales: [],
        rotations: [],
        withAttributes: 0,
      }
      blocks.set(name, block)
    }
    block.count++
    if (insert.isVariant) block.variants.add(insert.blockName)
    for (const tag of Object.keys(insert.attribs ?? {})) block.tags.add(tag)
    if (hasAttributes(insert)) block.withAttributes++
    block.layers.add(insert.layer)
    block.scales.push(insert.scale)
    block.rotations.push(insert.rotation ?? 0)
  }

  const attributeTags = new Map()
  for (const insert of tagCandidates) {
    for (const [tag, value] of Object.entries(insert.attribs)) {
      const stat = attributeTags.get(tag) ?? { tag, filled: 0, values: new Set() }
      if (value) {
        stat.filled++
        stat.values.add(value)
      }
      attributeTags.set(tag, stat)
    }
  }

  return {
    inserts,
    tagCandidates,
    markerCandidates,
    leaders: findLeaders(entities),
    looseLayers: looseMarkerLayers(entities),
    entities,
    blocks: [...blocks.values()]
      .map((b) => ({
        ...b,
        variants: [...b.variants],
        tags: [...b.tags],
        layers: [...b.layers],
        medianScale: b.scales.slice().sort((x, y) => x - y)[Math.floor(b.scales.length / 2)] ?? 1,
        rotated: b.rotations.some((r) => Math.abs(r) > 0.01),
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    attributeTags: [...attributeTags.values()]
      .map((t) => ({ tag: t.tag, filled: t.filled, distinct: t.values.size }))
      .sort((a, b) => b.distinct - a.distinct),
  }
}

/* --------------------------------------------------------------- recipe */

/**
 * Seed a recipe from the drawing.
 *
 * The signals that separate a sign symbol from a callout on a real package:
 * a symbol carries no attributes, is drawn at roughly its true size, and is
 * rotated to show which way the sign faces; a callout carries the attributes,
 * is scaled up hugely so its text is legible at plot scale, and is never
 * rotated.
 */
export function suggestRecipe(analysis) {
  // A sign's name is built from the sign code — the identifier the signage
  // package is actually organised by — and the sequential number, joined so
  // the name stays unique even though the code alone is not: two different
  // physical signs of the same type legitimately share a code, and the
  // sequential number is what tells them apart in that case.
  const sc = analysis.attributeTags.find((t) => /^(SC|SIGN.?CODE)$/i.test(t.tag))?.tag
  const seq = analysis.attributeTags.find((t) => /^(SG#|SGN|SEQ)/i.test(t.tag))?.tag
  const nameTags = [sc, seq].filter(Boolean)
  if (!nameTags.length && analysis.attributeTags[0]) nameTags.push(analysis.attributeTags[0].tag)

  const markerBlocks = new Set()
  const tagBlocks = new Set()

  for (const block of analysis.blocks) {
    const onSignLayer = block.layers.some((l) => /sign/i.test(l ?? ''))
    // A callout is blown up so its text stays legible at plot scale — 500× in
    // the reference drawing. A sign symbol is drawn at roughly true size.
    const nearTrueSize = block.medianScale > 0.2 && block.medianScale < 20
    const looksPlaced = nearTrueSize && (block.rotated || onSignLayer)

    if (block.withAttributes > 0) {
      tagBlocks.add(block.name)
      // Not every drawing separates the two. Where one block carries both the
      // position and the attributes, it is its own callout and needs no leader.
      if (looksPlaced && nameTags.some((t) => block.tags.includes(t))) markerBlocks.add(block.name)
      continue
    }
    if (looksPlaced) markerBlocks.add(block.name)
  }

  const looseLayers = new Set(
    analysis.looseLayers.filter((l) => l.withCentreMark > 0).map((l) => l.layer),
  )

  return { markerBlocks, tagBlocks, looseLayers, nameTags, linkBy: 'leader' }
}

/* ---------------------------------------------------------------- sides */

const LETTER = /^[A-Z]$/i

/**
 * Seed the faces of a sign from the letters drawn inside its block.
 *
 * A block symbol reliably contains its side letters as text ("A", or "A" and
 * "B"), so those are used, with the first face pointing the way the block is
 * rotated. Anything less clear-cut is left as a single face for the user to
 * correct — see `looseMarkers.js` for why guessing is worse than not.
 */
export function seedSides(letters, rotation = 0) {
  const found = [...new Set((letters ?? []).map((t) => t.trim().toUpperCase()).filter((t) => LETTER.test(t)))].sort()
  const ids = found.length ? found : ['A']
  return ids.map((id, index) => ({
    id,
    bearing: (((rotation + (index * 360) / ids.length) % 360) + 360) % 360,
  }))
}

/** Spread faces evenly around the sign, keeping the first one where it is. */
export function evenlySpace(sides) {
  const start = sides[0]?.bearing ?? 0
  return sides.map((side, index) => ({
    ...side,
    bearing: (((start + (index * 360) / sides.length) % 360) + 360) % 360,
  }))
}

/* ---------------------------------------------------------------- signs */

function tagView(insert, nameTags) {
  return {
    id: insert.handle ?? `${insert.blockName}@${insert.x},${insert.y}`,
    box: insert.box,
    layer: insert.layer,
    hasName: nameTags.some((t) => insert.attribs?.[t]),
    insert,
  }
}

/** Join whichever of the recipe's name attributes are actually present. */
function composeName(attribs, nameTags) {
  return nameTags
    .map((t) => (attribs?.[t] ?? '').trim())
    .filter(Boolean)
    .join('_')
}

/** A loose (non-block) marker's box, so it can go through the same leader
 * pairing as a block marker — `findLooseMarkers` already provides one, sized
 * to whichever shape (circle or rectangle) it detected. */
function looseMarkerView(marker, index) {
  return {
    id: `loose${index}`,
    box: marker.box,
    layer: marker.layer,
    marker,
  }
}

/**
 * Apply a recipe and produce the signs.
 * @returns {{signs: object[], links: Array<{from: object, to: object}>, unlinked: number}}
 */
export function buildSigns(analysis, recipe) {
  const nameTags = recipe.nameTags
  const markers = analysis.markerCandidates.filter(
    (insert) =>
      recipe.markerBlocks.has(insert.effectiveName) &&
      // A sign symbol nested inside another selected marker block is the same
      // physical sign as its parent, not a second one.
      !insert.parents?.some((parent) => recipe.markerBlocks.has(parent)),
  )
  const tags = analysis.tagCandidates.filter((i) => recipe.tagBlocks.has(i.effectiveName))

  const blockViews = markers.map((insert, index) => ({
    id: insert.handle ?? `m${index}`,
    box: insert.box,
    layer: insert.layer,
    insert,
  }))
  // Loose markers join the SAME candidate list as block markers, before
  // pairing runs, so a leader touching a circle links it exactly like a
  // leader touching a block — there is no separate, weaker code path for them.
  const looseViews = findLooseMarkers(analysis.entities, recipe.looseLayers).map(
    looseMarkerView,
  )
  const markerViews = [...blockViews, ...looseViews]

  const tagViews = tags.map((insert) => tagView(insert, nameTags))
  const tagById = new Map(tagViews.map((t) => [t.id, t]))

  const paired =
    recipe.linkBy === 'leader'
      ? pairByLeader(markerViews, tagViews, analysis.leaders)
      : new Map()

  const links = []
  const signs = []
  let unlinked = 0

  for (const view of markerViews) {
    // A self-describing block marker carries its own data and needs no leader.
    const ownName = nameTags.some((t) => view.insert?.attribs?.[t])
    let tag = ownName ? view : (tagById.get(paired.get(view.id)) ?? null)

    if (!tag && recipe.linkBy !== 'leader') {
      const near = nearestTag(view, tagViews)
      if (near) tag = near.tag
    }

    const attribs = tag?.insert?.attribs ?? {}
    const name = composeName(attribs, nameTags)
    if (!tag) unlinked++
    if (tag && view.insert) links.push({ from: view.insert, to: tag.insert })

    if (view.marker) {
      // A loose circle: position only ever came from the shape, never from a
      // block, so sides are always left for the user regardless of linking.
      signs.push({
        id: `loose_${newId()}`,
        name: name || 'Unnamed',
        type: signType(view.marker.layer),
        x: view.marker.x,
        y: view.marker.y,
        rotation: 0,
        blockName: null,
        layer: view.marker.layer,
        source: 'loose',
        status: name ? 'unchecked' : 'review',
        notes: '',
        sides: [{ id: 'A', bearing: 0 }],
        data: attribs,
        photos: {},
        updatedAt: null,
      })
      continue
    }

    signs.push({
      id: `cad_${view.insert.handle ?? newId()}`,
      name: name || view.insert.effectiveName || 'Unnamed',
      type: signType(view.insert.layer),
      x: view.insert.x,
      y: view.insert.y,
      rotation: view.insert.rotation ?? 0,
      blockName: view.insert.effectiveName,
      layer: view.insert.layer,
      source: 'cad',
      // A marker whose callout could not be found is real work: it is on the
      // drawing, it has no number, and someone has to resolve that on site.
      status: name ? 'unchecked' : 'review',
      notes: '',
      sides: seedSides(view.insert.innerText, view.insert.rotation ?? 0),
      data: attribs,
      photos: {},
      updatedAt: null,
    })
  }

  // Leaders that actually join a marker to a tag are drawn purely to explain
  // the pairing on the original CAD sheet; once the tag's rectangle is hidden
  // (see the module doc), the line itself is a dangling stub pointing at
  // nothing and should go with it.
  const leaderHandles = networkLeaderHandles(markerViews, tagViews, analysis.leaders)

  return { signs, links, unlinked, leaderHandles }
}
